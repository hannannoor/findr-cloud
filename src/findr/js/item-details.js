/* ===== findr — Item Details page ===== */

let currentReport = null;
let originalText = null;   // keep the english so we can switch back

document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(window.location.search);
    const reportId = params.get("id");

    const detailDiv = document.getElementById("item-detail");
    const loading = document.getElementById("loading");
    const notFound = document.getElementById("not-found");

    if (!reportId) {
        loading.style.display = "none";
        notFound.style.display = "block";
        return;
    }

    const data = await getReportById(reportId);
    loading.style.display = "none";

    if (!data.success) {
        notFound.style.display = "block";
        return;
    }

    const report = data.report;
    currentReport = report;
    // everything the language switcher needs to put the page back to english
    originalText = {
        title: report.title,
        description: report.description,
        location: report.location,
        category: report.category,
        date: report.date,
        labels: report.rekognitionLabels || [],
    };
    document.title = `${report.title} — Findr`;

    const labels = labelChips(originalText.labels);

    // built here rather than with getTypeBadge/getStatusBadge so the words
    // carry a data-i18n hook and can be translated with everything else
    const cap = s => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
    const typeBadge = `<span class="badge badge-${String(report.type || "").replace(/[^a-z]/gi, "")}"><span class="dot"></span><span data-i18n="${esc(report.type)}">${esc(cap(report.type))}</span></span>`;
    const statusBadge = `<span class="badge badge-${String(report.status || "Open").toLowerCase().replace(/[^a-z]/g, "")}"><span class="dot"></span><span data-i18n="${esc(report.status)}">${esc(report.status)}</span></span>`;

    // don't offer to message yourself
    const me = getSession();
    const isMine = me && me.id === report.userId;

    // only offer verification if the finder actually recorded something to
    // check against - private details, a name found inside, or both
    const hasChecks = !!report.hasSecretDetails;

    // you can only claim someone else's found item, and only while it's open
    const claimable = !isMine && report.type === "found"
        && report.status === "Open" && hasChecks;

    const actions = isMine
        ? `<a href="my-reports.html" class="btn btn-secondary">${icon("edit")} <span data-i18n="manageBtn">Manage in My Reports</span></a>`
        : `${claimable ? `<button id="claim-btn" class="btn btn-primary">${icon("shield")} <span data-i18n="claimBtn">This is mine — verify &amp; claim</span></button>` : ""}
           <button id="msg-btn" class="btn btn-accent">${icon("message")} <span data-i18n="messageBtn">Message</span> ${esc(report.userName)}</button>`;

    // show how a previous claim was verified, if there was one
    const v = report.verification;
    let verifiedBanner = "";
    if (report.status === "Claimed" && v) {
        const conf = v.answerConfidence
            ? ` &middot; ${v.answerConfidence}% <span data-i18n="confidence">match confidence</span>`
            : "";
        verifiedBanner = `<div class="vz-banner">
               ${icon("checkCircle")}
               <div>
                   <strong data-i18n="verified">Ownership verified</strong>
                   <span><span data-i18n="claimedBy">Claimed by</span> ${esc(v.claimedByName)}${conf}</span>
               </div>
           </div>`;
    }

    detailDiv.style.display = "grid";
    detailDiv.className = "detail-grid fade-up";
    detailDiv.innerHTML = `
        <div class="detail-media">
            <img src="${esc(report.imageUrl)}" alt="${esc(report.title)}"
                 onerror="this.src='https://placehold.co/600x460/eef3f8/94a3b8?text=No+Image'">
            <div class="flags">${typeBadge}${statusBadge}</div>
        </div>
        <div class="detail-info">
            <div class="lang-bar">
                <span class="lang-bar-label">${icon("sparkles")} Read this in</span>
                <div class="lang-pills" role="group" aria-label="Translate listing">
                    <button type="button" class="lang-pill active" data-lang="en">English</button>
                    <button type="button" class="lang-pill" data-lang="zh">中文</button>
                    <button type="button" class="lang-pill" data-lang="ms">Melayu</button>
                    <button type="button" class="lang-pill" data-lang="ta">தமிழ்</button>
                </div>
                <span id="lang-status" class="lang-status"></span>
            </div>

            ${verifiedBanner}

            <h1 id="detail-title">${esc(report.title)}</h1>
            <div class="detail-reporter">
                <span class="av">${esc(String(report.userName || "?").charAt(0))}</span>
                <span data-i18n="reportedBy">Reported by</span> <strong style="color:var(--navy-800)">${esc(report.userName)}</strong>
                <span>&middot;</span> ${timeAgo(report.createdAt)}
            </div>

            <div class="detail-meta">
                <div class="detail-meta-row">
                    <span class="mi">${icon("pin")}</span>
                    <div><div class="ml" data-i18n="location">Location</div><div class="mv" id="detail-location">${esc(report.location)}</div></div>
                </div>
                <div class="detail-meta-row">
                    <span class="mi">${icon("calendar")}</span>
                    <div><div class="ml" data-i18n="${report.type === "lost" ? "dateLost" : "dateFound"}">Date ${report.type === "lost" ? "Lost" : "Found"}</div><div class="mv" id="detail-date">${formatDate(report.date)}</div></div>
                </div>
                <div class="detail-meta-row">
                    <span class="mi">${icon("tag")}</span>
                    <div><div class="ml" data-i18n="category">Category</div><div class="mv" id="detail-category">${esc(report.category)}</div></div>
                </div>
            </div>

            <div class="detail-section-title" data-i18n="description">Description</div>
            <p class="detail-desc" id="detail-desc">${esc(report.description)}</p>

            <div class="detail-section-title" data-i18n="labels">AI-Detected Labels · AWS Rekognition</div>
            <div class="ai-labels" id="detail-labels">${labels}</div>

            <div class="detail-actions">${actions}</div>
        </div>`;

    document.querySelectorAll(".lang-pill").forEach(btn => {
        btn.addEventListener("click", () => handleTranslate(btn));
    });

    const msgBtn = document.getElementById("msg-btn");
    if (msgBtn) msgBtn.addEventListener("click", handleMessage);

    const claimBtn = document.getElementById("claim-btn");
    if (claimBtn) claimBtn.addEventListener("click", () => openClaimWizard(report));
});


/* ---------- amazon translate ---------- */

/* the fixed headings and buttons never change, so they're translated once here
   rather than paying amazon translate for the same nine words on every click.
   only the listing's own words - title, description, location, category,
   labels - actually go through the api */
const UI_STRINGS = {
    location:    { zh: "地点",   ms: "Lokasi",  ta: "இடம்" },
    dateLost:    { zh: "遗失日期", ms: "Tarikh Hilang",   ta: "தொலைந்த தேதி" },
    dateFound:   { zh: "拾获日期", ms: "Tarikh Dijumpai", ta: "கண்டெடுக்கப்பட்ட தேதி" },
    category:    { zh: "类别",   ms: "Kategori", ta: "வகை" },
    description: { zh: "描述",   ms: "Penerangan", ta: "விவரம்" },
    labels:      { zh: "AI 识别标签 · AWS Rekognition",
                   ms: "Label Dikesan AI · AWS Rekognition",
                   ta: "AI கண்டறிந்த லேபிள்கள் · AWS Rekognition" },
    reportedBy:  { zh: "报告人", ms: "Dilaporkan oleh", ta: "புகாரளித்தவர்" },
    verified:    { zh: "所有权已验证", ms: "Pemilikan disahkan", ta: "உரிமை சரிபார்க்கப்பட்டது" },
    claimedBy:   { zh: "认领人", ms: "Dituntut oleh", ta: "உரிமை கோரியவர்" },
    confidence:  { zh: "匹配置信度", ms: "keyakinan padanan", ta: "பொருத்த நம்பகத்தன்மை" },
    lost:        { zh: "遗失", ms: "Hilang",   ta: "தொலைந்தது" },
    found:       { zh: "拾获", ms: "Dijumpai", ta: "கண்டெடுக்கப்பட்டது" },
    Open:        { zh: "开放", ms: "Terbuka",  ta: "திறந்திருக்கிறது" },
    Claimed:     { zh: "已认领", ms: "Dituntut", ta: "உரிமை கோரப்பட்டது" },
    Closed:      { zh: "已关闭", ms: "Ditutup",  ta: "மூடப்பட்டது" },
    claimBtn:    { zh: "这是我的 — 验证并认领",
                   ms: "Ini milik saya — sahkan & tuntut",
                   ta: "இது என்னுடையது — சரிபார்த்து உரிமை கோரு" },
    messageBtn:  { zh: "发消息给", ms: "Hantar mesej kepada", ta: "செய்தி அனுப்பு" },
    manageBtn:   { zh: "在“我的报告”中管理", ms: "Urus dalam Laporan Saya", ta: "எனது புகார்களில் நிர்வகி" },
};

// so dates read naturally in the chosen language too
const DATE_LOCALE = { en: "en-SG", zh: "zh-CN", ms: "ms-MY", ta: "ta-IN" };

function labelChips(list) {
    return (list || []).map(l => `<span class="chip">${icon("sparkles")}${esc(l)}</span>`).join("");
}

function renderLabels(list) {
    const el = document.getElementById("detail-labels");
    if (el) el.innerHTML = labelChips(list);
}

function uiString(key, lang) {
    if (lang === "en") return null;              // caller keeps the english
    const entry = UI_STRINGS[key];
    return (entry && entry[lang]) || null;
}

// swap every element carrying data-i18n="<key>"
function applyStaticStrings(lang) {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        if (!el.dataset.i18nEn) el.dataset.i18nEn = el.textContent;
        const translated = uiString(el.dataset.i18n, lang);
        el.textContent = translated || el.dataset.i18nEn;
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.textContent = value;
}

async function handleTranslate(btn) {
    const target = btn.dataset.lang;
    const titleEl = document.getElementById("detail-title");
    const descEl = document.getElementById("detail-desc");
    const status = document.getElementById("lang-status");
    const pills = document.querySelectorAll(".lang-pill");

    if (btn.classList.contains("active")) return;

    // back to the original, no api call needed
    if (target === "en") {
        titleEl.textContent = originalText.title;
        descEl.textContent = originalText.description;
        setText("detail-location", originalText.location);
        setText("detail-category", originalText.category);
        setText("detail-date", formatDate(originalText.date));
        renderLabels(originalText.labels);
        applyStaticStrings("en");
        status.textContent = "";
        pills.forEach(p => p.classList.toggle("active", p === btn));
        return;
    }

    const previous = document.querySelector(".lang-pill.active");
    pills.forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    btn.classList.add("loading");
    status.textContent = "Translating…";

    // one request carries the listing's own words; headings come from UI_STRINGS
    const extras = [originalText.location, originalText.category, ...originalText.labels];
    const result = await translateReport(
        originalText.title, originalText.description, target, extras
    );

    btn.classList.remove("loading");

    if (result.success) {
        if (result.title) titleEl.textContent = result.title;
        if (result.text) descEl.textContent = result.text;

        const back = result.extras || [];
        setText("detail-location", back[0]);
        setText("detail-category", back[1]);
        if (back.length > 2) renderLabels(back.slice(2));

        // dates aren't words, so we just reformat them for the locale
        const dateEl = document.getElementById("detail-date");
        if (dateEl && originalText.date) {
            try {
                dateEl.textContent = new Date(originalText.date)
                    .toLocaleDateString(DATE_LOCALE[target] || "en-SG",
                        { day: "numeric", month: "short", year: "numeric" });
            } catch (e) { /* leave it as it was */ }
        }

        applyStaticStrings(target);
        status.innerHTML = `${icon("check")} Amazon Translate`;
    } else {
        status.textContent = "";
        showToast(result.message || "Translation failed.", "error");
        pills.forEach(p => p.classList.remove("active"));
        if (previous) previous.classList.add("active");
    }
}


/* ---------- start a conversation ---------- */
/* hands off to the messages page with the details in the url, so the chat
   opens in the proper chat ui instead of a browser prompt box */
function handleMessage() {
    if (!getSession()) {
        showToast("Please log in to send a message.", "error");
        setTimeout(() => { window.location.href = "login.html?next=item-details.html"; }, 900);
        return;
    }

    const params = new URLSearchParams({
        to: currentReport.userId,
        name: currentReport.userName,
        reportId: currentReport.id,
        title: currentReport.title,
    });

    window.location.href = "messages.html?" + params.toString();
}

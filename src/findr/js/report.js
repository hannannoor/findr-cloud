/* ===== findr — Report Lost / Found page =====
   shared logic. Reads report type from <body data-report-type="lost|found">
   includes a live-updating preview card in the sidebar.
*/

const REPORT_TYPE = document.body.dataset.reportType || "lost";
let detectedLabels = [];
// the last description bedrock drafted, so we can tell our own text apart
// from something the user typed when a replacement photo comes in
let lastAiDescription = "";
let pickedCoords = null;
let reportMap = null;
let dropMarker = null;

document.addEventListener("DOMContentLoaded", () => {
    // default date = today
    const dateInput = document.getElementById("date");
    if (dateInput) dateInput.valueAsDate = new Date();

    // image input
    const imageInput = document.getElementById("image-input");
    if (imageInput) imageInput.addEventListener("change", handleImageUpload);

    // form submit
    const form = document.getElementById("report-form");
    if (form) form.addEventListener("submit", handleSubmitReport);

    // live preview wiring
    initPreview();

    // optional pin-drop map
    initReportMap();

    // AI Match (lost pages only)
    const matchBtn = document.getElementById("match-btn");
    if (matchBtn) matchBtn.addEventListener("click", runMatch);
});

/* ---------- AI Match ---------- */
function runMatch() {
    const panel = document.getElementById("match-panel");
    const scan = document.getElementById("match-scan");
    const bar = document.getElementById("scan-bar");
    const msg = document.getElementById("scan-msg");
    const grid = document.getElementById("match-grid");
    if (!panel) return;

    panel.style.display = "block";
    scan.style.display = "flex";
    grid.style.display = "none";
    panel.scrollIntoView({ behavior: "smooth", block: "center" });

    const msgs = [
        "Reading Rekognition labels…",
        "Comparing against found reports…",
        "Scoring label similarity…",
        "Ranking best matches…"
    ];
    let p = 0;
    bar.style.width = "0%";
    const iv = setInterval(() => {
        p += Math.random() * 13 + 6;
        if (p >= 100) p = 100;
        bar.style.width = p + "%";
        msg.textContent = msgs[Math.min(msgs.length - 1, Math.floor(p / 25))];
        if (p >= 100) {
            clearInterval(iv);
            setTimeout(showMatchResults, 350);
        }
    }, 120);
}

async function showMatchResults() {
    const scan = document.getElementById("match-scan");
    const grid = document.getElementById("match-grid");
    // an empty list is honest: /match returns 0 rather than matching everything
    const labels = detectedLabels;

    // findMatches hits the /match lambda now, so it's async.
    // we send the text too so bedrock can match on meaning, not just labels
    const matches = await findMatches(labels, {
        type: REPORT_TYPE,
        title: document.getElementById("title").value.trim(),
        description: document.getElementById("description").value.trim(),
        category: document.getElementById("category").value,
        location: document.getElementById("location").value,
    });

    scan.style.display = "none";

    if (!matches.length) {
        grid.style.display = "block";
        grid.innerHTML = `<div class="match-empty">${icon("search")}<p>No strong matches yet — we'll keep checking as new found items are reported.</p></div>`;
        return;
    }

    grid.style.display = "grid";
    grid.innerHTML = matches.map(m => {
        const r = m.report;
        const cls = m.percent >= 70 ? "match-high" : m.percent >= 40 ? "match-mid" : "match-low";
        // bedrock explains why it thinks these are the same item
        const why = m.reason ? `<div class="match-why">${icon("sparkles")} ${esc(m.reason)}</div>` : "";
        return `
        <a href="item-details.html?id=${encodeURIComponent(r.id)}" class="match-card">
            <span class="match-badge ${cls}">${m.percent}% match</span>
            <img src="${esc(r.imageUrl)}" onerror="this.src='https://placehold.co/120x120/eef3f8/94a3b8?text=?'" alt="${esc(r.title)}">
            <div class="match-card-info">
                <h4>${esc(r.title)}</h4>
                <div class="loc">${icon("pin")} ${esc(r.location)}</div>
                ${why}
                <div class="match-ring"><span class="match-bar"><span style="width:${m.percent}%"></span></span></div>
            </div>
        </a>`;
    }).join("");
}

/* ---------- live preview ---------- */
function initPreview() {
    // fixed badges (type from page, status always Open for a new report)
    const typeEl = document.getElementById("pv-type");
    const statusEl = document.getElementById("pv-status");
    if (typeEl) typeEl.innerHTML = getTypeBadge(REPORT_TYPE);
    if (statusEl) statusEl.innerHTML = getStatusBadge("Open");

    ["title", "description", "category", "location", "date"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", updatePreview);
            el.addEventListener("change", updatePreview);
        }
    });

    updatePreview();
}

function updatePreview() {
    const title = document.getElementById("title").value.trim();
    const desc = document.getElementById("description").value.trim();
    const category = document.getElementById("category").value;
    const location = document.getElementById("location").value;
    const date = document.getElementById("date").value;

    const titleEl = document.getElementById("pv-title");
    const descEl = document.getElementById("pv-desc");
    const locEl = document.getElementById("pv-loc");
    const dateEl = document.getElementById("pv-date");
    const labelsEl = document.getElementById("pv-labels");
    if (!titleEl) return;

    titleEl.innerHTML = title || `<span class="pv-muted">Your item name</span>`;
    descEl.innerHTML = desc || `<span class="pv-muted">Your description will appear here as you type…</span>`;
    locEl.innerHTML = `${icon("pin")} ${location || "Location"}`;
    dateEl.innerHTML = `${icon("calendar")} ${date ? formatDate(date) : "Date"}`;

    // labels: use detected AI labels, else fall back to the chosen category
    let chips = [];
    if (detectedLabels.length > 0) {
        chips = detectedLabels.slice(0, 3);
    } else if (category) {
        chips = [category];
    }
    labelsEl.innerHTML = chips.map(l => `<span class="chip">${icon("tag")}${l}</span>`).join("");
}

/* ---------- image upload + rekognition analysis ---------- */
async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // form preview + live preview image
    const reader = new FileReader();
    reader.onload = function (ev) {
        document.getElementById("preview-img").src = ev.target.result;
        document.getElementById("image-preview").style.display = "block";
        document.getElementById("upload-prompt").style.display = "none";

        // update sidebar live preview image
        const pvImg = document.getElementById("pv-img");
        const pvEmpty = document.getElementById("pv-empty");
        if (pvImg) { pvImg.src = ev.target.result; pvImg.style.display = "block"; }
        if (pvEmpty) pvEmpty.style.display = "none";
    };
    reader.readAsDataURL(file);

    // kick off the real rekognition + bedrock analysis
    const panel = document.getElementById("ai-panel");
    const labelsDiv = document.getElementById("ai-labels");
    panel.style.display = "block";
    labelsDiv.innerHTML = `<span class="ai-loading"><span class="spinner"></span> Analysing image with AWS Rekognition...</span>`;

    const result = await analyseImage(file);

    if (!result.success) {
        // moderation block, upload failure, or rekognition found nothing
        labelsDiv.innerHTML = `<span class="chip chip-error">${icon("alert")}${esc(result.message || "Couldn't analyse this image.")}</span>`;
        showToast(result.message || "Image analysis failed.", "error");
        return;
    }

    if (result.success) {
        detectedLabels = result.labelNames || [];

        // say plainly which model did the work. ours is stopped when not in use
        // (it bills by the hour) and the pretrained one stands in, so we never
        // let generic labels look like they came from our trained model
        const isFallback = result.customModelStatus === "off" || result.customModelStatus === "error";
        const banner = `
            <div class="ai-source ${isFallback ? "ai-source-fallback" : "ai-source-custom"}">
                ${icon(isFallback ? "alert" : "scan")}
                <span>${esc(result.sourceNotice || "")}</span>
            </div>`;

        // our trained model, always first
        const customGroup = result.customLabel ? `
            <div class="ai-group ai-group-primary">
                <div class="ai-group-head">${icon("scan")} Findr Custom Model</div>
                <div class="ai-group-body">
                    <span class="chip chip-custom"><strong>${esc(result.customLabel.Name)}</strong>
                        &middot; ${result.customLabel.Confidence.toFixed(0)}%</span>
                </div>
            </div>` : "";

        // aws pretrained, clearly demoted
        const genericGroup = (result.labels && result.labels.length) ? `
            <div class="ai-group ai-group-secondary">
                <div class="ai-group-head">${icon("sparkles")} AWS Rekognition (pretrained)</div>
                <div class="ai-group-body">
                    ${result.labels.map(l => `<span class="chip">${esc(l.Name)} &middot; ${l.Confidence.toFixed(0)}%</span>`).join("")}
                </div>
            </div>` : "";

        const caution = `
            <p class="ai-caution">${icon("alert")} Image recognition isn't always right —
               check the category and description before you submit.</p>`;

        labelsDiv.innerHTML = banner + customGroup + genericGroup + caution;

        // fill the box when it's empty, and refresh it when it still holds the
        // previous draft. anything the user typed themselves is left alone
        const descBox = document.getElementById("description");
        if (result.aiDescription && descBox) {
            const current = descBox.value.trim();
            if (!current || current === lastAiDescription) {
                descBox.value = result.aiDescription;
                lastAiDescription = result.aiDescription;
                showToast("Description drafted from your photo — edit it if you like.");
            } else {
                showToast("New description available — clear the box to use it.");
            }
        }

        // auto-fill category (tolerant match: "Key" -> "Keys", etc.)
        const categorySelect = document.getElementById("category");
        const suggested = (result.suggestedCategory || "").toLowerCase();
        for (let option of categorySelect.options) {
            const val = option.value.toLowerCase();
            if (!val) continue;
            if (val === suggested || val === suggested + "s" || suggested === val + "s") {
                categorySelect.value = option.value;
                break;
            }
        }

        updatePreview();

        // reveal the AI Match button (lost pages only)
        const matchBtn = document.getElementById("match-btn");
        if (matchBtn) matchBtn.style.display = "inline-flex";
    }
}

/* ---------- submit ---------- */
async function handleSubmitReport(e) {
    e.preventDefault();

    const btn = document.getElementById("submit-btn");
    const originalText = btn.textContent;
    btn.textContent = "Submitting...";
    btn.disabled = true;

    const reportData = {
        type: REPORT_TYPE,
        title: document.getElementById("title").value.trim(),
        description: document.getElementById("description").value.trim(),
        category: document.getElementById("category").value,
        location: document.getElementById("location").value,
        date: document.getElementById("date").value,
        lat: pickedCoords ? pickedCoords.lat : undefined,
        lng: pickedCoords ? pickedCoords.lng : undefined,
        rekognitionLabels: detectedLabels
    };

    // private verification info, found items only. the api stores these but
    // never sends them back out to anyone
    const details = ["secret-1", "secret-2", "secret-3"]
        .map(id => document.getElementById(id))
        .filter(el => el && el.value.trim())
        .map(el => el.value.trim());

    if (details.length) reportData.secretDetails = details;


    const result = await submitReport(reportData);

    if (result.success) {
        // the preview card flies to the centre, confirms, then zips into my reports
        playSubmitCelebration(result.report);
    } else {
        showToast(result.message || "Something went wrong - please try again.", "error");
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

/* ---------- optional pin-drop map ---------- */
function initReportMap() {
    const el = document.getElementById("report-map");
    if (!el) return;

    // no maplibre or no key configured, just hide the map bit
    if (typeof maplibregl === "undefined" || LOCATION_API_KEY.startsWith("PASTE_")) {
        el.parentElement.style.display = "none";
        return;
    }

    reportMap = new maplibregl.Map({
        container: el,
        style: MAP_STYLE_URL,
        center: [103.93200, 1.34510],   // maplibre wants [lng, lat]
        zoom: 16.5,
        minZoom: 14,
        maxZoom: 20,
        attributionControl: false
    });

    reportMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    reportMap.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "© Amazon Location Service"
    }), "bottom-right");

    reportMap.on("error", () => {
        el.parentElement.style.display = "none";
    });

    reportMap.on("click", (e) => {
        // e.lngLat already has .lat and .lng, which is what we send to the api
        pickedCoords = { lat: e.lngLat.lat, lng: e.lngLat.lng };

        if (dropMarker) {
            dropMarker.setLngLat(e.lngLat);
        } else {
            const pin = document.createElement("div");
            pin.className = "drop-pin-wrap";
            pin.innerHTML = '<div class="drop-pin"></div>';
            dropMarker = new maplibregl.Marker({ element: pin, anchor: "center" })
                .setLngLat(e.lngLat)
                .addTo(reportMap);
        }

        const hint = document.getElementById("pin-hint");
        if (hint) hint.innerHTML = "Pin dropped &mdash; your item will show exactly here on the campus map.";
    });
}

/* ---------- submit celebration ----------
   the live preview card the user has been building lifts off,
   flies to the middle of the screen, gets stamped with a green check,
   then shrinks and zips up into the my reports nav link before we go there */
function playSubmitCelebration(report) {
    const card = document.querySelector(".preview-card");
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // let the my reports page know a fresh one just arrived so it can glow
    if (report && report.id) {
        try { sessionStorage.setItem("findr_new_report", report.id); } catch (e) { /* ignore */ }
    }

    // no card to fly (or the user prefers less motion), keep it simple
    if (!card || reduced) {
        showToast(`${REPORT_TYPE === "lost" ? "Lost" : "Found"} item reported successfully!`);
        setTimeout(() => document.body.classList.add("page-leave"), 850);
        setTimeout(() => { window.location.href = "my-reports.html"; }, 1020);
        return;
    }

    const rect = card.getBoundingClientRect();

    // dark blurred backdrop behind the flying card
    const overlay = document.createElement("div");
    overlay.className = "fly-overlay";
    document.body.appendChild(overlay);

    // clone the preview card exactly where it sits so we can move it freely
    const clone = card.cloneNode(true);
    clone.classList.add("fly-card");
    clone.style.top = rect.top + "px";
    clone.style.left = rect.left + "px";
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px"; // .card normally uses height 100%, pin it down
    document.body.appendChild(clone);

    // confirmation layer that stamps on once the card lands
    const stamp = document.createElement("div");
    stamp.className = "fly-check";
    stamp.innerHTML = `
        <div>
            <span class="fly-check-ico">${ICONS.checkCircle}</span>
            <div class="t">Report submitted!</div>
            <div class="s">Adding it to your reports&hellip;</div>
        </div>`;
    clone.appendChild(stamp);

    // double raf so the browser paints the starting position before we fly
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add("show");
        clone.style.top = "50%";
        clone.style.left = "50%";
        clone.classList.add("centered");
    }));

    // land, then stamp the green check
    setTimeout(() => clone.classList.add("confirmed"), 1150);

    // hold the moment, then shrink and zip up into the my reports nav link
    setTimeout(() => {
        overlay.classList.remove("show");
        const target = document.querySelector('.navbar-links a[href="my-reports.html"]');
        const t = target ? target.getBoundingClientRect() : null;
        if (t && t.width > 0) {
            clone.classList.add("zip");
            clone.style.top = (t.top + t.height / 2) + "px";
            clone.style.left = (t.left + t.width / 2) + "px";
            target.classList.add("pulse-target");
        } else {
            // nav link hidden (mobile menu), just fade out instead
            clone.classList.add("leave");
        }
    }, 2350);

    // gentle page fade right as the card disappears, so the swap doesnt flash
    setTimeout(() => document.body.classList.add("page-leave"), 3050);
    // and off to my reports where the new row glows
    setTimeout(() => { window.location.href = "my-reports.html"; }, 3250);
}

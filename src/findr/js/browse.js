/* ===== findr — Browse page ===== */

document.addEventListener("DOMContentLoaded", () => {
    // pre-fill search from URL (?search=)
    const params = new URLSearchParams(window.location.search);
    const preSearch = params.get("search");
    const preType = params.get("type");
    const preStatus = params.get("status");
    const preCategory = params.get("category");
    if (preSearch) document.getElementById("search-input").value = preSearch;
    if (preType) document.getElementById("filter-type").value = preType;
    if (preStatus) document.getElementById("filter-status").value = preStatus;
    if (preCategory) document.getElementById("filter-category").value = preCategory;

    loadReports();

    let searchTimeout;
    document.getElementById("search-input").addEventListener("input", () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadReports, 250);
    });
    document.getElementById("filter-type").addEventListener("change", loadReports);
    document.getElementById("filter-category").addEventListener("change", loadReports);
    document.getElementById("filter-status").addEventListener("change", loadReports);

    document.querySelectorAll(".lang-pill").forEach(btn => {
        btn.addEventListener("click", () => handleBrowseTranslate(btn));
    });
});

/* the reports exactly as the api sent them. every translation starts from
   these, so switching zh -> ta doesn't feed chinese back into translate */
let originalReports = [];
let currentLang = "en";

async function loadReports() {
    const search = document.getElementById("search-input").value.trim();
    const type = document.getElementById("filter-type").value;
    const category = document.getElementById("filter-category").value;
    const status = document.getElementById("filter-status").value;

    const filters = {};
    if (search) filters.search = search;
    if (type) filters.type = type;
    if (category) filters.category = category;
    if (status) filters.status = status;

    const data = await getReports(filters);
    const grid = document.getElementById("reports-grid");
    const empty = document.getElementById("empty-state");
    const count = document.getElementById("result-count");

    if (data.success && data.reports.length > 0) {
        originalReports = data.reports;
        count.innerHTML = `Showing <strong>${data.reports.length}</strong> report${data.reports.length !== 1 ? "s" : ""}`;
        grid.style.display = "grid";
        empty.style.display = "none";
        grid.innerHTML = data.reports.map(reportCardHTML).join("");

        // filters reload the grid in english, so reset the picker to match
        currentLang = "en";
        document.querySelectorAll(".lang-pill").forEach(p =>
            p.classList.toggle("active", p.dataset.lang === "en"));
        const st = document.getElementById("lang-status");
        if (st) st.textContent = "";
    } else {
        count.innerHTML = "";
        grid.style.display = "none";
        empty.style.display = "block";
    }
}


/* ---------- amazon translate over the results grid ---------- */

// how many cards we translate in one go. each card now costs four short calls
// (title, description, location, first label), so this keeps us inside both
// the lambda timeout and the 40-string cap on the api
const TRANSLATE_CARD_LIMIT = 9;

async function handleBrowseTranslate(btn) {
    const target = btn.dataset.lang;
    const status = document.getElementById("lang-status");
    const grid = document.getElementById("reports-grid");
    const pills = document.querySelectorAll(".lang-pill");

    if (btn.classList.contains("active") || !originalReports.length) return;

    // english is what we already hold, no api call needed
    if (target === "en") {
        currentLang = "en";
        grid.innerHTML = originalReports.map(reportCardHTML).join("");
        status.textContent = "";
        pills.forEach(p => p.classList.toggle("active", p === btn));
        return;
    }

    const previous = document.querySelector(".lang-pill.active");
    pills.forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    btn.classList.add("loading");
    status.textContent = "Translating…";

    // title and description for each card, flattened in pairs
    // four strings per card, flattened. the card only shows one label chip
    // row, so we translate the first label and leave the rest as they are
    const slice = originalReports.slice(0, TRANSLATE_CARD_LIMIT);
    const extras = [];
    slice.forEach(r => extras.push(
        r.title || "", r.description || "", r.location || "",
        (r.rekognitionLabels && r.rekognitionLabels[0]) || ""
    ));

    const result = await translateReport("", "", target, extras);

    btn.classList.remove("loading");

    if (result.success && result.extras) {
        const back = result.extras;
        const shown = originalReports.map((r, i) => {
            if (i >= slice.length) return r;               // past the cap, leave english
            const b = i * 4;
            const labels = (r.rekognitionLabels || []).slice();
            if (labels.length && back[b + 3]) labels[0] = back[b + 3];
            return { ...r,
                title: back[b] || r.title,
                description: back[b + 1] || r.description,
                location: back[b + 2] || r.location,
                rekognitionLabels: labels };
        });
        currentLang = target;
        grid.innerHTML = shown.map(reportCardHTML).join("");
        status.innerHTML = `${typeof icon === "function" ? icon("check") : ""} Amazon Translate`;
    } else {
        status.textContent = "";
        showToast((result && result.message) || "Translation failed.", "error");
        pills.forEach(p => p.classList.remove("active"));
        if (previous) previous.classList.add("active");
    }
}

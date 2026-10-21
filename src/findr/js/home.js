/* ===== findr — Home page ===== */

document.addEventListener("DOMContentLoaded", async () => {
    // hero search -> redirect to browse
    const heroSearch = document.getElementById("hero-search-input");
    if (heroSearch) {
        heroSearch.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                const q = heroSearch.value.trim();
                window.location.href = "browse.html" + (q ? "?search=" + encodeURIComponent(q) : "");
            }
        });
    }
    const heroSearchBtn = document.getElementById("hero-search-btn");
    if (heroSearchBtn) {
        heroSearchBtn.addEventListener("click", () => {
            const q = heroSearch.value.trim();
            window.location.href = "browse.html" + (q ? "?search=" + encodeURIComponent(q) : "");
        });
    }

    // load reports once — used for both the recent grid and the live stats
    const data = await getReports();
    if (!data.success) return;
    const reports = data.reports;

    // recent reports grid
    const container = document.getElementById("recent-reports");
    if (container && reports.length > 0) {
        container.innerHTML = reports.slice(0, 3).map(reportCardHTML).join("");
    }

    // live stats band — real counts from the app's data, no made-up numbers
    const setStat = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = val;               // visible immediately, even without animation
        el.setAttribute("data-count", val); // then the count-up animation takes over
    };
    setStat("stat-reported", reports.length);
    setStat("stat-recovered", reports.filter(r => r.status === "Claimed" || r.status === "Closed").length);
    setStat("stat-open", reports.filter(r => r.status === "Open").length);
    setStat("stat-claimed", reports.filter(r => r.status === "Claimed").length);
    if (typeof initCountUp === "function") initCountUp();
});

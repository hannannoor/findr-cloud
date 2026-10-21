/* ===== findr — UI hydration + navbar controller =====
   - fills static [data-ico] placeholders with SVG icons
   - floating glass navbar: transparent over hero, solid on scroll
   - sliding pill indicator behind nav links
   - offsets page content for the fixed navbar
*/

document.addEventListener("DOMContentLoaded", () => {
    hydrateIcons();
    initNavbar();
    initCountUp();
    initScrollReveal();
    initPageTransitions();
});

/* count-up animation for [data-count] numbers */
function initCountUp() {
    const els = document.querySelectorAll("[data-count]");
    if (!els.length) return;
    const animate = (el) => {
        const target = parseInt(el.getAttribute("data-count"), 10) || 0;
        const suffix = el.getAttribute("data-suffix") || "";
        const dur = 1100;
        let start = null;
        const step = (ts) => {
            if (!start) start = ts;
            const prog = Math.min((ts - start) / dur, 1);
            const val = Math.floor((1 - Math.pow(1 - prog, 3)) * target);
            el.innerHTML = val + `<span class="u">${suffix}</span>`;
            if (prog < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };
    if ("IntersectionObserver" in window) {
        const obs = new IntersectionObserver((entries, o) => {
            entries.forEach(e => { if (e.isIntersecting) { animate(e.target); o.unobserve(e.target); } });
        }, { threshold: 0.4 });
        els.forEach(el => obs.observe(el));
    } else {
        els.forEach(animate);
    }
}

/* scroll-reveal — added by JS so content stays visible if JS is off */
function initScrollReveal() {
    const targets = document.querySelectorAll(".section-header, .feature, .step, .cta-band, .stats-band, .card-grid > *");
    if (!targets.length) return;
    if (!("IntersectionObserver" in window)) return;
    const obs = new IntersectionObserver((entries, o) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); o.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    targets.forEach(el => { el.classList.add("reveal"); obs.observe(el); });
    // safety: reveal everything after 2s no matter what
    setTimeout(() => targets.forEach(el => el.classList.add("in")), 2000);
}

function hydrateIcons() {
    document.querySelectorAll("[data-ico]").forEach(el => {
        const name = el.getAttribute("data-ico");
        if (ICONS[name]) el.innerHTML = ICONS[name];
    });
    const toggleIcon = document.querySelector(".menu-toggle .icon");
    if (toggleIcon && !toggleIcon.innerHTML.trim()) toggleIcon.innerHTML = ICONS.menu;
    const heroIco = document.getElementById("hero-search-ico");
    if (heroIco) heroIco.innerHTML = ICONS.search;
}

function initNavbar() {
    const nav = document.querySelector(".navbar");
    if (!nav) return;

    renderNavAuth(nav);

    const hasHero = !!document.querySelector(".hero, .page-hero");

    // --- fixed-nav offset ---
    const applyOffset = () => {
        const h = nav.offsetHeight;
        if (!hasHero) {
            // pages with no hero: push all content below the fixed nav
            document.body.style.paddingTop = h + "px";
        }
    };

    // --- transparent over hero, solid on scroll ---
    const onScroll = () => {
        const transparent = hasHero && window.scrollY < 40;
        nav.classList.toggle("transparent", transparent);
    };
    if (hasHero) {
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
    } else {
        nav.classList.remove("transparent");
    }

    // --- sliding pill indicator ---
    const links = nav.querySelector(".navbar-links");
    let moveToActive = () => {};
    if (links) {
        const indicator = document.createElement("span");
        indicator.className = "nav-indicator";
        links.prepend(indicator);

        const anchors = Array.from(links.querySelectorAll("a"));
        const activeAnchor = () => links.querySelector("a.active"); // null if none active

        const moveTo = (el) => {
            if (!el || window.innerWidth <= 768) { indicator.classList.remove("show"); return; }
            indicator.style.width = el.offsetWidth + "px";
            indicator.style.transform = `translate(${el.offsetLeft}px, -50%)`;
            indicator.classList.add("show");
        };
        moveToActive = () => moveTo(activeAnchor());

        anchors.forEach(a => a.addEventListener("mouseenter", () => moveTo(a)));
        links.addEventListener("mouseleave", moveToActive);

        // drop the pill straight onto this page's link with no animation,
        // it only slides when the user hovers around the nav
        const placeInstantly = () => {
            indicator.style.transition = "none";
            moveToActive();
            void indicator.offsetWidth; // force reflow so the placement doesnt animate
            indicator.style.transition = "";
        };
        placeInstantly();
        // re-position after web fonts load (link widths change)
        setTimeout(placeInstantly, 350);
        window.addEventListener("load", placeInstantly);
    }

    applyOffset();
    window.addEventListener("resize", () => { applyOffset(); moveToActive(); });
}

/* logged-in navbar: swap Log In / Sign Up for a profile menu */
function renderNavAuth(nav) {
    const auth = nav.querySelector(".navbar-auth");
    const user = (typeof getSession === "function") ? getSession() : null;
    if (!auth || !user) return;

    // admins get the dashboard in the main nav, not buried in the dropdown
    if (user.role === "admin") {
        const links = nav.querySelector(".navbar-links");
        if (links && !links.querySelector('a[href="admin.html"]')) {
            const here = window.location.pathname.split("/").pop();
            const li = document.createElement("li");
            li.innerHTML = `<a href="admin.html" class="nav-admin${here === "admin.html" ? " active" : ""}">
                ${ICONS.shield} Admin</a>`;
            links.appendChild(li);
        }
    }

    auth.innerHTML = `
        <div class="profile-menu">
            <button class="profile-btn" id="profile-btn" aria-label="Account menu" aria-haspopup="true">
                <span class="profile-avatar">${user.name.charAt(0).toUpperCase()}</span>
            </button>
            <div class="profile-drop" id="profile-drop">
                <div class="profile-drop-head">
                    <strong>${user.name}</strong>
                    <span>${user.email}</span>
                </div>
                <a href="my-reports.html">${ICONS.box} My Reports</a>
                <a href="messages.html">${ICONS.message} Messages</a>
                <a href="account.html">${ICONS.settings} Account settings</a>
                ${user.role === "admin" ? `<a href="admin.html">${ICONS.settings} Admin</a>` : ""}
                <button id="logout-btn">${ICONS.logout} Log out</button>
            </div>
        </div>`;

    const btn = document.getElementById("profile-btn");
    const drop = document.getElementById("profile-drop");
    btn.addEventListener("click", (e) => { e.stopPropagation(); drop.classList.toggle("open"); });
    document.addEventListener("click", () => drop.classList.remove("open"));
    document.getElementById("logout-btn").addEventListener("click", () => {
        clearSession();
        if (typeof showToast === "function") showToast("Logged out. See you soon!");
        setTimeout(() => { window.location.href = "index.html"; }, 500);
    });
}

/* soft fade + rise between pages.
   JS-driven (not CSS View Transitions) so it also works from file:// and in every browser:
   internal link clicks fade the page out briefly, then navigate; the new page rises in via CSS. */
function initPageTransitions() {
    // coming back via the back/forward cache: make sure the page isn't stuck faded out
    window.addEventListener("pageshow", (e) => {
        if (e.persisted) document.body.classList.remove("page-leave");
    });

    document.addEventListener("click", (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target.closest("a[href]");
        if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || /^https?:/i.test(href)) return;

        e.preventDefault();
        document.body.classList.add("page-leave");
        setTimeout(() => { window.location.href = href; }, 170);
    });
}

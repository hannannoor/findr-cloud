/* findr campus map page
   now drawn with amazon location service tiles via maplibre gl js instead of
   the old openstreetmap/leaflet setup. every report is a photo pin, clicking
   one opens a detail card, and the filter chips + list drawer work as before

   heads up if you're reading this after leaflet: maplibre wants coordinates as
   [lng, lat], leaflet wanted [lat, lng]. easy way to lose an afternoon
*/

// amazon location config lives in api.js so the report form can use it too

const CAMPUS_CENTER = [103.93200, 1.34510];   // [lng, lat] — temasek polytechnic

const ZONES = [
    { id: "library", label: "Library",          lat: 1.34523, lng: 103.93168 },
    { id: "lecture", label: "Lecture Theatres", lat: 1.34462, lng: 103.93318 },
    { id: "canteen", label: "Canteens",         lat: 1.34615, lng: 103.93052 },
    { id: "study",   label: "Study Areas",      lat: 1.34572, lng: 103.93268 },
    { id: "sports",  label: "Sports Complex",   lat: 1.34298, lng: 103.93118 },
    { id: "gate",    label: "Main Gate & Bus",  lat: 1.34700, lng: 103.93368 },
    { id: "other",   label: "Around Campus",    lat: 1.34510, lng: 103.93200 }
];

let allReports = [];
let map = null;
let markers = [];
let activeFilter = "all";   // all | lost | found

document.addEventListener("DOMContentLoaded", async () => {
    const data = await getReports();
    allReports = data.success ? data.reports : [];

    initMap();
    renderDrawer();

    document.querySelectorAll(".fchip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".fchip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            activeFilter = chip.dataset.filter;
            renderMarkers();
            renderDrawer();
        });
    });

    const drawer = document.getElementById("map-drawer");
    document.getElementById("drawer-toggle").addEventListener("click", () => drawer.classList.toggle("open"));
    document.getElementById("drawer-close").addEventListener("click", () => drawer.classList.remove("open"));
});

function filteredReports() {
    if (activeFilter === "all") return allReports;
    return allReports.filter(r => r.type === activeFilter);
}

/* ---------- stable scatter around the report's zone ---------- */

// tiny hash so the same report id always lands in the same spot
function hashOf(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// returns [lng, lat] for maplibre
function positionFor(report) {
    // reports submitted with a dropped pin carry real coordinates
    if (typeof report.lat === "number" && typeof report.lng === "number") {
        return [report.lng, report.lat];
    }
    const zone = ZONES.find(z => z.id === zoneOf(report.location)) || ZONES[ZONES.length - 1];
    const h = hashOf(String(report.id) + report.location);
    const angle = (h % 360) * (Math.PI / 180);
    // roughly 10m to 45m from the zone centre so pins don't stack
    const radius = 0.00010 + ((h >> 9) % 100) / 100 * 0.00035;
    return [
        zone.lng + Math.cos(angle) * radius * 1.25,
        zone.lat + Math.sin(angle) * radius
    ];
}

/* ---------- the little detail card that opens on the map ---------- */

function cardHTML(r) {
    return `
    <div class="map-card">
        <div class="map-card-media">
            <img src="${esc(r.imageUrl)}" alt="${esc(r.title)}"
                 onerror="this.src='https://placehold.co/400x220/eef3f8/94a3b8?text=No+photo'">
            <span class="type-flag">${getTypeBadge(r.type)}</span>
        </div>
        <div class="map-card-body">
            <h4>${esc(r.title)}</h4>
            <div class="map-card-meta">
                <span>${ICONS.pin} ${esc(r.location)}</span>
                <span>${ICONS.calendar} ${formatDate(r.date)}</span>
            </div>
            <div class="map-card-actions">
                <a href="item-details.html?id=${r.id}" class="btn btn-sm btn-secondary">More details ${ICONS.arrowRight}</a>
            </div>
        </div>
    </div>`;
}

/* ---------- map setup ---------- */

function initMap() {
    const container = document.getElementById("campus-map");

    // the map library comes from a cdn, so this fires if that request failed
    if (typeof maplibregl === "undefined") {
        console.error("MapLibre GL JS did not load - check the CDN request in the Network tab");
        container.innerHTML = `<div class="map-fallback">
            <h3>Map library didn't load</h3>
            <p>The map library couldn't be downloaded. Check your connection<br>
               and refresh the page &mdash; the pins are still listed under "View list".</p></div>`;
        return;
    }

    if (LOCATION_API_KEY.startsWith("PASTE_")) {
        container.innerHTML = `<div class="map-fallback">
            <h3>Map not configured</h3>
            <p>Add your Amazon Location Service API key in <code>js/api.js</code>.</p></div>`;
        return;
    }

    map = new maplibregl.Map({
        container: container,
        style: MAP_STYLE_URL,
        center: CAMPUS_CENTER,
        zoom: 16,
        minZoom: 14,
        maxZoom: 20,
        // keep people roughly around campus  [[west, south], [east, north]]
        maxBounds: [[103.9150, 1.3330], [103.9500, 1.3580]],
        attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "© Amazon Location Service"
    }), "bottom-right");

    // markers can only be added once the style has actually loaded
    map.on("load", renderMarkers);

    // if the key is wrong or expired we get a style error, say so rather than
    // leaving a blank grey box
    map.on("error", (e) => {
        console.error("Map error:", e && e.error ? e.error : e);
        if (!map.isStyleLoaded()) {
            container.innerHTML = `<div class="map-fallback">
                <h3>Map couldn't load</h3>
                <p>Amazon Location Service rejected the request.<br>
                   Check the API key in <code>js/api.js</code>.</p></div>`;
        }
    });
}

function renderMarkers() {
    if (!map) return;

    markers.forEach(m => m.remove());
    markers = [];

    filteredReports().forEach(r => {
        // plain html element as the marker, so the photo pin styling still applies
        const el = document.createElement("div");
        el.className = "findr-pin-wrap";
        el.innerHTML = `<div class="findr-pin ${String(r.type || "").replace(/[^a-z]/gi, "")}"></div>`;
        // set as a property, not inside the html. presigned urls already contain
        // percent escapes, and running them through an encoder a second time
        // turns %2F into %252F and breaks the signature
        if (r.imageUrl) {
            el.firstElementChild.style.backgroundImage =
                `url("${String(r.imageUrl).replace(/"/g, "%22")}")`;
        }
        el.title = r.title;

        const popup = new maplibregl.Popup({
            offset: 26,
            maxWidth: "280px",
            className: "findr-popup",
            closeButton: true
        }).setHTML(cardHTML(r));

        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat(positionFor(r))
            .setPopup(popup)
            .addTo(map);

        markers.push(marker);
    });
}

/* ---------- slide in drawer with the report list ---------- */

function renderDrawer() {
    const eyebrow = document.getElementById("drawer-eyebrow");
    const title = document.getElementById("drawer-title");
    const list = document.getElementById("drawer-list");
    const items = filteredReports();

    const label = activeFilter === "all" ? "All reports"
        : activeFilter === "lost" ? "Lost items" : "Found items";
    eyebrow.textContent = label;
    title.textContent = `${items.length} on the map`;

    if (items.length === 0) {
        list.innerHTML = `<div class="empty-state" style="padding:2rem 1rem;">
            <div class="empty-ico"><span class="icon">${ICONS.pin}</span></div>
            <h3>Nothing here yet</h3><p>No ${activeFilter === "all" ? "" : activeFilter + " "}reports right now.</p></div>`;
        return;
    }

    list.innerHTML = items.map(r => `
        <a href="item-details.html?id=${encodeURIComponent(r.id)}" class="zone-item">
            <img src="${esc(r.imageUrl)}" alt="${esc(r.title)}" onerror="this.src='https://placehold.co/120x120/eef3f8/94a3b8?text=?'">
            <div class="zone-item-info">
                <div class="zone-item-top">${getTypeBadge(r.type)}${getStatusBadge(r.status)}</div>
                <div class="zone-item-title">${esc(r.title)}</div>
                <div class="zone-item-meta">${ICONS.pin} ${esc(r.location)}</div>
            </div>
        </a>`).join("");
}

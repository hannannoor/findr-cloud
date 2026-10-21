/* findr my reports page
   lists the signed in user's own reports with edit / mark claimed / delete
   scoped to the signed in cognito user and persisted via api gateway -> lambda
*/

let myReports = [];
let editingId = null;
let editMap = null;
let editMarker = null;
let editCoords = null;

document.addEventListener("DOMContentLoaded", async () => {
    // authenticated route: the api scopes it to us and hands back our own
    // secretDetails, which the public /reports list can never do
    const data = await getMyReports();
    myReports = data.success ? data.reports : [];
    if (!data.success) showToast(data.message || "Couldn't load your reports.", "error");
    renderTable();

    // if the user just submitted a report, make its fresh row glow for a moment
    let newId = null;
    try { newId = sessionStorage.getItem("findr_new_report"); sessionStorage.removeItem("findr_new_report"); } catch (e) { /* ignore */ }
    if (newId) {
        const row = document.querySelector(`#mr-body tr[data-id="${newId}"]`);
        if (row) {
            row.classList.add("row-arrive");
            showToast("Added to your reports!");
        }
    }

    wireRowClicks();

    // wire up the edit popup
    document.getElementById("edit-form").addEventListener("submit", handleSave);
    document.getElementById("edit-close").addEventListener("click", closeModal);
    document.getElementById("edit-cancel").addEventListener("click", closeModal);
    document.getElementById("edit-overlay").addEventListener("click", (e) => {
        if (e.target.id === "edit-overlay") closeModal();
    });
});

function renderTable() {
    const body = document.getElementById("mr-body");
    const empty = document.getElementById("mr-empty");
    const table = document.getElementById("mr-table");

    // no reports yet, show the empty state instead of a bare table
    if (myReports.length === 0) {
        table.style.display = "none";
        empty.style.display = "block";
        return;
    }
    table.style.display = "";
    empty.style.display = "none";

    body.innerHTML = myReports.map(r => `
        <tr data-id="${r.id}" class="mr-row" tabindex="0" role="link"
            aria-label="Open ${esc(r.title)}">
            <td style="width:64px;"><img class="mr-thumb" src="${esc(r.imageUrl)}" alt="" onerror="this.src='https://placehold.co/104x104/eef3f8/94a3b8?text=?'"></td>
            <td>
                <a href="item-details.html?id=${encodeURIComponent(r.id)}">${esc(r.title)}</a><br>
                <code>${esc(r.location)}</code>
            </td>
            <td>${getTypeBadge(r.type)}</td>
            <td>${getStatusBadge(r.status)}</td>
            <td style="white-space:nowrap;">${formatDate(r.date)}</td>
            <td>
                <div class="mr-actions">
                    <button class="btn btn-sm btn-secondary" onclick="openEdit('${r.id}')"><span class="icon">${ICONS.edit}</span> Edit</button>
                    ${r.status === "Open" ? `<button class="btn btn-sm btn-secondary" onclick="markClaimed('${r.id}')"><span class="icon">${ICONS.checkCircle}</span> Claimed</button>` : ""}
                    <button class="btn btn-sm btn-danger" onclick="removeReport('${r.id}')" aria-label="Delete report"><span class="icon">${ICONS.trash}</span></button>
                </div>
            </td>
        </tr>`).join("");
}

/* the row is clickable, not just the title. clicks that land on a button or a
   real link are left alone so Edit/Claimed/Delete still work */
function wireRowClicks() {
    const body = document.getElementById("mr-body");
    if (!body) return;

    body.addEventListener("click", (e) => {
        if (e.target.closest("button, a")) return;
        const row = e.target.closest("tr[data-id]");
        if (row) window.location.href = "item-details.html?id=" + encodeURIComponent(row.dataset.id);
    });

    // keyboard users get the same thing
    body.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest("button, a")) return;
        const row = e.target.closest("tr[data-id]");
        if (row) {
            e.preventDefault();
            window.location.href = "item-details.html?id=" + encodeURIComponent(row.dataset.id);
        }
    });
}

// fill the popup with the report's current values then show it
function openEdit(id) {
    const r = myReports.find(x => x.id === id);
    if (!r) return;
    editingId = id;

    document.getElementById("edit-title").value = r.title;
    document.getElementById("edit-description").value = r.description;
    document.getElementById("edit-category").value = r.category;
    document.getElementById("edit-location").value = r.location;
    document.getElementById("edit-date").value = r.date;
    document.getElementById("edit-status").value = r.status;

    // only found items carry verification details, and the api only returns
    // them to whoever wrote them
    const secretsGroup = document.getElementById("edit-secrets-group");
    if (secretsGroup) {
        secretsGroup.hidden = r.type !== "found";
        const existing = r.secretDetails || [];
        for (let i = 0; i < 3; i++) {
            document.getElementById(`edit-secret-${i + 1}`).value = existing[i] || "";
        }
    }

    // existing pin, if the report has one
    editCoords = (typeof r.lat === "number" && typeof r.lng === "number")
        ? { lat: r.lat, lng: r.lng }
        : null;

    document.getElementById("edit-overlay").classList.add("active");

    // maplibre needs the container visible before it measures itself, so
    // build the map after the modal is on screen
    setTimeout(initEditMap, 60);
}

function initEditMap() {
    const el = document.getElementById("edit-map");
    if (!el) return;

    if (typeof maplibregl === "undefined" || LOCATION_API_KEY.startsWith("PASTE_")) {
        el.parentElement.style.display = "none";
        return;
    }
    el.parentElement.style.display = "";

    const centre = editCoords ? [editCoords.lng, editCoords.lat] : [103.93200, 1.34510];

    // reuse the map across opens, just recentre it
    if (editMap) {
        editMap.resize();
        editMap.setCenter(centre);
        placeEditMarker(centre);
        return;
    }

    editMap = new maplibregl.Map({
        container: el,
        style: MAP_STYLE_URL,
        center: centre,
        zoom: 16.5,
        minZoom: 14,
        maxZoom: 20,
        attributionControl: false,
    });

    editMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    editMap.on("error", () => { el.parentElement.style.display = "none"; });
    editMap.on("load", () => { editMap.resize(); placeEditMarker(centre); });

    editMap.on("click", (e) => {
        editCoords = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        placeEditMarker([e.lngLat.lng, e.lngLat.lat]);
        const hint = document.getElementById("edit-pin-hint");
        if (hint) hint.textContent = "Pin moved — save to update where this shows on the map.";
    });
}

function placeEditMarker(lngLat) {
    if (!editMap || !editCoords) return;
    if (editMarker) {
        editMarker.setLngLat(lngLat);
    } else {
        const pin = document.createElement("div");
        pin.className = "drop-pin-wrap";
        pin.innerHTML = '<div class="drop-pin"></div>';
        editMarker = new maplibregl.Marker({ element: pin, anchor: "center" })
            .setLngLat(lngLat)
            .addTo(editMap);
    }
}

function closeModal() {
    editingId = null;
    document.getElementById("edit-overlay").classList.remove("active");
}

async function handleSave(e) {
    e.preventDefault();
    if (!editingId) return;

    const btn = document.getElementById("edit-save");
    btn.textContent = "Saving...";
    btn.disabled = true;

    const fields = {
        title: document.getElementById("edit-title").value.trim(),
        description: document.getElementById("edit-description").value.trim(),
        category: document.getElementById("edit-category").value,
        location: document.getElementById("edit-location").value,
        date: document.getElementById("edit-date").value,
        status: document.getElementById("edit-status").value
    };

    if (editCoords) {
        fields.lat = editCoords.lat;
        fields.lng = editCoords.lng;
    }

    // send the private details back too, found items only
    const editing = myReports.find(r => r.id === editingId);
    if (editing && editing.type === "found") {
        fields.secretDetails = ["edit-secret-1", "edit-secret-2", "edit-secret-3"]
            .map(id => document.getElementById(id).value.trim())
            .filter(Boolean);
    }

    const result = await updateReport(editingId, fields);
    btn.textContent = "Save changes";
    btn.disabled = false;

    if (result.success) {
        const idx = myReports.findIndex(r => r.id === editingId);
        if (idx !== -1 && result.report) myReports[idx] = result.report;
        showToast("Report updated!");
        closeModal();
        renderTable();
    } else {
        showToast(result.message || "Something went wrong - please try again.", "error");
    }
}

// quick shortcut to flag an open report as claimed
async function markClaimed(id) {
    const result = await updateReportStatus(id, "Claimed");
    if (result.success) {
        // swap in what the api gave back so the badge updates without a reload
        const idx = myReports.findIndex(r => r.id === id);
        if (idx !== -1) myReports[idx] = result.report || { ...myReports[idx], status: "Claimed" };
        showToast("Marked as claimed — nice one!");
        renderTable();
    } else {
        showToast(result.message || "Something went wrong - please try again.", "error");
    }
}

async function removeReport(id) {
    if (!confirm("Delete this report? This can't be undone.")) return;
    const result = await deleteReport(id);
    if (result.success) {
        myReports = myReports.filter(r => r.id !== id);
        showToast("Report deleted.");
        renderTable();
    } else {
        showToast(result.message || "Something went wrong - please try again.", "error");
    }
}

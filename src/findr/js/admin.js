/* ===== findr — Admin Dashboard =====
   admins can manage any report, not just their own. the lambdas check the
   same cognito group claim server side, so this page is just the ui for it
*/

let allReports = [];
let editingReportId = null;

document.addEventListener("DOMContentLoaded", async () => {
    const me = getSession();
    if (!me || me.role !== "admin") {
        document.getElementById("dashboard-content").innerHTML = `
            <div class="empty-state">
                <div class="empty-ico"><span class="icon">${ICONS.ban}</span></div>
                <h3>Admins only</h3>
                <p>You don't have permission to view this page.</p>
                <a href="index.html" class="btn btn-primary mt-3">Back to Findr</a>
            </div>`;
        document.getElementById("dashboard-content").style.display = "block";
        return;
    }

    document.getElementById("dashboard-content").style.display = "block";
    await loadDashboard();

    let searchTimeout;
    document.getElementById("admin-search").addEventListener("input", () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(renderTable, 250);
    });
    document.getElementById("admin-filter-status").addEventListener("change", renderTable);
    document.getElementById("admin-filter-type").addEventListener("change", renderTable);
    document.getElementById("export-btn").addEventListener("click", exportCsv);

    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("admin-edit-form").addEventListener("submit", saveReport);
    document.getElementById("modal-delete-btn").addEventListener("click", deleteFromModal);
    document.getElementById("status-modal").addEventListener("click", (e) => {
        if (e.target.id === "status-modal") closeModal();
    });
});

async function loadDashboard() {
    const data = await getReports();
    if (data.success) {
        allReports = data.reports;
        updateStats();
        renderTable();
    } else {
        showToast(data.message || "Couldn't load reports.", "error");
    }
}

function updateStats() {
    document.getElementById("stat-total").textContent = allReports.length;
    document.getElementById("stat-open").textContent = allReports.filter(r => r.status === "Open").length;
    document.getElementById("stat-claimed").textContent = allReports.filter(r => r.status === "Claimed").length;
    document.getElementById("stat-closed").textContent = allReports.filter(r => r.status === "Closed").length;
}

function filtered() {
    const search = document.getElementById("admin-search").value.toLowerCase();
    const status = document.getElementById("admin-filter-status").value;
    const type = document.getElementById("admin-filter-type").value;

    let list = [...allReports];
    if (search) {
        list = list.filter(r =>
            r.title.toLowerCase().includes(search) ||
            (r.userName || "").toLowerCase().includes(search) ||
            (r.location || "").toLowerCase().includes(search));
    }
    if (status) list = list.filter(r => r.status === status);
    if (type) list = list.filter(r => r.type === type);
    return list;
}

function renderTable() {
    const list = filtered();
    const tbody = document.getElementById("reports-table-body");

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2.5rem;color:var(--gray-400);">No reports match your filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(report => `
        <tr>
            <td><code>${esc(String(report.id).slice(0, 8))}</code></td>
            <td>${getTypeBadge(report.type)}</td>
            <td><a href="item-details.html?id=${encodeURIComponent(report.id)}">${esc(report.title)}</a></td>
            <td>${esc(report.category)}</td>
            <td>${esc(report.location)}</td>
            <td>${esc(report.userName)}</td>
            <td>${formatDate(report.date)}</td>
            <td>${getStatusBadge(report.status)}</td>
            <td>${verificationCell(report)}</td>
            <td>
                <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-secondary" onclick="openReport('${report.id}')" title="Manage">${icon("edit")}</button>
                    ${report.status !== "Open"
                        ? `<button class="btn btn-sm btn-secondary" onclick="quickStatus('${report.id}','Open')" title="Reopen">${icon("arrowLeft")}</button>`
                        : `<button class="btn btn-sm btn-secondary" onclick="quickStatus('${report.id}','Closed')" title="Close">${icon("checkCircle")}</button>`}
                    <button class="btn btn-sm btn-danger" onclick="handleDelete('${report.id}')" title="Delete">${icon("trash")}</button>
                </div>
            </td>
        </tr>`).join("");
}

// shows whether a found item is protected, and how a claim went
function verificationCell(r) {
    const v = r.verification;
    if (r.status === "Claimed" && v) {
        return `<span class="admin-vtag ok" title="Claimed by ${esc(v.claimedByName)}">
                    ${ICONS.checkCircle} ${v.answerConfidence || 0}%
                </span>`;
    }
    const a = r.lastClaimAttempt;
    if (a) {
        return `<span class="admin-vtag bad" title="Failed attempt by ${esc(a.claimedByName)}">
                    ${ICONS.alert} ${a.answerConfidence || 0}%
                </span>`;
    }
    if (r.type === "found" && r.hasSecretDetails) {
        return `<span class="admin-vtag" title="Private verification details recorded">
                    ${ICONS.lock} Protected
                </span>`;
    }
    return `<span class="admin-vtag muted">&mdash;</span>`;
}


/* ---------- manage one report ---------- */

function openReport(reportId) {
    const r = allReports.find(x => x.id === reportId);
    if (!r) return;
    editingReportId = reportId;

    document.getElementById("modal-title").value = r.title;
    document.getElementById("modal-description").value = r.description || "";
    document.getElementById("modal-category").value = r.category || "Others";
    document.getElementById("modal-location").value = r.location || "";
    document.getElementById("modal-status").value = r.status;

    // context the admin needs but shouldn't be editing
    const v = r.verification;
    const a = r.lastClaimAttempt;
    document.getElementById("modal-meta").innerHTML = `
        <div><span>Reported by</span><strong>${esc(r.userName)}</strong></div>
        <div><span>Report ID</span><strong><code>${esc(r.id)}</code></strong></div>
        ${v ? `<div><span>Verified claim</span><strong>${esc(v.claimedByName)} &middot; ${esc(v.answerConfidence)}%</strong></div>` : ""}
        ${!v && a ? `<div><span>Failed claim</span><strong>${esc(a.claimedByName)} &middot; ${esc(a.answerConfidence)}%</strong></div>` : ""}`;

    document.getElementById("status-modal").classList.add("active");
}

function closeModal() {
    document.getElementById("status-modal").classList.remove("active");
    editingReportId = null;
}

async function saveReport(e) {
    e.preventDefault();
    if (!editingReportId) return;

    const btn = document.getElementById("modal-save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    const result = await updateReport(editingReportId, {
        title: document.getElementById("modal-title").value.trim(),
        description: document.getElementById("modal-description").value.trim(),
        category: document.getElementById("modal-category").value,
        location: document.getElementById("modal-location").value.trim(),
        status: document.getElementById("modal-status").value,
    });

    btn.disabled = false;
    btn.textContent = "Save changes";

    if (result.success) {
        replaceLocal(editingReportId, result.report);
        showToast("Report updated.");
        closeModal();
        updateStats();
        renderTable();
    } else {
        showToast(result.message || "Something went wrong - please try again.", "error");
    }
}

// one click open/close without opening the modal
async function quickStatus(reportId, status) {
    const result = await updateReportStatus(reportId, status);
    if (result.success) {
        replaceLocal(reportId, result.report);
        showToast(`Marked as ${status}.`);
        updateStats();
        renderTable();
    } else {
        showToast(result.message || "Something went wrong - please try again.", "error");
    }
}

// keeps the table in step with the api without needing a page reload
function replaceLocal(reportId, updated) {
    const idx = allReports.findIndex(r => r.id === reportId);
    if (idx === -1) return;
    allReports[idx] = updated || allReports[idx];
}

async function deleteFromModal() {
    if (!editingReportId) return;
    const id = editingReportId;
    closeModal();
    await handleDelete(id);
}

async function handleDelete(reportId) {
    const r = allReports.find(x => x.id === reportId);
    if (!confirm(`Delete "${r ? r.title : "this report"}"? This can't be undone.`)) return;

    const result = await deleteReport(reportId);
    if (result.success) {
        allReports = allReports.filter(x => x.id !== reportId);
        showToast("Report deleted.");
        updateStats();
        renderTable();
    } else {
        showToast(result.message || "Something went wrong - please try again.", "error");
    }
}


/* ---------- export ---------- */

// straight csv download, no library. handy for the report and for handing
// a list to whoever runs the physical lost property counter
function exportCsv() {
    const list = filtered();
    if (!list.length) {
        showToast("Nothing to export with these filters.", "error");
        return;
    }

    const cols = ["id", "type", "title", "category", "location", "userName", "date", "status"];
    const escape = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;

    const csv = [
        cols.join(","),
        ...list.map(r => cols.map(c => escape(r[c])).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `findr-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Exported ${list.length} report${list.length > 1 ? "s" : ""}.`);
}

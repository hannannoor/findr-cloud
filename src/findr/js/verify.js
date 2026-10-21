/* findr — ownership verification wizard
   opens from "this is mine" on a found item

   when someone reports a found item they can jot down up to 3 private details.
   bedrock turns those into questions here, then marks the answers against the
   real thing. an item with no details recorded has nothing to check against,
   so we say so instead of pretending to verify
*/

let vzReport = null;
let vzPlan = null;          // { questionCount, verifiable }
let vzQuestions = [];

async function openClaimWizard(report) {
    if (!getSession()) {
        showToast("Please log in to claim an item.", "error");
        setTimeout(() => { window.location.href = "login.html"; }, 900);
        return;
    }

    vzReport = report;
    vzQuestions = [];

    const overlay = document.createElement("div");
    overlay.className = "vz-overlay";
    overlay.id = "vz-overlay";
    overlay.innerHTML = `
        <div class="vz-modal" role="dialog" aria-modal="true" aria-label="Verify ownership">
            <button class="vz-close" id="vz-close" aria-label="Close">&times;</button>
            <div class="vz-steps" id="vz-steps"></div>
            <div class="vz-body" id="vz-body">
                <div class="vz-working"><span class="spinner"></span><p>Loading…</p></div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    document.getElementById("vz-close").addEventListener("click", closeWizard);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeWizard(); });

    const plan = await verifyStart(report.id);
    if (!plan.success) return failStep(plan.message);

    vzPlan = plan;
    stepIntro();
}

function closeWizard() {
    const overlay = document.getElementById("vz-overlay");
    if (overlay) overlay.remove();
}

function setSteps(current) {
    const names = ["Questions", "Result"];
    document.getElementById("vz-steps").innerHTML = names.map((n, i) => `
        <div class="vz-step ${i < current ? "done" : ""} ${i === current ? "active" : ""}">
            <span class="vz-step-dot">${i < current ? "&check;" : i + 1}</span>
            <span class="vz-step-label">${n}</span>
        </div>`).join('<div class="vz-step-line"></div>');
}

function body(html) {
    document.getElementById("vz-body").innerHTML = html;
}


/* ---------------- intro ---------------- */

function stepIntro() {
    setSteps(0);

    if (!vzPlan.verifiable) {
        body(`
            <h2 class="vz-title">No verification set up</h2>
            <p class="vz-lead">The person who found this didn't record anything private
               about it, so there's nothing to check your claim against.</p>
            <p class="vz-lead">Message them directly instead — they can ask you about it
               themselves.</p>
            <div class="vz-actions">
                <button class="btn btn-primary" id="vz-msg">Message the finder</button>
            </div>`);
        document.getElementById("vz-msg").addEventListener("click", () => {
            closeWizard();
            handleMessage();
        });
        return;
    }

    const n = vzPlan.questionCount;
    body(`
        <h2 class="vz-title">Verify that this is yours</h2>
        <p class="vz-lead">Anyone can say an item is theirs. Findr checks properly.</p>

        <div class="vz-explain">
            <div class="vz-explain-row">
                <span class="vz-explain-ico">${icon("sparkles")}</span>
                <div>
                    <strong>${n} question${n > 1 ? "s" : ""} only the owner can answer</strong>
                    <p>When this item was handed in, the finder noted a few private details
                       about it. Amazon Bedrock has turned those into questions — they aren't
                       written anywhere on this site and can't be seen in the photo.</p>
                </div>
            </div>
            <div class="vz-explain-row">
                <span class="vz-explain-ico">${icon("shield")}</span>
                <div>
                    <strong>The finder decides</strong>
                    <p>Your answers are scored and sent to them either way. Findr advises,
                       it doesn't hand over your item automatically.</p>
                </div>
            </div>
        </div>

        <div class="vz-actions">
            <button class="btn btn-secondary" id="vz-cancel">Cancel</button>
            <button class="btn btn-primary" id="vz-start">Start</button>
        </div>`);

    document.getElementById("vz-cancel").addEventListener("click", closeWizard);
    document.getElementById("vz-start").addEventListener("click", stepQuestions);
}


/* ---------------- questions ---------------- */

async function stepQuestions() {
    setSteps(0);
    body(`
        <h2 class="vz-title">Preparing your questions</h2>
        <div class="vz-working">
            <span class="spinner"></span>
            <p>Amazon Bedrock is writing questions from the finder's private notes…</p>
        </div>`);

    const result = await verifyQuestions(vzReport.id);
    if (!result.success) return failStep(result.message);

    vzQuestions = result.questions || [];
    if (!vzQuestions.length) return failStep("No questions could be generated for this item.");

    body(`
        <h2 class="vz-title">Prove it's yours</h2>
        <p class="vz-lead">Answer in your own words. Detail helps — vague answers score badly.</p>

        <form id="vz-qform" class="vz-questions">
            ${vzQuestions.map((q, i) => `
                <div class="form-group">
                    <label class="form-label" for="vz-a${i}">${i + 1}. ${esc(q)}</label>
                    <textarea id="vz-a${i}" class="form-input" rows="2" required
                              placeholder="Your answer…"></textarea>
                </div>`).join("")}
            <div class="vz-actions">
                <button type="button" class="btn btn-secondary" id="vz-cancel3">Cancel</button>
                <button type="submit" class="btn btn-primary">Submit answers</button>
            </div>
        </form>`);

    document.getElementById("vz-cancel3").addEventListener("click", closeWizard);
    document.getElementById("vz-qform").addEventListener("submit", submitAnswers);
}

async function submitAnswers(e) {
    e.preventDefault();

    const answers = vzQuestions.map((_, i) => document.getElementById(`vz-a${i}`).value.trim());
    if (answers.some(a => !a)) {
        showToast("Please answer every question.", "error");
        return;
    }

    setSteps(1);
    body(`
        <h2 class="vz-title">Assessing your claim</h2>
        <div class="vz-working">
            <span class="spinner"></span>
            <p>Amazon Bedrock is comparing your answers against the finder's notes…</p>
        </div>`);

    const result = await verifyAnswers(vzReport.id, vzQuestions, answers);
    if (!result.success) return failStep(result.message);

    stepResult(result);
}


/* ---------------- verdict ---------------- */

function stepResult(result) {
    setSteps(1);

    const score = `<div class="vz-score ${result.approved ? "pass" : "fail"}">
            <div class="vz-score-num">${esc(result.confidence)}%</div>
            <div class="vz-score-label">match confidence &middot; ${esc(result.threshold)}% needed</div>
        </div>`;

    if (result.approved) {
        body(`
            <div class="vz-verdict pass">
                <span class="vz-verdict-ico">${ICONS.checkCircle}</span>
                <h2>Claim verified</h2>
            </div>
            ${score}
            <p class="vz-lead">${esc(result.verdict)}</p>
            <p class="vz-note">${icon("mail")} The finder has been notified and the item is
               marked as Claimed. Arrange collection through Messages.</p>
            <div class="vz-actions">
                <button class="btn btn-primary" id="vz-done">Done</button>
            </div>`);
        document.getElementById("vz-done").addEventListener("click", () => {
            closeWizard();
            window.location.reload();
        });
    } else {
        body(`
            <div class="vz-verdict fail">
                <span class="vz-verdict-ico">${ICONS.alert}</span>
                <h2>Claim not verified</h2>
            </div>
            ${score}
            <p class="vz-lead">${esc(result.verdict)}</p>
            <p class="vz-note">${icon("mail")} The finder has been sent the details and can
               still review your claim manually through Messages.</p>
            <div class="vz-actions">
                <button class="btn btn-primary" id="vz-done2">Close</button>
            </div>`);
        document.getElementById("vz-done2").addEventListener("click", closeWizard);
    }
}

function failStep(message) {
    body(`
        <div class="vz-verdict fail">
            <span class="vz-verdict-ico">${ICONS.alert}</span>
            <h2>Something went wrong</h2>
        </div>
        <p class="vz-lead">${message || "Please try again."}</p>
        <div class="vz-actions">
            <button class="btn btn-primary" id="vz-close2">Close</button>
        </div>`);
    document.getElementById("vz-close2").addEventListener("click", closeWizard);
}

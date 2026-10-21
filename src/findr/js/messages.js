/* ===== findr — Messages page =====
   can be opened plain, or with ?to=&name=&reportId=&title= from an item page,
   in which case we open an empty draft thread ready to type into
*/

let currentConvoId = null;
let conversationsData = [];

document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(window.location.search);
    const draftTo = params.get("to");

    const data = await getConversations();
    conversationsData = (data.success && data.conversations) ? data.conversations : [];

    // came here from "message the owner" - stick a draft thread at the top
    if (draftTo) {
        const me = getSession();
        const reportId = params.get("reportId") || "";

        // the backend builds the id as "userA#userB#reportId" with the two ids
        // sorted, so we can work out what this thread's id will be and match on
        // that exactly. matching on otherUser/reportId separately used to miss,
        // and then the draft turned into a second copy of a thread we already had
        const expectedId = me ? [me.id, draftTo].sort().join("#") + "#" + reportId : "";
        const existing = conversationsData.find(c => c.id === expectedId);

        if (existing) {
            // already talking about this item, just open it
            currentConvoId = existing.id;
        } else if (me && draftTo !== me.id) {
            conversationsData.unshift({
                id: "draft",
                draft: true,
                otherUser: { id: draftTo, name: params.get("name") || "User" },
                reportId: reportId,
                reportTitle: params.get("title") || "",
                lastMessage: "",
                lastMessageTime: new Date().toISOString(),
                messages: [],
            });
            currentConvoId = "draft";
        }

        // tidy the url so a refresh doesn't spawn another draft
        window.history.replaceState({}, "", "messages.html");
    }

    if (conversationsData.length === 0) {
        document.getElementById("no-conversations").style.display = "block";
        return;
    }

    document.getElementById("chat-layout").style.display = "grid";
    renderConversationList();

    const head = document.querySelector(".chat-sidebar-head");
    if (head && !head.querySelector(".convo-count")) {
        head.insertAdjacentHTML("beforeend", `<span class="convo-count">${conversationsData.length}</span>`);
    }

    // open the draft if there is one, otherwise the most recent thread
    const openId = currentConvoId || [...conversationsData]
        .sort((a, b) => new Date(lastTime(b)) - new Date(lastTime(a)))[0].id;
    openConversation(openId);

    const input = document.getElementById("message-input");
    if (input) {
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") handleSend();
        });
    }
    const sendBtn = document.getElementById("send-btn");
    if (sendBtn) sendBtn.addEventListener("click", handleSend);
});

function lastOf(convo) {
    return convo.messages.length ? convo.messages[convo.messages.length - 1] : null;
}

function lastTime(convo) {
    const m = lastOf(convo);
    return m ? m.time : convo.lastMessageTime;
}

function renderConversationList() {
    const list = document.getElementById("conversations-list");
    const sorted = [...conversationsData].sort(
        (a, b) => new Date(lastTime(b)) - new Date(lastTime(a))
    );

    list.innerHTML = sorted.map(convo => {
        const last = lastOf(convo);
        const preview = last ? last.text : (convo.draft ? "New message…" : "");
        return `
        <div class="chat-contact ${convo.id === currentConvoId ? "active" : ""}" onclick="openConversation('${esc(convo.id)}')">
            <div class="chat-avatar">${esc(String(convo.otherUser.name || "?").charAt(0))}</div>
            <div class="chat-contact-info">
                <div class="chat-contact-name">${esc(convo.otherUser.name)}</div>
                <div class="chat-contact-sub">${esc(convo.reportTitle)}</div>
                <div class="chat-contact-preview">${esc(preview)}</div>
            </div>
            <div class="chat-contact-time">${last ? timeAgo(last.time) : ""}</div>
        </div>`;
    }).join("");
}

function openConversation(convoId) {
    currentConvoId = convoId;
    const convo = conversationsData.find(c => c.id === convoId);
    if (!convo) return;

    renderConversationList();

    document.getElementById("chat-placeholder").style.display = "none";
    document.getElementById("active-chat").style.display = "flex";

    document.getElementById("chat-head").innerHTML = `
        <div class="chat-avatar" style="width:38px;height:38px;font-size:0.85rem;">${esc(String(convo.otherUser.name || "?").charAt(0))}</div>
        <div>
            <div class="chat-head-name">${esc(convo.otherUser.name)}</div>
            <div class="chat-head-sub">Re: ${esc(convo.reportTitle)}</div>
        </div>`;

    renderMessages(convo);
    document.getElementById("message-input").focus({ preventScroll: true });

    // stacked layout on mobile puts the thread below the list, so without
    // this a tap looks like nothing happened
    if (window.matchMedia("(max-width: 768px)").matches) {
        document.getElementById("active-chat").scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function renderMessages(convo) {
    const body = document.getElementById("chat-body");

    if (!convo.messages.length) {
        body.innerHTML = `<div class="chat-empty-thread">
            <p>Say hello to ${esc(convo.otherUser.name)} about <strong>${esc(convo.reportTitle || "this item")}</strong>.</p>
        </div>`;
        return;
    }

    body.innerHTML = convo.messages.map(msg => {
        // the api tells us which ones are ours
        const sent = msg.mine === true;
        return `<div class="msg ${sent ? "msg-sent" : "msg-recv"}">
            <div>${esc(msg.text)}</div>
            <div class="msg-time">${timeAgo(msg.time)}</div>
        </div>`;
    }).join("");
    body.scrollTop = body.scrollHeight;
}

async function handleSend() {
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    if (!text || !currentConvoId) return;

    let convo = conversationsData.find(c => c.id === currentConvoId);
    if (!convo) return;

    input.value = "";
    input.disabled = true;

    let result;
    if (convo.draft) {
        // first message of a brand new thread
        result = await startConversation(
            convo.otherUser.id, convo.otherUser.name,
            convo.reportId, convo.reportTitle, text
        );
        if (result.success) {
            // the id the api hands back might belong to a thread already in the
            // list. if so merge into it and drop the draft, otherwise the same
            // conversation shows up twice until the page is refreshed
            const existing = conversationsData.find(
                c => c !== convo && c.id === result.conversationId
            );

            if (existing) {
                existing.messages.push(result.sent);
                existing.lastMessage = text;
                existing.lastMessageTime = result.sent.time;
                conversationsData = conversationsData.filter(c => c !== convo);
                convo = existing;
            } else {
                // swap the draft for the real conversation id the api gave us
                convo.id = result.conversationId;
                convo.draft = false;
                convo.messages.push(result.sent);
                // let api.js know about it so later sends keep the right metadata
                if (typeof cachedConversations !== "undefined") cachedConversations.push(convo);
            }

            currentConvoId = result.conversationId;
        }
    } else {
        result = await sendMessage(currentConvoId, text);
    }

    input.disabled = false;
    input.focus({ preventScroll: true });

    if (result && result.success) {
        renderMessages(convo);
        renderConversationList();
    } else {
        input.value = text;
        showToast((result && result.message) || "Couldn't send that message.", "error");
    }
}

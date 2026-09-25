// Service worker — context menu + Mac Shift+Option new-window killer
const GATEWAY_URL_KEY = "hermes_gateway_url";
const DEFAULT_GATEWAY = "http://127.0.0.1:6380";

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "send_to_hermes",
      title: "Send to Terminal",
      contexts: ["link"],
    });
  });
}

chrome.runtime.onStartup.addListener(createContextMenu);
chrome.runtime.onInstalled.addListener(() => {
  setTimeout(createContextMenu, 1000);
});
chrome.alarms.create("wakeUp", { when: Date.now() + 500 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "wakeUp") { createContextMenu(); }
});
setInterval(() => {}, 60000);

// Context menu handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "send_to_hermes") return;
  const url = info.linkUrl;
  const stored = (await chrome.storage.local.get(GATEWAY_URL_KEY))[GATEWAY_URL_KEY];
  const gateway = stored || DEFAULT_GATEWAY;
  try {
    const resp = await fetch(gateway, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) throw new Error("Server returned " + resp.status);
    chrome.action.setBadgeText({ text: "\u2713", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#4caf50", tabId: tab.id });
    chrome.alarms.create("clearBadge" + tab.id, { when: Date.now() + 2000 });
  } catch (err) {
    chrome.action.setBadgeText({ text: "\u2717", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#f44336", tabId: tab.id });
    try { chrome.notifications?.create({ type: "basic", title: "Hermes Link Bridge", message: "Server error: " + err.message }); } catch (_) {}
    chrome.alarms.create("clearBadge" + tab.id, { when: Date.now() + 3000 });
  }
});

// Clear badge alarm handler
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("clearBadge")) {
    const tabId = parseInt(alarm.name.replace("clearBadge", ""), 10);
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

// ── Mac Shift+Option new-window killer (URL-matched, not blanket) ───
let pendingUrlToKill = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "shift-clicked") {
    pendingUrlToKill = msg.url.toLowerCase().trim();
    setTimeout(() => { pendingUrlToKill = null; }, 3000);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!pendingUrlToKill || !changeInfo.url) return;
  const url = changeInfo.url.toLowerCase().trim();
  if (url === pendingUrlToKill) {
    chrome.tabs.remove(tabId);
  }
});

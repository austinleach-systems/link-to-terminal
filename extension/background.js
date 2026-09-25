// Service worker — handles right-click context menu clicks
const GATEWAY_URL_KEY = "hermes_gateway_url";
const DEFAULT_GATEWAY = "http://127.0.0.1:6380";

function createContextMenu() {
  // Remove any stale menus before recreating (prevents duplicates on reload)
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "send_to_hermes",
      title: "Send to Terminal",
      contexts: ["link"],
    });
  });
}

// Create the context menu whenever the service worker activates (MV3)
chrome.runtime.onStartup.addListener(createContextMenu);

// Also on install/update — covers first load only
chrome.runtime.onInstalled.addListener(() => {
  // Delay slightly so MV3 scheduler can finish booting
  setTimeout(createContextMenu, 1000);
});

// Re-create after any wake-up (MV3 service workers sleep and wake)
chrome.alarms.create("wakeUp", { when: Date.now() + 500 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "wakeUp") {
    createContextMenu();
  }
});

// Keep service worker alive so menus stay registered
setInterval(() => {}, 60000);

// When the user selects our menu item
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "send_to_hermes") return;

  const url = info.linkUrl;
  console.log("[Hermes] Menu clicked, URL:", url);

  // Read the configured gateway or fall back to default
  const stored = (await chrome.storage.local.get(GATEWAY_URL_KEY))[GATEWAY_URL_KEY];
  const gateway = stored || DEFAULT_GATEWAY;
  console.log("[Hermes] Gateway URL:", gateway);

  try {
    console.log("[Hermes] Sending POST request...");
    const resp = await fetch(gateway, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!resp.ok) {
      throw new Error(`Server returned ${resp.status}`);
    }
    console.log("[Hermes] Got response status:", resp.status);

    const data = await resp.json();
    console.log("[Hermes] Server reply:", data);

    // Show a brief popup status via the extension icon badge (Chrome MV3 lets use alarms)
    chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#4caf50", tabId: tab.id });

    // Clear badge after 2 seconds
    chrome.alarms.create("clearBadge" + tab.id, { when: Date.now() + 2000 });
  } catch (err) {
    console.error("[Hermes] Request failed:", err);
    chrome.action.setBadgeText({ text: "✗", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#f44336", tabId: tab.id });

    // Try to show an error notification if possible
    try {
      chrome.notifications?.create({
        type: "basic",
        title: "Hermes Link Bridge",
        message: `Could not reach server: ${err.message}. Is the bridge running?`,
      });
    } catch (_) {}

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

// ── Mac Shift+Option new-tab blocker ───────────────────────────────
let activeTabId = null;
chrome.tabs.query({active:true,currentWindow:true}, t => { if (t[0]) activeTabId = t[0].id; });
chrome.tabs.onActivated.addListener(info => { activeTabId = info.tabId; });

let blockNewTabUntil = 0; // timestamp
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "shift-clicked") {
    blockNewTabUntil = Date.now() + 2000; // 2s window
    return;
  }
});

chrome.tabs.onCreated.addListener(tab => {
  if (!tab.active || Date.now() < blockNewTabUntil) {
    chrome.tabs.remove(tab.id);
  }
});

// ── Hermes Link Bridge: Active-Process Popup ─────────────────────

const GATEWAY_KEY  = "gateway_url";
const DEFAULT_URL  = "http://127.0.0.1:6380";

let refreshTimer  = null;

async function loadGateway() {
  const stored = (await chrome.storage.local.get(GATEWAY_KEY))[GATEWAY_KEY];
  return new URL(stored || DEFAULT_URL).origin;
}

async function fetchProcesses() {
  try {
    const gw   = await loadGateway();
    const resp = await fetch(`${gw}/processes`, {signal: AbortSignal.timeout(3000)});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    document.getElementById("list").innerHTML =
      `<div class="empty">⚠ Could not reach server<br><small>${err.message}</small></div>`;
    return null;
  }
}

function fmtDuration(s) {
  if (!Number.isFinite(s)) return "…";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function render(list, data) {
  if (!data || !data.processes.length) {
    list.innerHTML = `<div class="empty">${data?.running === 0 ? "No active downloads" : "— no processes —"}</div>`;
    return;
  }
  const running = data.running;
  list.innerHTML = data.processes.map(p => `
    <div class="bar">
      <span class="dot ${p.status}"></span>
      <span class="url" title="${p.url}">${p.url}</span>
      <span class="meta">${p.status==="running" ? fmtDuration(p.runtime) : p.age} &nbsp; pid:${p.pid}</span>
    </div>`).join("");
  if (running) list.dataset.active = running;       // CSS hook for badge later
}

async function tick() {
  const data = await fetchProcesses();
  render(document.getElementById("list"), data);
}

// Refresh button
document.querySelector("#refresh").addEventListener("click", tick);

// Auto-refresh every 4 s while popup is open
function scheduleRefresh() {
  refreshTimer = setTimeout(() => { tick(); scheduleRefresh(); }, 4000);
}

async function init() {
  await tick();
  scheduleRefresh();
}

chrome.runtime.onSuspend.addListener(() => clearTimeout(refreshTimer));
init();

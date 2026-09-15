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

async function retryUrl(url) {
  try {
    const gw   = await loadGateway();
    await fetch(`${gw}/`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({url}),
      signal: AbortSignal.timeout(5000),
    });
    // Refresh the list immediately so the retried job shows up
    await tick();
  } catch (err) {
    console.error("Retry failed:", err);
  }
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
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

  const fragment = document.createDocumentFragment();
  for (const p of data.processes) {
    const bar = document.createElement("div");
    bar.className = "bar";

    const dot   = document.createElement("span");
    dot.className = `dot ${p.status}`;

    const urlEl = document.createElement("span");
    urlEl.className = "url";
    urlEl.title = p.url;
    urlEl.textContent = p.url;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = p.status === "running" ? fmtDuration(p.runtime) : p.age;

    bar.append(dot, urlEl, meta);

    // Error items get a Retry button
    if (p.status === "error") {
      const btn = document.createElement("button");
      btn.className = "retry-btn";
      btn.textContent = "↻ Retry";
      btn.title = p.url;
      btn.addEventListener("click", async () => retryUrl(p.url));
      bar.appendChild(btn);
    }

    fragment.appendChild(bar);
  }

  list.innerHTML = "";
  list.appendChild(fragment);
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

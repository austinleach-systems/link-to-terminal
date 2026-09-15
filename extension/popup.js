// ── Hermes Link Bridge: Active-Process Popup ─────────────────────

const GATEWAY_KEY  = "gateway_url";
const DEFAULT_URL  = "http://127.0.0.1:6380";

let refreshTimer  = null;

async function loadGateway() {
  return (await chrome.storage.local.get(GATEWAY_KEY))[GATEWAY_KEY] || DEFAULT_URL;
}

function fmtURL(u) {
  try { return new URL(u).host.split(".")[0].slice(0, 24); }
  catch { return u.slice(0, 36); }
}

async function render() {
  const list = document.getElementById("list");
  list.innerHTML = "";

  try {
    const gw   = await loadGateway();
    const resp = await fetch(`${gw}/processes`, {signal: AbortSignal.timeout(3000)});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    list.innerHTML = `<div class="row error">⚠ Unreachable</div>`;
    return;
  }

  const items = data.data || [];
  const depth = data.queue_depth ?? 0;

  if (!items.length && !depth) {
    list.innerHTML = `<div class="row empty">No active queue</div>`;
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    if (item.status === "running") {
      row.className = "row";
      row.innerHTML = `<span class="dot running"></span>${fmtURL(item.url)}<br><small>running ${item.runtime}</small>`;
    } else if (item.status === "queued") {
      row.className = "row queued-row";
      row.innerHTML = `<span class="dot queued"></span>#${item.queue_position} ${fmtURL(item.url)}<br><small>in queue</small>`;
    } else { /* error */
      row.className = "row error";
      const age = item.promoted || item.started ? (Date.now() / 1000 - Date.parse(item.promoted || item.started)) : "?";
      row.innerHTML = `<span class="dot error"></span>${fmtURL(item.url)}<br><small>exit ${item.exit_code ?? "?"} · ${Math.floor(age)}s</small>`;

      const btn = document.createElement("button");
      btn.className = "retry-btn";
      btn.textContent = "↻ Retry";
      btn.onclick = () => retryURL(gw, item.url);
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
}

// ── Retry via same POST path as context-menu click ───────────────

async function retryURL(gateway, url) {
  fetch(`${gateway}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({url})
  });
}

// ── Lifecycle ────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  refreshTimer = setInterval(render, 4000);
  render(); // initial load
});

// Kill the interval when popup closes to avoid leaking service-worker tasks
window.addEventListener("unload", () => { clearInterval(refreshTimer); });
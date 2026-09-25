// ── Hermes Link Bridge: Active-Process Popup ─────────────────────

const GATEWAY_KEY = "gateway_url";
const DEFAULT_URL = "http://127.0.0.1:6380";

let refreshTimer = null;

async function loadGateway() {
  const o = await chrome.storage.local.get(GATEWAY_KEY);
  return o[GATEWAY_KEY] || DEFAULT_URL;
}

async function render() {
  const list = document.getElementById("list");
  if (!list) return;
  list.innerHTML = "";

  let gw;
  let items = [];
  try {
    gw    = await loadGateway();
    const r = await fetch(gw + "/processes", {signal: AbortSignal.timeout(3000)});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    items   = j.data || [];
  } catch(_) {
    list.innerHTML = '<div class="row error">⚠ unreachable</div>';
    return;
  }

  if (!items.length) {
    list.innerHTML = '<div class="row empty">No active queue</div>';
    return;
  }

  // Group by origin
  const groups = {};
  for (const item of items) {
    const key = item.origin || "unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  for (const [origin, groupItems] of Object.entries(groups)) {
    const hd = document.createElement("div");
    hd.style.cssText = "font-weight:700;font-size:10px;opacity:.5;margin:6px 0 2px;border-top:1px solid #eee;padding-top:4px";
    hd.textContent = origin.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    list.appendChild(hd);

    for (const item of groupItems) {
      const row = document.createElement("div");
      const urlSpan = document.createElement("span");
      urlSpan.className = "url";
      urlSpan.textContent = item.url;
      if (item.status === "running") {
        row.className = "row";
        const dot = document.createElement("span");
        dot.className = "dot running";
        row.appendChild(dot);
        row.appendChild(urlSpan);
        const info = document.createElement("br");
        row.appendChild(info);
        const small = document.createElement("small");
        small.textContent = "running " + (item.runtime || "");
        row.appendChild(small);
      } else if (item.status === "queued") {
        row.className = "row queued-row";
        const dot = document.createElement("span");
        dot.className = "dot queued";
        row.appendChild(dot);
        row.appendChild(urlSpan);
        const info = document.createElement("br");
        row.appendChild(info);
        const small = document.createElement("small");
        small.textContent = "#" + (item.queue_position || "?") + " in queue";
        row.appendChild(small);
      } else { /* error */
        row.className = "row error";
        row.appendChild(urlSpan);
        const t = item.promoted || item.started;
        const age = t ? Math.floor(Date.now()/1000 - Date.parse(t)) : "?";
        const info = document.createElement("br");
        row.appendChild(info);
        const small = document.createElement("small");
        small.textContent = "exit " + (item.exit_code ?? "?") + " · " + age + "s";
        row.appendChild(small);
        const btn = document.createElement("button");
        btn.className = "retry-btn";
        btn.textContent = "↻ Retry";
        btn.onclick = (function(urlCopy, gwCopy){ return function(){ retryURL(gwCopy, urlCopy); }; })(item.url, gw);
        row.appendChild(btn);
      }
      list.appendChild(row);
    }
  }
}

function retryURL(gw, url) {
  fetch(gw, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({url:url})});
}

document.addEventListener("DOMContentLoaded", function(){ refreshTimer = setInterval(render, 4000); render(); });
window.addEventListener("unload", function(){ clearInterval(refreshTimer); }, {once:true});
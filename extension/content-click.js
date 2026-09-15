// ── Modifier-click content script ────────────────────────────────
(function () {
  let toastEl = null;
  function rm() { if (toastEl) { toastEl.remove(); toastEl = null; } }
  function show(txt, sub, ok) {
    rm(); toastEl = document.createElement("div");
    toastEl.style.cssText = "position:fixed;z-index:2147483647;padding:4px 10px;border-radius:4px;font:bold 12px system-sans-serif;pointer-events:none;box-shadow:0 2px 6px #0005;left:"+Math.min(+(toastEl.style.left)||12, window.innerWidth-160)+"px;top:"+(+arguments.callee._top||0)+"px;background:"+(ok?"#34d399":"#f87171")+"88;color:#fff";
    toastEl.textContent = txt;
    if (sub) { const s=document.createElement("span"); s.style.fontWeight="normal"; s.style.opacity=".7"; s.textContent=" "+sub; toastEl.appendChild(s); }
    document.body.appendChild(toastEl); setTimeout(rm, 1800);
  }
  document.addEventListener("click", function (e) {
    if (!(e.ctrlKey && e.altKey && (e.metaKey || e.ctrlKey))) return; // Ctrl+Opt+Cmd or Ctrl+Alt on Linux
    let a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !a.href) return;
    e.preventDefault();
    show._top = e.clientY + 8;
    chrome.storage.local.get("gateway_url", function (o) {
      const gw = o.gateway_url || "http://127.0.0.1:6380";
      fetch(gw, {method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify({url:a.href}) })
        .then(r=>r.json()).then(d => show("sent ✓", d.status==="queued"?"#"+d.queue_position:"", true))
        .catch(_ => show("⚠ unreachable", "", false));
    });
  }, true); // capture phase so we can preventDefault before page loads link
})();

// ── Modifier-click content script ────────────────────────────────
(function () {
  let toastEl = null;
  function rm() { if (toastEl) { toastEl.remove(); toastEl = null; } }
  function show(txt, sub, ok) {
    rm(); toastEl = document.createElement("div");
    toastEl.style.cssText = "position:fixed;z-index:2147483647;padding:4px 10px;border-radius:4px;font:bold 12px system-sans-serif;pointer-events:none;box-shadow:0 2px 6px #0005;left:12px;top:" + arguments.callee.lastY + "px;background:" + (ok ? "#34d399" : "#f87171") + "88;color:#fff";
    toastEl.textContent = txt;
    if (sub) { const s = document.createElement("span"); s.style.fontWeight = "normal"; s.style.opacity = ".7"; s.textContent = " " + sub; toastEl.appendChild(s); }
    document.body.appendChild(toastEl); setTimeout(rm, 900);
  }
  show.lastY = 16;

  document.addEventListener("click", function (e) {
    // Shift+Option only — no other modifiers allowed
    if (!e.shiftKey || !e.altKey || e.metaKey || e.ctrlKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !a.href) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    show.lastY = Math.min(e.clientY + 8, window.innerHeight - 40);
    chrome.storage.local.get("gateway_url", function (o) {
      var gw = o.gateway_url || "http://127.0.0.1:6380";
      fetch(gw, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:a.href})})
        .then(function(r){return r.json();}).then(function(d){show("sent ✓",d.status==="queued"?"#"+d.queue_position:"",true);})
        .catch(function(){show("⚠ unreachable","",false);});
    });
  }, true);
})();

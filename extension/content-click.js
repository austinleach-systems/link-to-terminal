// ── Modifier-click content script (debug mode) ───────────────────
(function () {
  let toastEl = null;
  function rm() { if (toastEl) { toastEl.remove(); toastEl = null; } }
  function show(txt, sub, ok) {
    rm(); toastEl = document.createElement("div");
    toastEl.style.cssText = "position:fixed;z-index:2147483647;padding:4px 10px;border-radius:4px;font:bold 12px system-sans-serif;pointer-events:none;box-shadow:0 2px 6px #0005;left:12px;top:" + (arguments.callee.lastY || 16) + "px;background:" + (ok ? "#34d399" : ok===0?"#fbbf24":"#f87171") + "88;color:#fff";
    toastEl.textContent = txt;
    if (sub) { const s = document.createElement("span"); s.style.fontWeight = "normal"; s.style.opacity = ".7"; s.textContent = " " + sub; toastEl.appendChild(s); }
    document.body.appendChild(toastEl); setTimeout(rm, ok ? 900 : 2500);
  }
  show.lastY = 16;

  function getHref(target) {
    var a = target.closest ? target.closest('a[href]') : null;
    if (a && a.href) return a.href;
    if (target.tagName === 'IMG' && target.src) return target.src;
    return null;
  }

  document.addEventListener("mousedown", function (e) {
    var mods = [];
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Alt");
    if (e.metaKey) mods.push("Meta");
    if (e.ctrlKey) mods.push("Ctrl");

    // Shift+Option only — no other modifiers allowed
    if (!e.shiftKey || !e.altKey || e.metaKey || e.ctrlKey) {
      console.log("[hermes-link] mousedown, mods=" + mods.join("+") + ", skipped");
      return;
    }

    var href = getHref(e.target);
    if (!href) {
      show("no link/img here", "", 0);
      return;
    }

    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    show.lastY = Math.min(e.clientY + 8, window.innerHeight - 40);
    chrome.storage.local.get("gateway_url", function (o) {
      var gw = o.gateway_url || "http://127.0.0.1:6380";
      fetch(gw, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:href})})
        .then(function(r){return r.json();}).then(function(d){show("sent ✓",d.status==="queued"?"#"+d.queue_position:"",true);})
        .catch(function(err){show("fetch failed",err.message||"",false);});
    });
  }, true);
})();

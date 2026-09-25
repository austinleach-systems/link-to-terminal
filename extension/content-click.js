// ── Modifier-click content script ────────────────────────────────
(function () {
  let toastEl = null;
  let lastY = 16;
  // Track which events we've already handled to double-sent only once
  var handledSet = new Set();

  function rm() { if (toastEl) { toastEl.remove(); toastEl = null; } }
  function show(txt, sub, ok) {
    rm(); toastEl = document.createElement("div");
    toastEl.style.cssText = "position:fixed;z-index:2147483647;padding:4px 10px;border-radius:4px;font:bold 12px system-sans-serif;pointer-events:none;box-shadow:0 2px 6px #0005;left:12px;top:" + lastY + "px;background:" + (ok ? "#34d399" : ok===null?"#fbbf24":"#f87171") + "88;color:#fff";
    toastEl.textContent = txt;
    if (sub) { const s = document.createElement("span"); s.style.fontWeight = "normal"; s.style.opacity = ".7"; s.textContent = " " + sub; toastEl.appendChild(s); }
    document.body.appendChild(toastEl); setTimeout(rm, ok ? 900 : 2500);
  }

  function getHref(el) {
    if (!el) return null;
    // Check link first
    var a = el.closest && el.closest('a[href]');
    if (a && a.href) return { href: a.href, type: 'link' };
    // Check image
    var img = null;
    if (el.closest) img = el.closest('img');
    if (!img && el.tagName === 'IMG') img = el;
    if (img && img.src) return { href: img.src, type: 'image' };
    return null;
  }

  function modifiersMatch(e) {
    return e.shiftKey && e.altKey && !e.metaKey && !e.ctrlKey;
  }

  function handleEl(e, eventType) {
    if (!modifiersMatch(e)) return false;

    // Don't double-fire for same target on mousedown+click
    var id = e.target.id || (e.target.outerHTML.slice(0,20) + e.timeStamp);
    if (handledSet.has(id)) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return true; // already handled by other event type
    }

    stopEvent(e);

    var info = getHref(e.target);
    if (!info) {
      show("no link/image", "Shift+Option OK", null);
      return false;
    }

    lastY = Math.min(e.clientY + 8, window.innerHeight - 40);
    handledSet.add(id);
    // Clean up old IDs after a second to avoid memory grow
    setTimeout(function() { var _ = handledSet.delete(id); }, 1200);

    chrome.storage.local.get("gateway_url", function (o) {
      var gw = o.gateway_url || "http://127.0.0.1:6380";
      fetch(gw, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:info.href})})
        .then(function(r){return r.json();}).then(function(d){show("sent ✓ ("+info.type+")",d.status==="queued"?"#"+d.queue_position:"",true);})
        .catch(function(err){show("fetch failed","check server",false);});
    });
    return true;
  }

  function stopEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  // mousedown blocks the initial action (Mac's shift-click opens new window on click phase)
  document.addEventListener("mousedown", function(e){ handleEl(e, "mousedown"); }, true);
  // click catches anything that slipped through
  document.addEventListener("click", function(e){ handleEl(e, "click"); }, true);

})();

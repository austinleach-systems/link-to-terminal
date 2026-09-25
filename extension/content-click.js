// ── Modifier-click content script v6.5.1 ──────────────────────────
(function () {
  let toastEl = null;
  let lastY = 16;
  var handledSet = new Set();

  function rm() { if (toastEl) { toastEl.remove(); toastEl = null; } }
  function show(txt, sub, ok) {
    rm(); toastEl = document.createElement("div");
    toastEl.style.cssText = "position:fixed;z-index:2147483647;padding:8px 14px;border-radius:6px;font:bold 14px system-sans-serif;pointer-events:none;box-shadow:0 2px 8px #0005;left:12px;top:" + lastY + "px;background:" + (ok ? "#34d399" : ok===null?"#fbbf24":"#ef4444") + ";color:#fff;border:2px solid white;";
    toastEl.textContent = txt;
    if (sub) { const s = document.createElement("span"); s.style.fontWeight = "normal"; s.style.opacity = ".8"; s.textContent = " — " + sub; toastEl.appendChild(s); }
    document.body.appendChild(toastEl); setTimeout(rm, ok ? 1500 : 3000);
  }

  function getHref(el) {
    if (!el) return null;
    var a = el.closest && el.closest('a[href]');
    if (a && a.href) return { href: a.href, type: 'link' };
    var img = null;
    if (el.closest) img = el.closest('img');
    if (!img && el.tagName === 'IMG') img = el;
    if (img && img.src) return { href: img.src, type: 'image' };
    return null;
  }

  function stopEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  // ── mousedown ───────────────────────────────────────────────────────────────
  document.addEventListener("mousedown", function (e) {
    var mods = [];
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Option/Alt");
    if (e.metaKey) mods.push("Cmd/Meta");
    if (e.ctrlKey) mods.push("Ctrl");

    // Show a diagnostic toast no matter what, so we know mousedown fired at all
    lastY = Math.min(e.clientY + 8, window.innerHeight - 50);

    if (!e.shiftKey || !e.altKey) {
      show("❌ wrong keys", mods.length ? mods.join("+") : "nothing pressed");
      return; // not our combo
    }
    if (e.metaKey || e.ctrlKey) {
      stopEvent(e);
      show("❌ extra key blocking", mods.join("+") + " — release Cmd/Ctrl");
      return;
    }

    var hrefInfo = getHref(e.target);
    if (!hrefInfo) {
      stopEvent(e);
      show("❌ no link/img here", "click the element itself");
      return;
    }

    // Dedup guard
    var id = e.target.outerHTML.slice(0,40) + "-" + e.timeStamp;
    if (handledSet.has(id)) {
      stopEvent(e);
      return;
    }

    stopEvent(e);
    handledSet.add(id);  // Dedup
    chrome.runtime.sendMessage({type:"shift-clicked"}).catch(() => {}); // kill new tab on mac brave
    chrome.storage.local.get("gateway_url", function (o) {
      var gw = o.gateway_url || "http://127.0.0.1:6380";
      show("📡 sending...", "(" + hrefInfo.type + ")");
      fetch(gw, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:hrefInfo.href})})
        .then(function(r){return r.json();}).then(function(d){show("✅ sent ("+hrefInfo.type+")",d.status==="queued"?"#"+d.queue_position:"",true);})
        .catch(function(){show("❌ fetch failed","is bridge running on :6380?",false);});
    });

  }, true);

  // ── click fallback + new-window blocker ──────────────────────────
  document.addEventListener("click", function (e) {
    var mods = [];
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Option/Alt");
    if (!e.shiftKey || !e.altKey) return;

    stopEvent(e);
  }, true);

})();


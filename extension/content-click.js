// ── Modifier-click content script v6.5.3 (clean reset) ────────────
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
    // Check image: try self first, then ancestors
    if (el.tagName === 'IMG' && el.src) return { href: el.src, type: 'image' };
    var img = el.closest && el.closest('img');
    if (img && img.src) return { href: img.src, type: 'image' };
    return null;
  }

  function stopEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function handleShiftOptionClick(e, eventType) {
    var mods = [];
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Option/Alt");

    // Return silently if not our key combo — don't block anything else
    if (!mods.includes("Shift") || !mods.includes("Option/Alt")) return;
    if (e.metaKey || e.ctrlKey) { stopEvent(e); return; } // block but allow their default behavior

    var hrefInfo = getHref(e.target);
    if (!hrefInfo) return;

    var id = e.target.outerHTML.slice(0,40) + "-" + e.timeStamp;
    if (handledSet.has(id)) { stopEvent(e); return; }

    stopEvent(e);
    handledSet.add(id);
    lastY = Math.min(e.clientY + 8, window.innerHeight - 50);

    // Tell background to kill the new window Mac will open for this URL
    chrome.runtime.sendMessage({type:"shift-clicked", url:hrefInfo.href}).catch(() => {});

    chrome.storage.local.get("gateway_url", function (o) {
      var gw = o.gateway_url || "http://127.0.0.1:6380";
      show("📡 sending...", "(" + hrefInfo.type + ")");
      fetch(gw, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:hrefInfo.href})})
        .then(function(r){return r.json();}).then(function(d){show("✅ sent ("+hrefInfo.type+")",d.status==="queued"?"#"+d.queue_position:"",true);})
        .catch(function(){show("❌ fetch failed","is bridge running on :6380?",false);});
    });
  }

  document.addEventListener("mousedown", function(e){ handleShiftOptionClick(e, "mousedown"); }, true);
  document.addEventListener("click", function(e){ handleShiftOptionClick(e, "click"); }, true);
})();

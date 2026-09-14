// Options page — persist settings + test connectivity
const GATEWAY_URL_KEY = "hermes_gateway_url";
const DEFAULT_GATEWAY = "http://127.0.0.1:6380";

document.addEventListener("DOMContentLoaded", async () => {
  const input    = document.getElementById("gatewayUrl");
  const statusEl = document.getElementById("status");

  // Load saved value
  const stored = (await chrome.storage.local.get(GATEWAY_URL_KEY))[GATEWAY_URL_KEY];
  input.value = stored || DEFAULT_GATEWAY;

  // Save on change
  input.addEventListener("input", async () => {
    await chrome.storage.local.set({ [GATEWAY_URL_KEY]: input.value.trim() });
    await testConnection(input.value.trim(), statusEl);
  });

  // Initial health check
  await testConnection(input.value, statusEl);
});

async function testConnection(url, statusEl) {
  if (!url) {
    setStatus(statusEl, false, "Enter a server address above.");
    return;
  }

  try {
    const resp = await fetch(url + "/healthz", { method: "GET" });
    const data = await resp.json();
    if (data.status === "ok") {
      setStatus(statusEl, true, `✓ Bridge server is up and responding.`);
    } else {
      setStatus(statusEl, false, `Unexpected response: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    setStatus(statusEl, false, `✗ Cannot reach bridge at ${url} — is it running? (${err.message})`);
  }
}

function setStatus(el, ok, message) {
  el.className = "status " + (ok ? "ok" : "err");
  el.textContent = message;
}

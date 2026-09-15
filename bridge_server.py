#!/usr/bin/env python3
"""
hermes-link-bridge — Tiny HTTP server that accepts link URLs from the Chrome extension
and pipes them to a configurable terminal command.

Usage:
    # Default: prints the URL (easy to pipe into whatever you want)
    python3 hermes_link_bridge.py

    # Or configure via environment:
    HERMES_LINK_COMMAND='mkdir -p ~/queue && echo %s >> ~/queue/links.txt' \
    python3 hermes_link_bridge.py

    # The default command echoes the URL to stdout (and logs timestamped copies).
"""

import http.server
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from socketserver import ThreadingMixIn

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("HERMES_LINK_PORT", 6380))
COMMAND = os.environ.get(
    "HERMES_LINK_COMMAND",
    None,  # None → built-in fallback: log + return success
)

LOG_DIR = os.path.expanduser("~/.hermes/link_bridge")
LOG_FILE = os.path.join(LOG_DIR, "links.log")


# ── Live stream echo helpers ──────────────────────────────────────

def _echo_stream(stream, label):
    """Read a subprocess stream line-by-line and print to terminal LIVE as each line arrives."""
    for line in iter(stream.readline, ""):
        prefix = f"[{label}] " if label else ""
        sys.stdout.write(f"{prefix}{line}")
        sys.stdout.flush()


def handle_url(url: str):
    """Process an incoming URL — run the command or log it."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if COMMAND:
        shell_cmd = COMMAND.replace("%s", url, 1)
        print(f"\n▶ {shell_cmd}\n", flush=True)

        try:
            proc = subprocess.Popen(
                shell_cmd, shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            # Spawn threads that print each line to the terminal AS IT ARRIVES
            out_thread = threading.Thread(target=_echo_stream, args=(proc.stdout, "out"))
            err_thread = threading.Thread(target=_echo_stream, args=(proc.stderr, "err"))
            out_thread.start()
            err_thread.start()

            exit_code = proc.wait()
            out_thread.join(timeout=3)
            err_thread.join(timeout=3)

            print(f"✔ Exited with code {exit_code}\n", flush=True)

            return {
                "status": "ran",
                "exit_code": exit_code,
            }
        except Exception as exc:
            print(f"✘ Error: {exc}", flush=True)
            return {"status": "error", "detail": str(exc)}
    else:
        # Default behaviour: append timestamped URL to log file (ensure dir exists)
        os.makedirs(LOG_DIR, exist_ok=True)
        try:
            with open(LOG_FILE, "a") as f:
                f.write(f"{ts}\t{url}\n")
            return {"status": "logged", "log_file": LOG_FILE}
        except FileNotFoundError:
            return {
                "status": "logged_partial",
                "detail": "URL received but log file not writable",
                "url": url,
            }


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode()

        try:
            data = json.loads(body)
            url = data.get("url", "")
        except (json.JSONDecodeError, AttributeError):
            url = body.strip()

        if not url:
            self._respond(400, {"error": "No URL provided"})
            return

        print(f"← POST received: {url}", flush=True)

        # Fire-and-forget: run the command in a background thread so we can
        # return instantly. Without this, gdl downloads >30s cause Chrome's
        # MV3 fetch to timeout → BrokenPipeError before we write the response.
        threading.Thread(target=handle_url, args=(url,), daemon=True).start()
        self._respond(200, {"status": "queued", "url": url})

    def do_GET(self):
        # Health-check + read log
        if self.path == "/healthz":
            self._respond(200, {"status": "ok"})
        elif self.path.startswith("/log"):
            try:
                with open(LOG_FILE) as f:
                    lines = f.readlines()
                limit = int(self.path.split("=")[-1]) if "=" in self.path else 50
                self._respond(200, {"links": [l.strip() for l in lines[-limit:]]})
            except FileNotFoundError:
                self._respond(200, {"links": []})
        else:
            self._respond(404, {"error": "Not found"})

    def _respond(self, code, obj):
        resp = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(resp)))
        try:
            self.end_headers()
            self.wfile.write(resp)
        except (BrokenPipeError, ConnectionResetError):
            # Client (MV3 service worker) timed out and closed the connection
            # while we were still writing. gdl downloads take >30s.
            pass

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self._respond(204, {})

    def handle(self):
        """Override to swallow BrokenPipeError at the request level."""
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError):
            pass

    def log_message(self, fmt, *args):
        # Silence default stderr logging
        pass


class ThreadedHTTPServer(ThreadingMixIn, http.server.HTTPServer):
    """Handle each HTTP request in its own thread so long-running gdl doesn't block the extension."""
    daemon_threads = True


if __name__ == "__main__":
    # Ensure log dir and file exist at startup
    os.makedirs(LOG_DIR, exist_ok=True)
    if not os.path.exists(LOG_FILE):
        open(LOG_FILE, "a").close()
        print(f"  Created log file: {LOG_FILE}")

    server = ThreadedHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(
        f"✓ hermes-link-bridge listening on {LISTEN_HOST}:{LISTEN_PORT}\n"
        f"  Send: curl -X POST http://{LISTEN_HOST}:{LISTEN_PORT} "
        f'-H "Content-Type: application/json" -d \'{{"url":"https://example.com"}}\'\n'
        f"  Log:  {LOG_FILE}"
    )
    if COMMAND:
        print(f"  Command: {COMMAND.replace('%s', '<URL>')}\n")
    else:
        print("  No command set — URLs will be logged to file.\n"
              "  Set HERMES_LINK_COMMAND='echo %s' to run a command per URL.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n✓ Stopped.")
        server.shutdown()

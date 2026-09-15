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
import urllib.request
from datetime import datetime, timezone

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("HERMES_LINK_PORT", 6380))
COMMAND = os.environ.get(
    "HERMES_LINK_COMMAND",
    None,  # None → built-in fallback: log + return success
)

LOG_DIR = os.path.expanduser("~/.hermes/link_bridge")
LOG_FILE = os.path.join(LOG_DIR, "links.log")


def handle_url(url: str):
    """Process an incoming URL — run the command or log it."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if COMMAND:
        shell_cmd = COMMAND.replace("%s", url, 1)
        try:
            proc = subprocess.Popen(
                shell_cmd, shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            full_out_lines = []
            full_err_lines = []

            # Stream stdout line-by-line, echo live to the terminal running this server
            for line in proc.stdout:
                print(line, end="", flush=True)
                full_out_lines.append(line.rstrip())

            # Also stream stderr so you see errors live
            for line in proc.stderr:
                sys.stderr.write(line)
                sys.stderr.flush()
                full_err_lines.append(line.rstrip())

            exit_code = proc.returncode if proc.returncode is not None else 0
            return {
                "status": "ran",
                "exit_code": exit_code,
                "output_lines": len(full_out_lines),
                "error_lines": len(full_err_lines),
            }
        except Exception as exc:
            return {"status": "error", "detail": str(exc)}
    else:
        # Default behaviour: append timestamped URL to log file
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(f"{ts}\t{url}\n")
        return {"status": "logged", "log_file": LOG_FILE}


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

        result = handle_url(url)
        self._respond(200, {**result, "url": url})

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
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, fmt, *args):
        # Silence default stderr logging
        pass


if __name__ == "__main__":
    server = http.server.HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
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

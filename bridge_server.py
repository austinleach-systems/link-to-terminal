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
from datetime import datetime, timedelta, timezone
from socketserver import ThreadingMixIn
from typing import Optional

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("HERMES_LINK_PORT", 6380))
COMMAND = os.environ.get(
    "HERMES_LINK_COMMAND",
    None,  # None → built-in fallback: log + return success
)

LOG_DIR = os.path.expanduser("~/.hermes/link_bridge")
LOG_FILE = os.path.join(LOG_DIR, "links.log")

# ── Per-origin FIFO executor ────────────────────────────────────────
import queue as _queue_mod
from urllib.parse import urlparse

_origin_queues: dict[str, _queue_mod.SimpleQueue] = {}        # origin → Queue
_origin_workers: dict[str, threading.Thread]       = {}        # origin → daemon thread
_origin_lock   = threading.Lock()                   # guards the dicts above


def _get_or_create_origin(url: str):
    """Derive a stable origin key from a URL (e.g. 'https://abc.com')."""
    try:
        u  = urlparse(url)
        return u.scheme + "://" + u.netloc
    except Exception:
        return "unknown"


def _ensure_worker(origin: str):
    """If this origin has no worker thread+queue yet, create them."""
    with _origin_lock:
        if origin in _origin_queues:
            return           # already exists
        q       = _queue_mod.SimpleQueue()
        _origin_queues[origin] = q
        t       = threading.Thread(
            target=_origin_worker_loop, args=(origin, q), daemon=True)
        _origin_workers[origin] = t
        t.start()
        print(f"  [worker started for {origin}]", flush=True)


def _origin_worker_loop(origin: str, q: _queue_mod.SimpleQueue):
    """Single-slot loop: pulls URLs from *this* origin's queue one at a time."""
    while True:
        url = q.get()   # blocks until a URL arrives
        try:
            handle_url(url)
        finally:
            pass


def register_queued(url: str):
    """Mark a URL as queued in ACTIVE_PROCESSES (keyed by origin-safe synthetic id)."""
    with _processes_lock:
        ACTIVE_PROCESSES[f"queued:{id('')}{len(ACTIVE_PROCESSES)}"] = {
            "pid": -1,
            "url": url,
            "command": COMMAND.split()[0] if COMMAND else "?",
            "started": datetime.now(timezone.utc).isoformat(),
            "status": "queued",
        }

# ── Active process registry ────────────────────────────────────────
# Maps pid → {pid, url, command, started, exit_code}
ACTIVE_PROCESSES = {}
_processes_lock = threading.Lock()


def promote_queued(url: str, pid: int):
    """Find the synthetic 'queued:' slot for this URL and upgrade it to running."""
    with _processes_lock:
        key = None
        rec  = None
        for k, v in ACTIVE_PROCESSES.items():
            if v["url"] == url and v["status"] == "queued":
                key, rec = k, v
                break
        if rec is not None:
            del ACTIVE_PROCESSES[key]
            rec["pid"]     = pid
            rec["status"]  = "running"
            rec["promoted"]= datetime.now(timezone.utc).isoformat()
            ACTIVE_PROCESSES[pid] = rec


def register_process(pid: int, url: str, command: str):
    with _processes_lock:
        ACTIVE_PROCESSES[pid] = {
            "pid": pid,
            "url": url,
            "command": command.split()[0] if " " in command else command,
            "started": datetime.now(timezone.utc).isoformat(),
            "status": "running",
        }


def finish_process(pid: int, exit_code: Optional[int]):
    with _processes_lock:
        rec = ACTIVE_PROCESSES.get(pid)
        if rec is not None:
            rec["exit_code"] = exit_code
            rec["status"] = "done" if (exit_code or 0) == 0 else "error"


def snapshot_processes():
    """Return the queue snapshot: position + running record + queued list."""
    with _processes_lock:
        now      = datetime.now(timezone.utc)
        running  = [(k,v) for k,v in ACTIVE_PROCESSES.items() if v["status"]=="running"]
        queued   = [(k,v) for k,v in ACTIVE_PROCESSES.items() if v["status"]=="queued"]
        errors   = [(k,v) for k,v in ACTIVE_PROCESSES.items() if v["status"]=="error"]

        # Prune: remove successful completions immediately, keep errors for 30m, queued forever
        cutoff = now - timedelta(minutes=30)
        pruned = [
            pid for pid, r in errors
            if datetime.fromisoformat(r.get("started", now.isoformat())) < cutoff or
               datetime.fromisoformat(
                   r.get("promoted", r["started"])) < cutoff]

        result_records: list[dict[str, object]] = []
        for i, (pid, rec) in enumerate(running):
            record = {**rec}
            start_ts = datetime.fromisoformat(rec.get("promoted", rec["started"]))
            age  = (now - start_ts).total_seconds()
            record["runtime"]      = f"{int(age)}s"
            record["origin"]       = _get_or_create_origin(record.get("url", ""))
            result_records.append(record)

        for i, (pid, rec) in enumerate(queued):
            record = {**rec}
            record["queue_position"] = i + 1
            record["origin"]         = _get_or_create_origin(record.get("url", ""))
            if "promoted" not in record:
                record["started2"] = now.isoformat()  # compat sentinel
            result_records.append(record)

        # Prune stale errors (older than cutoff)
        for pid in pruned:
            ACTIVE_PROCESSES.pop(pid, None)

        for _, rec in errors:
            rr = {**rec}
            rr["origin"] = _get_or_create_origin(rec.get("url", ""))
            result_records.append(rr)

    # Compute total queue depth (running + queued)
    with _processes_lock:
        queue_depth = sum(1 for v in ACTIVE_PROCESSES.values()
                          if v["status"] in ("running", "queued"))

    return {
        "count": len(result_records),
        "queue_depth": queue_depth,
        "data": result_records,
    }


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
        shell_cmd = COMMAND.replace("%s", f"'{url}'", 1)
        print(f"\n▶ {shell_cmd}\n", flush=True)

        proc = None
        try:
            proc = subprocess.Popen(
                shell_cmd, shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            promote_queued(url, proc.pid)  # Upgrade queued → running with real PID

            # Spawn threads that print each line to the terminal AS IT ARRIVES
            out_thread = threading.Thread(target=_echo_stream, args=(proc.stdout, "out"))
            err_thread = threading.Thread(target=_echo_stream, args=(proc.stderr, "err"))
            out_thread.start()
            err_thread.start()

            exit_code = proc.wait()
            out_thread.join(timeout=3)
            err_thread.join(timeout=3)

            finish_process(proc.pid, exit_code)

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

        origin = _get_or_create_origin(url)
        _ensure_worker(origin)          # lazily spawn worker+queue if first ever use
        q = _origin_queues[origin]
        queued_before = q.qsize()       # items *ahead* of this one for same origin
        q.put(url)

        if COMMAND:
            register_queued(url)

        position = queued_before + 1
        print(f"→ {origin}: Queued #{position}\n", flush=True)
        self._respond(200, {
            "status": "running" if position == 1 else "queued",
            "url": url,
            "queue_position": position,
            "origin": origin,
        })

    def do_GET(self):
        # Health-check + read log
        if self.path == "/healthz":
            self._respond(200, {"status": "ok"})
        elif self.path == "/processes":
            self._respond(200, snapshot_processes())
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

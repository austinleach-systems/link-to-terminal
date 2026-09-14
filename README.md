# Hermes Link Bridge

**Right-click any link in Chrome to send its URL to a terminal command.**

Inspired by [acg/shellac](https://github.com/acg/shellac) — same concept (Chrome extension → localhost bridge → shell command), rebuilt for **Manifest V3** since Shellac's Manifest V2 can no longer load in modern Chrome.

## What it does

1. A tiny Python HTTP server listens on `localhost:6380`
2. The Chrome extension adds **"Send to Terminal"** to the right-click menu on any link
3. Clicking sends the link URL to the bridge, which executes your configured command (or logs it)

## Setup

### 1. Start the bridge server

```bash
# Default: log URLs with timestamps to ~/.hermes/link_bridge/links.log
python3 bridge_server.py

# Or run a custom shell command for each URL (%s is replaced with the URL):
HERMES_LINK_COMMAND='echo %s >> ~/links.txt' python3 bridge_server.py

# Change the port if needed:
HERMES_LINK_PORT=9999 python3 bridge_server.py
```

### 2. Load the extension in Chrome

- Open `chrome://extensions/`
- Enable **Developer mode** (toggle in top-right)
- Click **Load unpacked**
- Select the `extension/` folder inside this repo

### 3. Configure the bridge address (optional)

- Click the extension icon → **Options**
- Enter your bridge server address (default: `http://127.0.0.1:6380`)
- A green checkmark means it can reach the server

### 4. Right-click any link → "Send to Terminal"

A ✓ badge appears on success, ✗ if the bridge isn't reachable.

## Commands you might want

Append to a read-later queue file:
```bash
HERMES_LINK_COMMAND='echo "$(date -Iseconds) %s" >> ~/read-later.txt' python3 bridge_server.py
```

Save as a bookmark with GNU `bookmark` (if installed):
```bash
HERMES_LINK_COMMAND='bookmark add --add-url "%s"' python3 bridge_server.py
```

Pipe through wget to download the page:
```bash
HERMES_LINK_COMMAND='wget -q -O /tmp/links/"$(basename %s)" %s' python3 bridge_server.py
```

Open in your default browser via `xdg-open`:
```bash
HERMES_LINK_COMMAND='xdg-open "%s"' python3 bridge_server.py
```

## Architecture

```
┌───────────────┐      POST /json       ┌──────────────────┐
│  Chrome        │ ── {"url":"..."} ───► │  bridge_server   │
│  extension     │                        │  (Python, port   │
│  MV3           │ ◄── {"status":"ok"} ─ │   6380)          │
└───────────────┘                        └────────┬─────────┘
                                                  │
                                           shell -c
                                                  ▼
                                            your command
```

## Endpoints

| Method | Path       | Description                    |
|--------|------------|--------------------------------|
| POST   | `/`        | Receive a URL (`{"url":"..."}`) |
| GET    | `/healthz` | Health check                   |
| GET    | `/log`     | Read logged URLs (last 50)     |

## License

MIT

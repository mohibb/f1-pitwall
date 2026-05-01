# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

F1 Pit Wall is a personal web app serving live F1 timing data during race weekends and a continuous replay of the last completed race at all other times. It is deployed on a home MacBook via Cloudflare Tunnel. Only the admin can create user accounts — there is no public registration.

## Development Setup

**Python version:** 3.11.9 (via pyenv). Python 3.14+ is incompatible with the pinned Jinja2/Starlette versions — do not upgrade.

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Required .env file (create before first run)
# SECRET_KEY=<random 32+ byte hex>
# ADMIN_USERNAME=<username>
# ADMIN_PASSWORD=<password>
# CACHE_DIR=f1_cache
# DB_PATH=f1_data.db
# REPLAY_SPEED=1.0
# ANTHROPIC_API_KEY=<key>  (only needed for /api/admin/fetch-pit-duration)
```

## Running the App

```bash
# Development (auto-reload, no Cloudflare tunnel)
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Production (starts Uvicorn + Cloudflare tunnel, prevents Mac sleep)
./start.sh

# Health/smoke check against running server
bash preflight.sh
```

There is no test suite. There is no linter configured.

## Architecture

### Threading Model

The FastAPI app runs in Uvicorn's async event loop. Two **daemon threads** run alongside it:

- **`session-manager`** thread (`SessionManager._run`) — polls Jolpica API every 60 seconds to detect live F1 sessions and switches between LIVE/REPLAY/IDLE modes.
- **`replay-engine`** thread (`ReplayEngine.run`) — ticks every second when in REPLAY mode, advancing `simulated_time` and writing new state.

### Shared State (`state.py`)

`state.py` is the **single data bus** between all threads and the HTTP layer. It holds one module-level dict (`_state`) protected by a `threading.Lock`.

- `get_state()` — returns a deep copy; safe to mutate the result.
- `update_state(patch)` — deep-merges `patch` into `_state`; only pass the keys you want to change.
- `reset_state()` — resets to defaults (called on mode transitions).

Both `LiveTimingClient` and `ReplayEngine` only write to state via `update_state()`. The API endpoint (`GET /api/state`) only reads via `get_state()`. Nothing else is shared between threads.

### Session Modes

The backend is always in exactly one mode:

```
LIVE   → SignalRClient streaming from F1 live timing
REPLAY → FastF1 post-session data simulated tick-by-tick (loops continuously)
IDLE   → Brief transition state (< ~30 seconds)
```

On startup: check for a live session → if none, load the last completed race → `REPLAY`. Mode switching is managed entirely by `SessionManager` (`session_manager.py`).

### Data Flow

```
F1 live timing feed  ──→  LiveTimingClient  ──→  update_state()  ──→  _state dict
FastF1 post-session  ──→  ReplayEngine      ──→  update_state()  ──┘
                                                                       │
Jolpica API ─────────────→  SessionManager (schedule + live detection) │
                                                                       ↓
                                                          GET /api/state (1s poll)
                                                                       │
                                                          poll.js dispatches f1:update DOM event
                                                                       │
                                             ┌─────────────┬──────────┴──────────┐
                                          timing.html  strategy.html  racecontrol.html ...
                                          circle_map.js
```

### State Shape

The `/api/state` JSON shape is the contract between backend and frontend (defined in `state.py`, documented fully in `docs/project_design.md`). Both LIVE and REPLAY write the same keys. The frontend never knows which mode is active.

Key fields under `drivers.<ABBR>`: `position`, `last_lap`, `best_lap`, `gap_to_leader`, `interval`, `gap_history` (last 10 laps), `compound`, `tyre_life`, `stint`, `pit_stops`, `sector_1/2/3`, `in_pit`, `lap_fraction` (0.0–1.0), `team_colour`, `stint_avg_lap`, `delta_to_fastest`.

### Settings (SQLite)

The `settings` table in SQLite stores admin-configurable values:

| Key | Default | Used by |
|---|---|---|
| `pit_stop_duration` | `25` | `ReplayEngine._process_laps` — determines `in_pit` window |
| `replay_speed` | `1` | `ReplayEngine.tick` — speed multiplier, read every tick |

`ReplayEngine` reads both on **every tick** via `get_setting_sync()` (synchronous SQLite call on the background thread). Admin can change these at `/admin/settings` and they take effect immediately — no restart needed.

### Authentication

JWT stored in an HTTP-only cookie (`access_token`). Two dependency functions in `auth.py`:

- `get_current_user` — raises 401 (for API routes)
- `get_current_user_or_redirect` — raises 307 → `/login` (for HTML routes)
- `require_admin` — wraps `get_current_user_or_redirect`, also checks `is_admin`

Login is rate-limited to 5 attempts/minute/IP via `slowapi`.

### Frontend

- **`poll.js`** — single global `setInterval` (1s), fetches `/api/state`, dispatches `new CustomEvent('f1:update', { detail: state })` on `document`. All page scripts listen for this event.
- **`circle_map.js`** — renders on HTML5 Canvas. Driver position: `lap_fraction * 360°`. Pit window arc: `(pit_stop_duration / avg_lap_time) * 360°`. Smooth movement via linear interpolation between frames.
- No JS framework. No build step. No bundler.

### Key Files

| File | Role |
|---|---|
| `main.py` | FastAPI app init, lifespan (starts/stops SessionManager) |
| `state.py` | Thread-safe in-memory state dict — the core data bus |
| `session_manager.py` | Mode switching (LIVE/REPLAY/IDLE), Jolpica polling |
| `live_timing.py` | FastF1 `SignalRClient` wrapper, writes live data to state |
| `replay_engine.py` | Tick-based replay simulation, computes gaps/lap_fraction/stint data |
| `fastf1_loader.py` | FastF1 data extraction utilities (laps, weather, RC messages, schedule) |
| `database.py` | SQLite via aiosqlite: users + settings. `get_setting_sync()` for sync access from threads |
| `auth.py` | JWT creation/validation, FastAPI dependency functions |
| `routers/api.py` | JSON endpoints (`/api/state`, `/api/schedule`, `/api/health`, admin tools) |
| `routers/web.py` | HTML page routes, login/logout, admin user/settings management |

## Established Technical Decisions

These are final — do not propose alternatives unless explicitly asked (see `docs/technical_decisions.md`):

- **No WebSockets** — HTTP polling at 1s is the chosen approach
- **No JS framework** — vanilla JS only
- **No Docker** — direct process management via `start.sh`
- **No external DB** — SQLite only
- **No public registration** — admin creates all users
- **Cloudflare Tunnel** — not port forwarding; TLS handled by Cloudflare
- **Jolpica API** (`api.jolpi.ca`) — schedule source; Ergast is deprecated and must not be used
- **`bcrypt==4.0.1`** — pinned; newer versions break `passlib`
- **`fastapi==0.109.2`, `starlette==0.36.3`, `jinja2==3.1.3`** — pinned for Python 3.11 compatibility

## Dependency Pins

`fastapi`, `starlette`, and `jinja2` are pinned because Python 3.11 has compatibility issues with newer versions. `bcrypt` is pinned to `4.0.1` because `passlib` is incompatible with `bcrypt` ≥ 4.1. Do not bump these without verifying compatibility.

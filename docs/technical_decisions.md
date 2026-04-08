# F1 Pit Wall — Technical Decisions

> These decisions are final for the current build. Do not suggest alternatives
> unless explicitly asked. This document exists to prevent Claude from
> second-guessing established choices in phase chats.

---

## Project Identity

| Property | Value |
|---|---|
| Project name | F1 Pit Wall |
| Domain | f1.mohibb.com |
| Host machine | MacBook Pro Early 2015 |
| Host OS | macOS 12.7 |
| Exposure | Cloudflare Tunnel (not port forwarding) |
| Operation mode | On-demand (manually started) |

---

## Language & Runtime

| Decision | Choice | Reason |
|---|---|---|
| Language | Python | FastF1 is Python-only |
| Python version | 3.11.9 (via pyenv) | Python 3.14 has incompatible Jinja2/Starlette behaviour; 3.11 is stable and works |
| Virtual environment | `venv` | Standard, no extra tooling required |
| Package management | `pip` + `requirements.txt` | Simple, no Poetry/Pipenv overhead |

---

## Backend

| Decision | Choice | Reason |
|---|---|---|
| Web framework | FastAPI | Async, fast, serves both HTML and JSON, native background tasks, excellent dependency injection |
| ASGI server | Uvicorn | Standard FastAPI server, supports async |
| HTML templating | Jinja2 | Native FastAPI integration, sufficient for server-rendered pages |
| Background threads | Python `threading` | Session manager and replay engine run as daemon threads alongside Uvicorn |

---

## Database

| Decision | Choice | Reason |
|---|---|---|
| Database | SQLite | Zero infrastructure, single file, sufficient for < 10 users and timing history |
| SQLite driver | `aiosqlite` | Async-compatible with FastAPI |
| ORM | None | Raw SQL via aiosqlite — schema is simple enough, no ORM overhead needed |
| Migrations | Manual | Schema is small and stable; no migration framework needed at this scale |

---

## Authentication

| Decision | Choice | Reason |
|---|---|---|
| Auth mechanism | JWT | Stateless, works for both browser (cookie) and API (Bearer header) |
| JWT storage (browser) | HTTP-only cookie | Cannot be accessed by JavaScript, protects against XSS |
| JWT storage (API clients) | Authorization: Bearer header | Standard for programmatic access |
| JWT library | `python-jose[cryptography]` | Well-maintained, FastAPI recommended |
| Password hashing | bcrypt via `passlib[bcrypt]` | Industry standard, slow by design (brute-force resistant) |
| JWT expiry | 24 hours | Reasonable for personal use |
| Rate limiting | `slowapi` | Simple FastAPI-compatible rate limiter, applied to /login endpoint |
| Rate limit threshold | 5 attempts per minute per IP | Prevents brute force without blocking legitimate use |
| Registration | Admin-only | No public registration endpoint exists anywhere in the codebase |

---

## Real-time Data

| Decision | Choice | Reason |
|---|---|---|
| Live timing source | FastF1 `SignalRClient` | Official F1 live timing stream |
| Historical/replay data | FastF1 post-session API | Provides laps, telemetry, weather, race control |
| Update mechanism | HTTP polling every 3 seconds | Sufficient for F1 timing cadence, simpler and more reliable than WebSockets |
| Polling endpoint | `GET /api/state` | Returns full current state as JSON |
| Shared state | In-memory Python dict + `threading.Lock` | Fast reads, thread-safe writes |
| State persistence | SQLite `timing_history` table | Written async in background during live sessions, enables future replay |
| FastF1 cache | Local directory `f1_cache/` | Mandatory — prevents re-downloading data, required for replay performance |

---

## Session Modes

| Mode | Trigger | Data source |
|---|---|---|
| `LIVE` | Active F1 session detected | `SignalRClient` stream |
| `REPLAY` | No live session / session just ended | FastF1 post-session data |
| `IDLE` | Transition between modes | None (brief, < 5 seconds) |

- Default on startup: check for live session → if none, load last completed race → `REPLAY`
- Replay loops continuously (end of race → restart from lap 1)
- Replay default speed: `1x` (real time)
- Frontend never knows which mode is active — same state dict shape for both

---

## Frontend

| Decision | Choice | Reason |
|---|---|---|
| Frontend approach | Vanilla JS | No framework overhead, simple polling loop, easy to maintain |
| No framework | React/Vue/Svelte explicitly excluded | Unnecessary complexity for this use case |
| CSS approach | Custom CSS with variables | Full control over pit wall aesthetic |
| Canvas/SVG | HTML5 Canvas for circle map | Better performance for real-time animation than SVG DOM manipulation |
| Fonts | JetBrains Mono (timing data), Inter (UI text) | Monospace essential for aligned timing columns; loaded from Google Fonts |
| Polling | Single global poll loop in `poll.js` | One fetch per 3 seconds regardless of how many pages/components are active |
| State distribution | Custom DOM event `f1:update` | Pages subscribe to event, decouple from polling mechanism |

---

## Visual Design

| Property | Value |
|---|---|
| Background | `#0a0a0a` |
| Surface | `#141414` |
| Border | `#2a2a2a` |
| Primary text | `#ffffff` |
| Muted text | `#888888` |
| Accent (F1 red) | `#e8002d` |
| SC yellow | `#ffd700` |
| VSC amber | `#ffa500` |
| Red flag | `#ff0000` |
| Purple sector | `#9b59b6` |
| Green sector | `#27ae60` |
| SOFT tyre | `#e8002d` |
| MEDIUM tyre | `#ffd700` |
| HARD tyre | `#ffffff` |
| INTER tyre | `#39b54a` |
| WET tyre | `#0067ff` |

---

## Circle Map

| Decision | Choice |
|---|---|
| Representation | Circle (not actual track outline) |
| Orientation | Clockwise, 12 o'clock = start/finish line |
| Driver position | Derived from `lap_fraction` (0.0–1.0) → angle |
| `lap_fraction` source | `(session_time - lap_start_time) / estimated_lap_time` |
| Estimated lap time | Rolling average of driver's last 3 clean laps |
| Gap visualisation | Angular distance between driver dots |
| Pit lane | Notch at ~270°, drivers `in_pit` shown inside notch |
| Pit window arc | `(avg_pit_loss_seconds / lap_time) * 360°` drawn behind driver |
| Ghost rejoin dot | Faded dot at estimated rejoin position |
| Rendering | HTML5 Canvas, redraws on every `f1:update` event |
| Smooth movement | Linear interpolation (lerp) between old and new position per frame |

---

## Deployment

| Decision | Choice |
|---|---|
| Tunnel | Cloudflare Tunnel (`cloudflared`) |
| Tunnel name | `f1-pitwall` |
| Hostname | `f1.mohibb.com` |
| Local port | `8000` |
| TLS | Handled by Cloudflare (not self-managed) |
| Startup | Manual via `start.sh` |
| Sleep prevention | `caffeinate -i` wrapping the start script |
| Process management | Simple background process (no systemd/launchd needed for on-demand use) |

---

## File Structure (Canonical)
f1-pitwall/
├── main.py
├── auth.py
├── database.py
├── state.py
├── session_manager.py
├── live_timing.py
├── replay_engine.py
├── routers/
│   ├── init.py
│   ├── web.py
│   └── api.py
├── templates/
│   ├── base.html
│   ├── login.html
│   ├── overview.html
│   ├── timing.html
│   ├── strategy.html
│   ├── racecontrol.html
│   ├── schedule.html
│   └── admin/
│       └── users.html
├── static/
│   ├── css/
│   │   └── pitwall.css
│   └── js/
│       ├── poll.js
│       └── circle_map.js
├── f1_cache/
├── f1_data.db
├── requirements.txt
├── .python-version
├── .env
├── start.sh
├── docs/
│   ├── technical_decisions.md
│   ├── project_design.md
│   ├── project_plan.md
│   └── fastf1_reference.md
└── README.md

---

## Dependencies (requirements.txt)
fastapi==0.109.2
starlette==0.36.3
jinja2==3.1.3
uvicorn[standard]
fastf1
pandas
numpy
passlib[bcrypt]
bcrypt==4.0.1
python-jose[cryptography]
slowapi
python-multipart
aiosqlite
python-dotenv

Note: `fastapi`, `starlette`, and `jinja2` are pinned due to Python 3.11 compatibility requirements.
`bcrypt` is pinned to 4.0.1 due to passlib incompatibility with newer versions.

---

## Environment Variables (.env)
SECRET_KEY=<random 32+ byte hex string>
ADMIN_USERNAME=<your username>
ADMIN_PASSWORD=<your password>
CACHE_DIR=f1_cache
DB_PATH=f1_data.db
REPLAY_SPEED=1.0

---

## What Is Explicitly Out of Scope

- WebSockets (polling is sufficient)
- React, Vue, Svelte, or any JS framework
- Docker or containerisation
- PostgreSQL or any external database server
- Redis or any external cache
- Any cloud hosting (AWS, GCP, Heroku etc.)
- Public user registration
- OAuth / social login
- Real-time telemetry during live sessions (post-session only)
- Mobile app (web app is mobile-responsive)
---

## Phase 7 Decisions

| Decision | Choice | Reason |
|---|---|---|
| Sub-phase 7.4 (live data recording) | Skipped | FastF1 post-session data is sufficient for replay. The `timing_history` table already exists in the schema if raw SignalR recording is needed in future. |

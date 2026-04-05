# F1 Pit Wall — Project Design Document

> Last updated: April 2026  
> Domain: mohibb.com  
> Host: MacBook Pro (Early 2015), static IP  
> Exposure: Cloudflare Tunnel → f1.mohibb.com

---

## Overview

A personal F1 pit wall web app and API. Authenticated users (read-only) view live F1 timing data during race weekends, and a simulated replay of the last completed race at all other times. Only the admin (Mohibb) can create users.

---

## Goals

- Live F1 timing data during sessions (lap times, gaps, tyres, race control)
- Circular track map showing real-time driver positions, gaps, and strategy info
- Replay mode 24/7 when no live session is active (last race, simulated live)
- Mobile and laptop friendly, dark pit-wall aesthetic
- Simple auth: login required, no public registration
- Future: user-controlled replay scrubbing, telemetry comparison, track heatmaps

---

## Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend | FastAPI (Python) | Serves both web UI and REST API, native async, great for background threads |
| Live timing | FastF1 `SignalRClient` | Official F1 live timing stream |
| Historical data | FastF1 post-session + Ergast API | Replay mode + schedule |
| Data store | In-memory dict + SQLite | In-memory for speed, SQLite for persistence and future replay |
| Auth | JWT in HTTP-only cookies | Secure, no JS-accessible tokens |
| Frontend | Jinja2 + Vanilla JS | No framework overhead, simple polling loop |
| Polling | HTTP GET `/api/state` every 3–5s | Simple, reliable, sufficient for F1 timing cadence |
| Tunnel | Cloudflare Tunnel (`cloudflared`) | No port forwarding, free HTTPS, hides home IP |
| Server | Uvicorn | ASGI server for FastAPI |

---

## Deployment Architecture

```
Phone / Laptop (browser)
    ↓ HTTPS
Cloudflare Edge  (TLS termination, DDoS protection)
    ↓ encrypted tunnel
cloudflared daemon  (MacBook)
    ↓ localhost
Uvicorn :8000  (FastAPI app)
    ├── Thread 1: FastAPI request handling
    └── Thread 2: Session Manager (SignalRClient or Replay Engine)
            ↓
    Shared in-memory state dict  (thread-safe, locked)
            ↓
    SQLite  (async writes for persistence)
```

---

## Session Modes

The backend runs in exactly one mode at all times, managed by the **Session Manager** background thread.

```
LIVE    — SignalRClient streaming from F1 live timing feed
REPLAY  — Last completed race replayed from FastF1 post-session data
IDLE    — Brief transition state between modes
```

### Mode switching logic

```
On startup:
    Is there a session live right now?
        YES → LIVE mode
        NO  → load last completed race → REPLAY mode

During LIVE:
    Session ends → save raw data to SQLite
               → load that session via FastF1
               → switch to REPLAY mode

During REPLAY:
    Live session detected → switch to LIVE mode
    Replay ends → restart from lap 1 (loops continuously)
```

### Replay mechanics

The replay engine reads FastF1 post-session data and feeds it into the same
shared state dict that LIVE mode uses. The frontend never knows which mode is active.

```python
# Pseudocode
while in_replay_mode:
    simulated_time += tick_interval * speed_multiplier
    events = get_all_events_before(simulated_time)
    update_shared_state(events)
    sleep(tick_interval)  # 3 seconds
```

**Speed multiplier:** configurable by admin. Default `1x` (real time, ~90 min loop).
`5x` available for testing (~18 min loop).

### Data replayed

| Data | FastF1 source |
|---|---|
| Lap times, positions | `session.laps` |
| Sector times | `session.laps` (Sector1Time, Sector2Time, Sector3Time) |
| Tyre compound + age | `session.laps` (Compound, TyreLife, FreshTyre) |
| Pit stops | `session.laps` (PitInTime, PitOutTime) |
| Race control messages | `session.race_control_messages` |
| Weather | `session.weather_data` |
| Gaps | Computed from position + lap times |

---

## Shared State Dict (API contract)

Both LIVE and REPLAY write to the same structure. The frontend only ever reads this.

```json
{
  "mode": "REPLAY",
  "session": {
    "name": "Race",
    "circuit": "Monza",
    "country": "Italy",
    "round": 16,
    "year": 2024,
    "simulated_time": "01:23:45",
    "total_laps": 53,
    "current_lap": 34
  },
  "weather": {
    "air_temp": 28.4,
    "track_temp": 41.2,
    "humidity": 38,
    "wind_speed": 12,
    "rainfall": false
  },
  "track_status": "1",
  "drivers": {
    "VER": {
      "position": 1,
      "last_lap": "1:21.456",
      "best_lap": "1:20.891",
      "gap_to_leader": "leader",
      "interval": "+0.000",
      "compound": "MEDIUM",
      "tyre_life": 18,
      "tyre_new": false,
      "stint": 2,
      "pit_stops": 1,
      "sector_1": "28.123",
      "sector_2": "31.445",
      "sector_3": "21.888",
      "in_pit": false,
      "lap_fraction": 0.412,
      "team": "Red Bull Racing",
      "team_colour": "#3671C6"
    }
  },
  "race_control": [
    {
      "time": "01:15:32",
      "message": "SAFETY CAR DEPLOYED",
      "flag": "SC",
      "lap": 28
    }
  ],
  "schedule": []
}
```

---

## Circular Track Map

### Concept

The track is represented as a circle. One full revolution = one full lap (0% → 100%).
Each driver is a coloured dot on the circle. Angular position represents how far
through the lap the driver is. Gap between dots = gap in time, converted to arc.

This representation is circuit-agnostic, always consistent, and ideal for showing
strategy information (gaps, pit windows, undercut threats).

### Maths

```
# Position on circle
angle = lap_fraction * 360°          # lap_fraction = 0.0 to 1.0

# Gap between two drivers in degrees
gap_degrees = (gap_seconds / estimated_lap_time) * 360°

# Pit stop window arc (how far behind is "safe" to pit)
pit_arc = (avg_pit_loss_seconds / estimated_lap_time) * 360°
# e.g. 23s pit loss / 90s lap * 360 = ~92° arc

# Estimated rejoin position (ghost dot)
rejoin_fraction = (current_fraction - pit_arc_fraction) % 1.0
```

### Deriving lap_fraction in replay mode

```
lap_fraction = (session_time - lap_start_time) / estimated_lap_time
estimated_lap_time = rolling average of driver's last 3 clean laps
```

### Visual elements on the circle

| Element | Visual | Data source |
|---|---|---|
| Driver dot | Coloured circle, team colour | `team_colour`, `lap_fraction` |
| Driver label | 3-letter abbreviation | `Driver` |
| Pit lane zone | Notch/gap on circle (~5°) | Fixed position |
| Driver in pit | Dot inside pit zone | `in_pit` flag |
| Sector boundaries | Arc dividers (S1/S2/S3) | Sector session times |
| DRS zones | Green arc segments | Circuit-specific, hardcoded per track |
| SC/VSC active | Circle outline pulses yellow/orange | `track_status` |
| Pit stop window | Shaded arc behind a driver | Computed from `avg_pit_loss` |
| Ghost dot (rejoin) | Faded dot, dashed outline | Computed rejoin position |
| Gap labels | Text between dots on arc | `interval` |

### Pit stop window logic

When a driver is in the pit window (within ~22–25 seconds of a car behind),
draw a shaded arc from that car's dot spanning the pit loss arc forward.
If the car behind is inside this arc, they are "in the undercut window."

---

## Pages

### Page 1 — Session Overview
*At-a-glance status screen*
- Session name, circuit, country, round, year
- Mode indicator: LIVE / REPLAY
- Simulated or real session clock
- Current lap / total laps
- Track status banner (green / yellow / SC / VSC / red flag)
- Weather strip: air temp, track temp, humidity, wind speed, rainfall
- Next session countdown (when idle)

### Page 2 — Timing Tower + Circle Map
*The core screen — two panels side by side*

**Left panel: Timing Tower**
- Position, driver abbreviation, team colour bar
- Last lap time, best lap time
- Gap to leader, interval to car ahead
- Tyre compound colour + tyre age (laps)
- Pit stop count
- Sector times (S1 / S2 / S3), colour coded (purple / green / yellow)
- In-pit indicator

**Right panel: Circular Track Map**
- All drivers as coloured dots on the circle
- Pit lane zone
- Sector arcs
- DRS zone arcs
- SC/VSC pulse
- Pit window arcs on hover/tap
- Ghost rejoin dot on hover/tap
- Gap labels between selected drivers

### Page 3 — Tyre Strategy
*Stint visualisation*
- Horizontal bar per driver across the race laps
- Bars colour-coded by compound (red/yellow/white/green/blue)
- Pit stop markers (lap number)
- Tyre age shown in each bar segment
- Total stop count per driver
- Projected stop (ghost bar) based on current tyre age vs typical stint length

### Page 4 — Race Control
*Stewards and flags feed*
- Chronological feed of all race control messages
- Colour coded: SC (yellow), VSC (yellow/white), red flag (red), penalty (orange), info (white)
- Weather chart: air temp + track temp + rainfall over session time
- Track status timeline: coloured bar showing flag history across the race

### Page 5 — Season Schedule
*Calendar screen*
- Full season event list: round, circuit, country, date
- Session dates per event (FP1/FP2/FP3/Q/Sprint/Race)
- Past events: greyed, linkable to results
- Upcoming events: highlighted, countdown to next session
- Current/active event: highlighted with live indicator

---

## Pages (Future / Post-session only)

These pages are designed now but locked behind a "REPLAY" or "POST-SESSION" mode flag.
They require full telemetry data which is only available after a session ends.

### Page 6 — Telemetry Comparison
- Pick two drivers, pick any lap
- Speed trace across lap distance
- Throttle overlay
- Brake overlay
- Gear trace
- DRS activation zones
- Mini delta chart (time gain/loss across distance)

### Page 7 — Driver Deep Dive
- Select any driver
- All laps: lap time, sector times, compound, tyre life, track status
- Lap time delta chart (vs own best)
- Speed traps across stints
- Personal best laps highlighted

### Page 8 — Historical Results
- Powered by Ergast API
- Any season back to 1950
- Race results, championship standings, qualifying, pit stops

---

## Auth & User Management

### Users table (SQLite)

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    is_admin      INTEGER DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Auth flow

```
GET /dashboard → not logged in → redirect /login
POST /login (username + password)
    → bcrypt verify
    → issue JWT (HTTP-only cookie, 24h expiry)
    → redirect /dashboard

GET /admin/users → JWT validated + is_admin check → user management UI
POST /admin/users/create → admin only → create user
POST /admin/users/delete → admin only → delete user

API calls → Authorization: Bearer <token> header
```

### Security

- Passwords hashed with bcrypt (passlib)
- JWT stored in HTTP-only cookie (not accessible to JS)
- No public registration endpoint
- `/admin/*` routes hard-gated behind `is_admin` flag
- Login endpoint rate-limited (slowapi middleware)
- HTTPS enforced by Cloudflare (all HTTP redirected to HTTPS)

---

## Project File Structure

```
f1-pitwall/
├── main.py                     # FastAPI app, startup, lifespan
├── auth.py                     # JWT creation/validation, bcrypt, dependencies
├── database.py                 # SQLite setup, user CRUD
├── state.py                    # Shared in-memory state dict + thread lock
├── session_manager.py          # Mode switching logic (LIVE/REPLAY/IDLE)
├── live_timing.py              # SignalRClient wrapper, parses live feed
├── replay_engine.py            # Loads FastF1 post-session data, simulates feed
├── routers/
│   ├── web.py                  # HTML page routes (login, dashboard, pages)
│   └── api.py                  # JSON API routes (/api/state, /api/schedule)
├── templates/
│   ├── base.html               # Base layout, nav, dark theme
│   ├── login.html
│   ├── overview.html           # Page 1
│   ├── timing.html             # Page 2 (tower + circle map)
│   ├── strategy.html           # Page 3
│   ├── racecontrol.html        # Page 4
│   ├── schedule.html           # Page 5
│   └── admin/
│       └── users.html          # Admin user management
├── static/
│   ├── css/
│   │   └── pitwall.css         # Dark theme, monospace fonts, layout
│   └── js/
│       ├── poll.js             # 3s polling loop, DOM update logic
│       └── circle_map.js       # Canvas/SVG circle map rendering
├── f1_cache/                   # FastF1 cache directory
├── f1_data.db                  # SQLite database (users + timing history)
├── requirements.txt
├── .env                        # SECRET_KEY, ADMIN_USERNAME, ADMIN_PASSWORD
├── start.sh                    # Startup script (uvicorn + cloudflared)
└── README.md
```

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | No | Redirect to `/dashboard` |
| GET | `/login` | No | Login page |
| POST | `/login` | No | Authenticate, set JWT cookie |
| POST | `/logout` | Yes | Clear JWT cookie |
| GET | `/dashboard` | Yes | Timing tower + circle map |
| GET | `/overview` | Yes | Session overview |
| GET | `/strategy` | Yes | Tyre strategy |
| GET | `/racecontrol` | Yes | Race control messages |
| GET | `/schedule` | Yes | Season schedule |
| GET | `/admin/users` | Admin | User management |
| POST | `/admin/users/create` | Admin | Create user |
| POST | `/admin/users/delete` | Admin | Delete user |
| GET | `/api/state` | Yes | Current full state JSON (polled every 3s) |
| GET | `/api/schedule` | Yes | Season schedule JSON |
| GET | `/api/health` | No | Server health check |

---

## Startup Script

```bash
#!/bin/bash
# start.sh — run this to bring the pit wall online

cd "$(dirname "$0")"
source .venv/bin/activate

echo "Starting F1 Pit Wall..."
uvicorn main:app --host 127.0.0.1 --port 8000 &
UVICORN_PID=$!

echo "Starting Cloudflare Tunnel..."
cloudflared tunnel run f1-pitwall

# When cloudflared exits, kill uvicorn too
kill $UVICORN_PID
```

---

## Frontend Design

### Aesthetic
- **Background:** near-black (`#0a0a0a`)
- **Primary text:** white, monospace font (JetBrains Mono or similar)
- **Timing data:** monospace, fixed-width columns for alignment
- **Team colours:** used for driver dots, sidebar accents, compound indicators
- **Compound colours:** SOFT red, MEDIUM yellow, HARD white, INTER green, WET blue
- **Status colours:** SC yellow, VSC yellow-white, red flag red, purple sector, green sector

### Layout
- **Desktop/laptop:** sidebar navigation (left) + main content area
- **Mobile:** bottom tab navigation + full-width content
- **Page 2 (timing + circle):** two-panel split on desktop, tabs on mobile

### Polling loop (poll.js)
```javascript
async function poll() {
    const res = await fetch('/api/state');
    const state = await res.json();
    updateTimingTower(state.drivers);
    updateCircleMap(state.drivers);
    updateWeather(state.weather);
    updateTrackStatus(state.track_status);
    updateRaceControl(state.race_control);
    updateSessionInfo(state.session);
}

setInterval(poll, 3000);
poll(); // immediate first call
```

---

## Requirements

```
fastapi
uvicorn[standard]
fastf1
pandas
numpy
passlib[bcrypt]
python-jose[cryptography]
slowapi
jinja2
python-multipart
aiosqlite
python-dotenv
```

---

## Build Order

1. Project scaffold — folders, requirements, .env, config
2. SQLite + user model + bcrypt auth + JWT
3. FastAPI app — login/logout, protected routes, admin routes
4. Shared state dict + session manager (mode switching)
5. Replay engine — FastF1 data loader + simulation loop
6. API endpoints — `/api/state`, `/api/schedule`
7. Frontend — base layout, dark theme, nav
8. Page 2 — timing tower + circle map (core feature)
9. Pages 1, 3, 4, 5 — overview, strategy, race control, schedule
10. Live timing — SignalRClient integration (test on next race weekend)
11. Cloudflare tunnel config + startup script
12. Admin UI — user management page

---

*Future features: telemetry comparison, driver deep dive, historical results,
user-controlled replay scrubbing, replay speed control, lap selector*

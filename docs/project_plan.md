# F1 Pit Wall — Project Plan

> Domain: mohibb.com → f1.mohibb.com  
> Host: MacBook Pro Early 2015, static IP, Cloudflare Tunnel  
> Stack: FastAPI · FastF1 · SQLite · Vanilla JS · Cloudflare Tunnel

---

## Phases at a Glance

| Phase | Focus | Deliverable |
|---|---|---|
| 1 | Foundation | Working server, auth, admin, database |
| 2 | Data layer | State dict, replay engine, FastF1 integration |
| 3 | API | All JSON endpoints, polling contract |
| 4 | Frontend core | Dark theme, nav, layout system |
| 5 | Pages | All 5 live pages built and connected |
| 6 | Circle map | Circular track visualisation |
| 7 | Live timing | SignalRClient, mode switching |
| 8 | Deployment | Cloudflare tunnel, startup script, hardening |
| 9 | Live testing | First real race weekend test |
| 10 | Polish | Bug fixes, mobile, edge cases |

---

## Phase 1 — Foundation

**Goal:** A running FastAPI server with login, logout, protected routes, and admin user management. No F1 data yet — just the skeleton everything else builds on.

### 1.1 Project scaffold
- Create folder structure as per design doc
- Set up Python virtual environment
- Write `requirements.txt`
- Create `.env` file (SECRET_KEY, ADMIN_USERNAME, ADMIN_PASSWORD, CACHE_DIR)
- Git init + `.gitignore` (exclude `.env`, `f1_cache/`, `*.db`)

### 1.2 Database
- `database.py` — SQLite setup via `aiosqlite`
- `users` table: id, username, hashed_password, is_admin, created_at
- `timing_history` table: session_key, lap, driver, data JSON, recorded_at (for future replay from recorded live data)
- Seed admin user on first run from `.env` values

### 1.3 Auth
- `auth.py` — bcrypt password hashing via `passlib`
- JWT creation and validation via `python-jose`
- JWT stored in HTTP-only cookie (24h expiry)
- FastAPI dependency: `get_current_user` — validates cookie on every protected route
- FastAPI dependency: `require_admin` — additionally checks `is_admin` flag
- Rate limiting on login endpoint via `slowapi` (5 attempts per minute per IP)

### 1.4 FastAPI app skeleton
- `main.py` — app init, lifespan, middleware, router registration
- `routers/web.py` — HTML routes: `/login`, `/logout`, `/dashboard`, `/admin/users`
- `routers/api.py` — stub routes returning empty JSON for now
- `templates/base.html` — base layout (dark background, nav placeholder)
- `templates/login.html` — login form
- `templates/admin/users.html` — create/delete users form

### 1.5 Admin user management
- List all users
- Create user (username + password, admin flag optional)
- Delete user
- Change password
- All gated behind `require_admin` dependency

**Phase 1 done when:** You can log in, see a blank dashboard, manage users, and log out. Server runs locally on port 8000.

---

## Phase 2 — Data Layer

**Goal:** The backend can load a completed F1 session via FastF1 and simulate it as a live replay into a shared in-memory state dict.

### 2.1 Shared state
- `state.py` — global state dict + `threading.Lock`
- Helper functions: `get_state()`, `update_state(patch)`, `reset_state()`
- State shape as per design doc (session, weather, drivers, race_control, mode)

### 2.2 FastF1 integration
- Enable FastF1 cache on startup pointing to `f1_cache/`
- Loader function: given year + round + session type → returns loaded `Session` object
- Helper: find the most recently completed race (walk back through schedule until a completed race round is found)
- Data extraction functions:
  - `extract_laps(session)` → list of lap events sorted by session time
  - `extract_weather(session)` → list of weather snapshots
  - `extract_race_control(session)` → list of messages
  - `extract_driver_info(session)` → static info (name, team, colour)

### 2.3 Replay engine
- `replay_engine.py` — class `ReplayEngine`
- Loads extracted data on init
- Internal clock: simulated session time, advances by `tick * speed_multiplier` every tick
- `tick()` method: finds all events up to current simulated time, writes to state dict
- Computes `lap_fraction` per driver (for circle map)
- Computes `interval` and `gap_to_leader` from positions
- Detects `in_pit` from PitInTime / PitOutTime windows
- Loops back to lap 1 when replay ends
- Speed multiplier: default `1x`, configurable

### 2.4 Session manager
- `session_manager.py` — class `SessionManager`, runs as a background thread
- On startup: check for live session → if none, load last race → start replay
- Exposes current mode: `LIVE` / `REPLAY` / `IDLE`
- Calls `ReplayEngine.tick()` every 3 seconds in replay mode
- Placeholder for live mode (Phase 7)
- Started in `main.py` lifespan using `asyncio` or `threading`

**Phase 2 done when:** Server starts, automatically loads the last completed race, and the in-memory state dict updates every 3 seconds with simulated timing data. Verifiable via a debug print or `/api/state` stub.

---

## Phase 3 — API

**Goal:** All JSON endpoints are live and returning real data from the state dict. The frontend polling contract is complete.

### 3.1 `/api/state`
- Returns full state dict as JSON
- Auth required (JWT cookie or Bearer token)
- Called every 3 seconds by the frontend
- Response time must be fast (< 100ms) — reads from memory, never hits disk

### 3.2 `/api/schedule`
- Returns full season schedule from FastF1
- Cached on first load (schedule doesn't change mid-season)
- Includes: round, event name, country, circuit, all session dates
- Marks past / upcoming / current event

### 3.3 `/api/health`
- No auth required
- Returns: mode, uptime, last update timestamp, FastF1 cache size
- Useful for debugging and monitoring

### 3.4 Error handling
- 401 for unauthenticated API requests (JSON response, not redirect)
- 403 for non-admin accessing admin endpoints
- 503 if state dict is empty / session manager not ready yet
- Global exception handler — never expose stack traces to client

**Phase 3 done when:** Hitting `/api/state` in the browser (with valid cookie) returns a full, updating JSON payload every time you refresh.

---

## Phase 4 — Frontend Core

**Goal:** The visual shell of the pit wall is in place. Dark theme, navigation, layout system, and the 3-second polling loop. No F1 data rendered yet beyond raw JSON.

### 4.1 Design system (CSS)
- `static/css/pitwall.css`
- Colour palette:
  - Background: `#0a0a0a`
  - Surface: `#141414`
  - Border: `#2a2a2a`
  - Primary text: `#ffffff`
  - Muted text: `#888888`
  - Accent: `#e8002d` (F1 red)
  - SC yellow: `#ffd700`
  - VSC: `#ffa500`
  - Red flag: `#ff0000`
  - Purple sector: `#9b59b6`
  - Green sector: `#27ae60`
- Typography: JetBrains Mono (Google Fonts) for timing data, Inter for UI text
- Compound colours: SOFT `#e8002d`, MEDIUM `#ffd700`, HARD `#ffffff`, INTER `#39b54a`, WET `#0067ff`
- CSS variables for all colours (easy theming)
- Responsive grid: sidebar on desktop, bottom nav on mobile

### 4.2 Base layout (`base.html`)
- `<head>`: fonts, CSS, meta viewport
- Desktop: fixed left sidebar (nav links, mode indicator, clock)
- Mobile: fixed bottom nav bar (icons + labels)
- Main content area: scrollable
- Mode badge: `● LIVE` (red pulse) or `↺ REPLAY` (grey)
- Session info strip at top: circuit name, round, session name

### 4.3 Navigation
- Page 1: Overview (⬡ icon)
- Page 2: Timing (≡ icon)
- Page 3: Strategy (▦ icon)
- Page 4: Race Control (⚑ icon)
- Page 5: Schedule (📅 icon)
- Active page highlighted
- Admin link visible only to admin users

### 4.4 Polling loop (`static/js/poll.js`)
```javascript
const POLL_INTERVAL = 3000;

async function poll() {
    try {
        const res = await fetch('/api/state');
        if (!res.ok) return;
        const state = await res.json();
        window._f1state = state;  // global for page scripts
        document.dispatchEvent(new CustomEvent('f1:update', { detail: state }));
        updateModeIndicator(state.mode);
        updateSessionStrip(state.session);
    } catch (e) {
        console.warn('Poll failed:', e);
    }
}

setInterval(poll, POLL_INTERVAL);
poll();
```
- Each page listens for `f1:update` event and updates its own DOM
- Pages don't poll individually — one poll, all pages update

**Phase 4 done when:** The pit wall shell loads, nav works, mode indicator shows REPLAY, session strip shows the circuit name, and the browser console shows the state JSON updating every 3 seconds.

---

## Phase 5 — Pages

**Goal:** All 5 live pages are built, connected to the polling loop, and rendering real data.

### 5.1 Page 1 — Session Overview (`overview.html`)
- Session name, circuit, country, round, year
- Mode badge (LIVE / REPLAY)
- Session clock (counting up in replay mode)
- Current lap / total laps
- Track status banner — full width, colour coded
- Weather strip: 6 tiles (air temp, track temp, humidity, wind speed, wind direction, rainfall)
- Next session card: name, date, countdown timer
- Recent race control messages (last 3)

### 5.2 Page 2 — Timing Tower (`timing.html`)
*Left panel only in this phase — circle map added in Phase 6*
- Table: position, driver name, team colour bar, last lap, best lap, gap, interval
- Tyre compound badge (coloured dot + compound initial + age)
- Sector times: S1 / S2 / S3, colour coded per driver (purple/green/yellow)
- Pit stop count
- In-pit row highlight
- Rows sorted by position, animate on position change
- Flash row on new lap time received

### 5.3 Page 3 — Tyre Strategy (`strategy.html`)
- SVG horizontal bar chart
- One row per driver, sorted by current position
- Bars divided by stint, coloured by compound
- Pit stop vertical markers (lap number label)
- Tyre age shown in each bar
- Current lap marker (vertical line across all rows)
- Tooltip on hover: compound, tyre age, laps in stint

### 5.4 Page 4 — Race Control (`racecontrol.html`)
- Scrollable feed of race control messages
- Each message: timestamp, lap number, coloured flag badge, message text
- Auto-scroll to latest message
- Weather chart: SVG line chart of air temp + track temp over session time
- Rainfall indicator overlay on chart
- Track status timeline: coloured horizontal bar, one colour per status period

### 5.5 Page 5 — Schedule (`schedule.html`)
- Full season event list
- Each event card: round number, flag emoji, event name, circuit, date
- Past events: muted/greyed
- Current event: highlighted with ring
- Next event: countdown timer
- Expand each event to show all session dates and times

**Phase 5 done when:** All 5 pages load, show real replayed data, and update every 3 seconds without a page refresh.

---

## Phase 6 — Circle Map

**Goal:** The circular track map is fully functional on Page 2, alongside the timing tower.

### 6.1 Canvas setup (`static/js/circle_map.js`)
- `<canvas>` element, responsive sizing
- Redraws on every `f1:update` event
- Centre point, radius calculated from canvas size
- Clockwise orientation, 12 o'clock = start/finish line

### 6.2 Static elements (drawn once, overlaid)
- Outer circle (track outline)
- Pit lane zone: small gap/notch at ~270° (bottom-left), labelled "PIT"
- Sector boundary markers: S1/S2/S3 dividers as tick marks
- DRS zone arcs: green arc segments (hardcoded per circuit, loaded from a circuit config JSON)
- Start/finish line marker at 12 o'clock

### 6.3 Driver dots
- Circle per driver, radius ~8px on desktop, ~6px on mobile
- Fill colour: team colour from state
- Border: white outline
- Label: 3-letter abbreviation, white, small monospace font
- Position: computed from `lap_fraction` → angle → x, y on circle
- Smooth interpolation between frames (lerp between old and new position)

### 6.4 Pit lane handling
- Driver with `in_pit: true` moves to pit lane zone
- Dot shown inside the notch, slightly offset per driver to avoid overlap
- Animates back onto circle at rejoin position after pit stop

### 6.5 Interactive elements
- Hover / tap a driver dot: show tooltip (name, gap, compound, tyre age)
- Hover / tap shows pit window arc for that driver
- Pit window arc: shaded sector showing pit loss distance behind the driver
- Ghost dot: shows estimated rejoin position if they pitted this lap
- Click elsewhere to dismiss

### 6.6 Track status overlays
- Normal: circle outline white
- SC deployed: circle outline pulses yellow
- VSC: circle outline pulses amber
- Red flag: circle outline solid red
- Yellow sector: that sector arc highlighted yellow

### 6.7 Layout integration
- Desktop Page 2: timing tower left (60%) + circle map right (40%)
- Mobile Page 2: timing tower tab + circle map tab (toggled)
- Circle map redraws responsively on window resize

**Phase 6 done when:** The circle map shows all drivers moving around the circle in real time, pit stops are visible, and hovering a driver shows the pit window.

---

## Phase 7 — Live Timing

**Goal:** The app switches to real F1 live timing data during actual sessions.

### 7.1 Live timing wrapper (`live_timing.py`)
- Wraps FastF1 `SignalRClient`
- Connects to F1 live timing stream
- Parses incoming messages: timing, position, race control, weather, tyre data
- Writes parsed data directly to shared state dict (same format as replay)
- Handles reconnection on drop

### 7.2 Session detection
- `session_manager.py` polls jolpica/Ergast API every 60 seconds
- Checks if current time falls within a known session window (with 10-min buffer)
- If live session detected → stop replay engine → start live timing client
- If session ends → stop live timing → save raw captured data to SQLite → load session via FastF1 → start replay

### 7.3 Mode transitions
- REPLAY → LIVE: seamless — state dict continues updating, frontend sees no interruption
- LIVE → REPLAY: brief IDLE state (~5s) while FastF1 loads the completed session data
- IDLE state shown in frontend: "Loading session data..." overlay

### 7.4 Live data recording
- All raw SignalR messages written to SQLite `timing_history` table during live session
- Enables future replay from recorded live data (higher fidelity than FastF1 post-session)

### 7.5 Testing strategy
- Test with a practice session first (lower stakes than race)
- Verify mode switching works correctly
- Verify state dict shape matches replay output (frontend should not notice the difference)

**Phase 7 done when:** During a real F1 session, the app automatically switches to LIVE mode, shows real timing data, and switches back to REPLAY when the session ends.

---

## Phase 8 — Deployment

**Goal:** The app is accessible at f1.mohibb.com, secured, and easy to start.

### 8.1 Cloudflare Tunnel setup
- Install `cloudflared` via Homebrew
- Authenticate with Cloudflare account
- Create named tunnel: `f1-pitwall`
- Configure tunnel: `~/.cloudflared/config.yml`
  ```yaml
  tunnel: f1-pitwall
  credentials-file: ~/.cloudflared/<tunnel-id>.json
  ingress:
    - hostname: f1.mohibb.com
      service: http://localhost:8000
    - service: http_status:404
  ```
- Add DNS CNAME in Cloudflare dashboard: `f1` → tunnel ID

### 8.2 Startup script (`start.sh`)
- Activate virtual environment
- Start Uvicorn in background
- Start cloudflared tunnel
- Trap Ctrl+C → kill both processes cleanly
- Print URL when ready

### 8.3 Security hardening
- Verify all routes require auth (except `/login`, `/api/health`)
- Confirm JWT cookie is HTTP-only and Secure flag set
- Confirm no stack traces leak to client
- Confirm `.env` is not committed to git
- Set `SECRET_KEY` to a long random string (32+ bytes)
- Set Cloudflare "Under Attack" mode off (too aggressive for personal use)
- Enable Cloudflare Access as an additional auth layer (optional but recommended)

### 8.4 FastF1 cache warm-up
- On first run, manually trigger load of current season's completed races
- Cache will be warm for replay mode from day one
- Document cache size expectations (~50–200MB per season)

### 8.5 macOS considerations
- Prevent Mac from sleeping while server is running: `caffeinate -i` wrapped around start script
- Confirm firewall allows outbound connections for cloudflared
- Test behaviour on network change (WiFi vs ethernet)

**Phase 8 done when:** `f1.mohibb.com` loads the login page over HTTPS from any device.

---

## Phase 9 — Live Race Test

**Goal:** Validate the full system during a real F1 race weekend.

### 9.1 Pre-session checklist
- Server started at least 30 minutes before session
- Cloudflare tunnel confirmed active
- FastF1 cache warmed for current season
- `/api/health` returns healthy
- Login tested from phone and laptop

### 9.2 During session
- Verify mode switches from REPLAY → LIVE automatically
- Verify timing tower updates with real data
- Verify race control messages appear
- Verify tyre data updates on pit stops
- Verify circle map positions are plausible
- Note any errors in server logs

### 9.3 Post-session
- Verify mode switches back to REPLAY automatically
- Verify replay loads the just-completed session
- Review SQLite timing_history for completeness
- Document any issues

### 9.4 Known risks
- F1 live timing server outage (mitigated by SQLite recording)
- SignalRClient disconnect mid-session (add reconnection logic in 7.1)
- MacBook sleep interrupting server (mitigated by caffeinate in start script)
- FastF1 post-session data delay (F1 doesn't release data instantly — may be 30–60 min after session)

---

## Phase 10 — Polish

**Goal:** The app is solid, mobile-friendly, and handles edge cases gracefully.

### 10.1 Mobile optimisation
- Test all pages on iPhone and Android
- Bottom nav usability
- Timing tower horizontal scroll on narrow screens
- Circle map touch events (tap for tooltip)
- Strategy page horizontal scroll
- Font size tuning for small screens

### 10.2 Edge cases
- Session with fewer than 20 drivers (partial grids)
- Driver retirement (mark as DNF in timing tower, remove from circle map)
- Red flag / session suspended state
- Safety car restart bunching (many drivers on same lap fraction)
- Driver with no lap time yet (formation lap, first lap)
- Missing FastF1 data for older sessions

### 10.3 Performance
- Confirm `/api/state` responds in < 100ms under normal load
- Profile replay engine tick for CPU usage on 2015 MacBook
- Confirm FastF1 session load doesn't block the server (run in thread executor)
- Monitor SQLite write performance during live session recording

### 10.4 Logging
- Structured logging to file (mode changes, errors, session loads)
- Log rotation (don't fill the SSD)
- Error alerts: email or push notification if server crashes mid-race (optional)

### 10.5 Documentation
- Update README with setup instructions
- Document how to add a new user
- Document how to start the server
- Document known limitations

---

## Future Features (Out of Scope Now)

These are designed into the architecture but not built yet.

| Feature | Prerequisite |
|---|---|
| User-controlled replay scrubbing | Phase 2 replay engine complete |
| Replay speed control (1x / 5x / 10x) | Phase 2 |
| Telemetry comparison page | Post-session FastF1 data loading |
| Driver deep dive page | Post-session data |
| Track speed heatmap | Post-session telemetry |
| Historical results (Ergast) | Ergast API integration |
| Additional projects on mohibb.com | New Cloudflare tunnel routes |
| Recorded live data replay | Phase 7 SQLite recording |
| Push notifications (race start etc.) | Phase 8 deployment |

---

## Summary Timeline

This is a solo project built in your own time. Phases are sequential — each builds on the last.

| Phase | Estimated effort |
|---|---|
| 1 — Foundation | 3–4 sessions |
| 2 — Data layer | 3–4 sessions |
| 3 — API | 1–2 sessions |
| 4 — Frontend core | 2–3 sessions |
| 5 — Pages | 4–6 sessions |
| 6 — Circle map | 3–4 sessions |
| 7 — Live timing | 2–3 sessions |
| 8 — Deployment | 1–2 sessions |
| 9 — Live race test | 1 race weekend |
| 10 — Polish | Ongoing |

A "session" here means a focused work block of 1–3 hours.

---

*Design document: project_design.md*  
*FastF1 reference: fastf1_reference.md*

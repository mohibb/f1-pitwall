# FastF1 Library Reference

> Version documented: **3.8.2** | Source: https://docs.fastf1.dev  
> FastF1 is unofficial and not associated with Formula 1 companies.

---

## Overview

FastF1 is a Python library for accessing and analyzing Formula 1 results, schedules, timing data, and telemetry. It wraps F1's live timing service and the Ergast-compatible jolpica-f1 API into an interface built on extended Pandas DataFrames.

**Key characteristics:**
- Python 3.10+ required
- All data returned as extended `pandas.DataFrame` / `pandas.Series` subclasses
- Two-stage caching system (HTTP responses + pickle files) — strongly recommended
- Matplotlib integration for visualization
- Data coverage: 2018–present for timing/telemetry; 1950–present via Ergast API for historical results

---

## Installation

```bash
pip install fastf1
```

**Dependencies:** requests, requests-cache, pandas, numpy, scipy, matplotlib, platformdirs, python-dateutil, timple, websockets, pyjwt, rapidfuzz, signalrcore, cryptography

---

## Caching (Always Enable This)

```python
import fastf1
fastf1.Cache.enable_cache('path/to/cache_dir')
```

- Must be called **before** any data loading
- Stage 1: raw HTTP responses cached on disk
- Stage 2: parsed Python objects cached as pickle files
- Cached requests do NOT count toward API rate limits
- Dramatically speeds up repeated runs

---

## Data Hierarchy

```
EventSchedule  (pandas.DataFrame subclass)
  └── Event    (pandas.Series subclass)  — one race weekend or test event
        └── Session              — Practice 1/2/3, Qualifying, Sprint, Race
              ├── session.results    → SessionResults (DataFrame)
              ├── session.laps       → Laps (DataFrame)
              │     └── lap.get_telemetry()  → Telemetry (DataFrame)
              └── session.car_data / session.pos_data  → raw Telemetry
```

---

## Loading Data

### Top-level functions (import via `fastf1`)

| Function | Description |
|---|---|
| `fastf1.get_session(year, round_or_name, session_id)` | Load a session object |
| `fastf1.get_event(year, round_or_name)` | Load an event object |
| `fastf1.get_event_schedule(year)` | Load the full season schedule |
| `fastf1.get_events_remaining(dt=None)` | Events remaining in the season |
| `fastf1.get_testing_session(year, test_number, session_number)` | Load a testing session |
| `fastf1.get_testing_event(year, test_number)` | Load a testing event |

### Session identifiers

| Identifier | Session |
|---|---|
| `'FP1'`, `'FP2'`, `'FP3'` | Practice 1, 2, 3 |
| `'Q'` | Qualifying |
| `'SQ'` | Sprint Qualifying |
| `'S'` | Sprint |
| `'R'` | Race |

### Examples

```python
import fastf1
fastf1.Cache.enable_cache('cache')

# By round number
session = fastf1.get_session(2023, 22, 'R')   # Abu Dhabi Race

# By event name (fuzzy matching)
session = fastf1.get_session(2021, 'French Grand Prix', 'Q')
session = fastf1.get_session(2021, 'Spain', 'R')   # fuzzy: finds Spanish GP
session = fastf1.get_session(2021, 'Silverstone', 'Q')  # by location

# By event object
event = fastf1.get_event(2021, 7)
session = event.get_race()        # also: get_qualifying(), get_practice(1), etc.

# Full schedule
schedule = fastf1.get_event_schedule(2023)
gp = schedule.get_event_by_round(12)
gp = schedule.get_event_by_name('Austin')
```

---

## Session Object (`fastf1.core.Session`)

### Loading session data

```python
session.load()   # Downloads all data: laps, telemetry, results, weather, etc.

# Selective loading (faster if you don't need everything):
session.load(laps=True, telemetry=True, weather=False, messages=False)
```

### Key properties

| Property | Type | Description |
|---|---|---|
| `session.name` | str | Session name, e.g. `'Race'`, `'Qualifying'` |
| `session.date` | Timestamp | Session start datetime |
| `session.event` | Event | Parent event info |
| `session.results` | SessionResults | Classified results for all drivers |
| `session.laps` | Laps | All laps from all drivers |
| `session.car_data` | dict | Raw car telemetry per driver number |
| `session.pos_data` | dict | Raw position data per driver number |
| `session.weather_data` | DataFrame | Weather samples during session |
| `session.race_control_messages` | DataFrame | Safety car, flags, etc. |
| `session.drivers` | list | Driver numbers present in session |

---

## Event Schedule (`fastf1.events.EventSchedule` / `fastf1.events.Event`)

### EventSchedule columns
`RoundNumber`, `Country`, `Location`, `OfficialEventName`, `EventDate`, `EventName`, `EventFormat`, `Session1`…`Session5`, `Session1Date`…`Session5Date`, `Session1DateUtc`…`Session5DateUtc`, `F1ApiSupport`

### Event methods
```python
event.get_race()           # → Session
event.get_qualifying()     # → Session
event.get_sprint()         # → Session
event.get_practice(number) # → Session (number = 1, 2, or 3)
event.get_session(name_or_id)
```

---

## Laps (`fastf1.core.Laps`)

A `pandas.DataFrame` subclass containing all laps for a session.

### Columns

| Column | Type | Description |
|---|---|---|
| `Time` | timedelta | Session time at lap end |
| `Driver` | str | Driver abbreviation (e.g. `'VER'`) |
| `DriverNumber` | str | Driver number as string |
| `LapTime` | timedelta | Lap duration |
| `LapNumber` | int | Lap number within session |
| `Stint` | int | Stint number |
| `PitOutTime` | timedelta | Time of pit exit |
| `PitInTime` | timedelta | Time of pit entry |
| `Sector1Time` | timedelta | Sector 1 time |
| `Sector2Time` | timedelta | Sector 2 time |
| `Sector3Time` | timedelta | Sector 3 time |
| `Sector1SessionTime` | timedelta | Session time at S1 crossing |
| `Sector2SessionTime` | timedelta | Session time at S2 crossing |
| `Sector3SessionTime` | timedelta | Session time at S3 crossing |
| `SpeedI1` | float | Speed trap at intermediate 1 [km/h] |
| `SpeedI2` | float | Speed trap at intermediate 2 [km/h] |
| `SpeedFL` | float | Speed at finish line [km/h] |
| `SpeedST` | float | Speed trap on longest straight [km/h] |
| `IsPersonalBest` | bool | Personal best lap for driver |
| `Compound` | str | Tyre compound (SOFT, MEDIUM, HARD, INTER, WET) |
| `TyreLife` | float | Estimated tyre age in laps |
| `FreshTyre` | bool | Whether tyre was new |
| `Team` | str | Team name |
| `LapStartTime` | timedelta | Session time at lap start |
| `LapStartDate` | datetime | Calendar time at lap start |
| `TrackStatus` | str | Track status flags during lap |
| `Position` | float | Track position at lap end |
| `Deleted` | bool | Lap time deleted (track limits etc.) |
| `DeletedReason` | str | Reason for deletion |
| `FastF1Generated` | bool | If lap was synthesized by FastF1 |
| `IsAccurate` | bool | Whether timing data is accurate |

### Selection methods on `Laps`

```python
laps.pick_driver('VER')                  # Single driver
laps.pick_drivers(['VER', 'HAM'])        # Multiple drivers
laps.pick_lap(5)                         # Specific lap number
laps.pick_fastest()                      # → Lap (fastest single lap)
laps.pick_quicklaps()                    # Remove outlier/slow laps
laps.pick_accurate()                     # Only IsAccurate == True
laps.pick_tyre('SOFT')                   # By compound
laps.pick_track_status('1')              # By track status code
laps.pick_wo_box()                       # Exclude in/out laps

# Telemetry from a lap
lap = laps.pick_fastest()
telemetry = lap.get_telemetry()          # → Telemetry
car_tel = lap.get_car_data()             # car channels only
pos_tel = lap.get_pos_data()             # position channels only
```

---

## Telemetry (`fastf1.core.Telemetry`)

High-frequency time-series data; a `pandas.DataFrame` subclass.

### Standard channels

**Car data (sampled ~3.7 Hz):**
| Channel | Type | Description |
|---|---|---|
| `Speed` | float | Car speed [km/h] |
| `RPM` | float | Engine RPM |
| `nGear` | int | Gear number (0 = neutral) |
| `Throttle` | float | Throttle pedal [%] (0–100; 104 = error/stationary) |
| `Brake` | bool | Brake applied |
| `DRS` | int | DRS status (0/1/8/10/12/14 — consult API docs) |

**Position data (sampled ~3.7 Hz):**
| Channel | Type | Description |
|---|---|---|
| `X` | float | X coordinate [1/10 m] |
| `Y` | float | Y coordinate [1/10 m] |
| `Z` | float | Z coordinate [1/10 m] |
| `Status` | str | `'OnTrack'` or `'OffTrack'` |

**Common time channels (both sources):**
| Channel | Description |
|---|---|
| `Time` | Elapsed time since slice start |
| `SessionTime` | Elapsed time since session start |
| `Date` | Full datetime of sample |
| `Source` | `'car'`, `'pos'`, or `'interpolated'` |

### Computed channels (methods)

```python
tel.add_distance()              # cumulative distance from start of slice
tel.add_differential_distance() # distance between consecutive samples
tel.add_relative_distance()     # 0.0–1.0 fraction of total distance
tel.add_driver_ahead()          # distance gap + car number of car ahead
tel.add_track_status()          # add track status flags
```

### Slicing methods

```python
tel.slice_by_lap(lap_or_laps)               # slice to a specific lap
tel.slice_by_time(start_time, end_time)     # slice to a time window
tel.slice_by_mask(boolean_mask)             # slice with bool array
```

### Merging / resampling

```python
# Merge two Telemetry objects with different channels onto same time axis
merged = car_tel.merge_channels(pos_tel)

# Resample to a specific frequency
resampled = tel.resample_channels(rule='100ms')
```

---

## Session Results (`fastf1.core.SessionResults`)

### Columns

`DriverNumber`, `BroadcastName`, `Abbreviation`, `DriverId`, `TeamName`, `TeamColor`, `TeamId`, `FirstName`, `LastName`, `FullName`, `HeadshotUrl`, `CountryCode`, `Position`, `ClassifiedPosition`, `GridPosition`, `Q1`, `Q2`, `Q3`, `Time`, `Status`, `Points`, `Laps`

### Example

```python
session.load()
top10 = session.results.iloc[0:10][['Abbreviation', 'Q3']]
```

---

## Plotting (`fastf1.plotting`)

### Setup

```python
from fastf1 import plotting
fastf1.plotting.setup_mpl(
    mpl_timedelta_support=True,   # better timedelta axis labels
    color_scheme='fastf1',        # dark F1-style theme (or None)
    misc_mpl_mods=True            # other tweaks
)
```

### Color / style helpers

```python
plotting.get_driver_color('VER', session)       # → hex color string
plotting.get_team_color('Red Bull Racing', session)
plotting.get_compound_color('SOFT', session)    # → hex color
plotting.get_driver_style('VER', style=['color', 'linestyle'], session)

# Mapping dicts for all drivers/teams in a session
plotting.get_driver_color_mapping(session)
plotting.get_compound_mapping(session)

# Lists
plotting.list_driver_abbreviations(session)
plotting.list_team_names(session)
plotting.list_compounds(session)

# Legend helper
plotting.add_sorted_driver_legend(ax, session)  # legend sorted by finishing pos
```

---

## Ergast / Jolpica API (`fastf1.ergast`)

Access historical data back to 1950. Returns `ErgastResultFrame` objects (DataFrame subclasses).

```python
from fastf1.ergast import Ergast
ergast = Ergast()

# Driver standings
standings = ergast.get_driver_standings(season=2023, round=22)

# Constructor standings
ergast.get_constructor_standings(season=2023)

# Race results
ergast.get_race_results(season=2021, round=15)

# Qualifying results
ergast.get_qualifying_results(season=2021, round=15)

# Lap times (historical)
ergast.get_laps(season=2021, round=15, driver='hamilton')

# Pit stops
ergast.get_pit_stops(season=2021, round=15)
```

---

## Circuit Information

```python
session.load()
circuit_info = session.get_circuit_info()

circuit_info.corners      # DataFrame: corner number, X, Y, angle, distance
circuit_info.marshal_lights  # DataFrame: marshal light positions
circuit_info.marshal_sectors # DataFrame: marshal sector positions
circuit_info.rotation     # float: track rotation angle in degrees
```

---

## Live Timing Client

Record live timing data during a session for redundancy/offline use.

```python
from fastf1.livetiming.client import SignalRClient

client = SignalRClient(filename='live_timing.txt')
client.start()   # blocks; stop with Ctrl+C
```

Load recorded data later:
```python
session = fastf1.get_session(2024, 1, 'R')
session.load(livedata=fastf1.livetiming.data.LiveTimingData('live_timing.txt'))
```

---

## Common Patterns / Recipes

### Fastest lap telemetry for a driver
```python
session = fastf1.get_session(2023, 'Bahrain', 'Q')
session.load()

ver_fastest = session.laps.pick_driver('VER').pick_fastest()
tel = ver_fastest.get_telemetry().add_distance()
```

### Compare two drivers' fastest laps
```python
laps = session.laps
ver = laps.pick_driver('VER').pick_fastest().get_car_data().add_distance()
ham = laps.pick_driver('HAM').pick_fastest().get_car_data().add_distance()

import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.plot(ver['Distance'], ver['Speed'], label='VER', color=plotting.get_driver_color('VER', session))
ax.plot(ham['Distance'], ham['Speed'], label='HAM', color=plotting.get_driver_color('HAM', session))
ax.legend()
plt.show()
```

### All laps for a driver in a race (tyre strategy)
```python
session = fastf1.get_session(2023, 'Monza', 'R')
session.load()
driver_laps = session.laps.pick_driver('LEC').pick_quicklaps()
print(driver_laps[['LapNumber', 'LapTime', 'Compound', 'TyreLife']])
```

### Season race schedule
```python
schedule = fastf1.get_event_schedule(2024, include_testing=False)
for _, event in schedule.iterrows():
    print(event['RoundNumber'], event['EventName'], event['EventDate'])
```

### Weather data
```python
session.load(weather=True)
weather = session.weather_data
# Columns: Time, AirTemp, Humidity, Pressure, Rainfall, TrackTemp, WindDirection, WindSpeed
```

---

## Session Load Flags

```python
session.load(
    laps=True,        # lap timing data
    telemetry=True,   # car + position telemetry (slow — large download)
    weather=True,     # weather samples
    messages=True,    # race control messages
    livedata=None     # LiveTimingData object (optional override)
)
```

Set `telemetry=False` if you only need lap times/results to speed up loading significantly.

---

## Exceptions

| Exception | When raised |
|---|---|
| `fastf1.core.DataNotLoadedError` | Accessing data before `session.load()` |
| `fastf1.core.NoLapDataError` | No lap data available for session |
| `fastf1.InvalidSessionError` | Session doesn't exist |

---

## Logging

```python
import fastf1
fastf1.set_log_level('WARNING')   # DEBUG, INFO, WARNING, ERROR, CRITICAL
```

---

## Public Subpackages

| Package | Contents |
|---|---|
| `fastf1.core` | Session, Laps, Lap, Telemetry, SessionResults, DriverResult |
| `fastf1.events` | EventSchedule, Event |
| `fastf1.ergast` | Ergast + response types |
| `fastf1.plotting` | Matplotlib helpers, colors, styles |
| `fastf1.livetiming` | SignalRClient, LiveTimingData |
| `fastf1.utils` | Utility functions |
| `fastf1.legacy` | Deprecated — avoid in new code |

---

## Notes & Gotchas

- **Always enable cache** — without it, every run re-downloads everything and may hit rate limits
- **Fuzzy event matching** can surprise you — verify results when using partial names
- **`IsAccurate` flag** — for analysis, filter to accurate laps only with `laps.pick_accurate()`
- **Telemetry source flag** — `'interpolated'` samples are synthesized; prefer `'car'` / `'pos'` for precision
- **Throttle value 104** — indicates unavailable/error data (car stationary), filter these out
- **DRS column** is an integer flag; consult the API docs for the full mapping of values
- **`pick_fastest()`** returns a single `Lap` (Series), not `Laps` (DataFrame)
- **Position coordinates** are in units of 1/10 meter (divide by 10 for meters)
- **Sprint weekends** have different session formats — use `EventFormat` column to detect
- **`fastf1.api` module** is deprecated and will be made private in future releases; do not use it

---

*Reference compiled April 2026 from https://docs.fastf1.dev (v3.8.2)*

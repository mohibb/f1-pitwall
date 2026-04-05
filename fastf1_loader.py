import fastf1
import pandas as pd
from datetime import datetime, timezone

fastf1.set_log_level('WARNING')


def enable_cache(cache_dir: str = "f1_cache") -> None:
    fastf1.Cache.enable_cache(cache_dir)


def get_last_completed_race() -> tuple[int, int] | None:
    """
    Walk back through the current season schedule to find the most recently
    completed race. Returns (year, round_number) or None if not found.
    """
    now = datetime.now(timezone.utc)
    year = now.year

    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
    except Exception as e:
        print(f"[loader] Could not load {year} schedule: {e}")
        return None

    completed = []
    for _, event in schedule.iterrows():
        try:
            race_date = event["Session5DateUtc"]
            if pd.isna(race_date):
                continue
            if race_date.tzinfo is None:
                race_date = race_date.replace(tzinfo=timezone.utc)
            if race_date < now:
                completed.append((year, int(event["RoundNumber"])))
        except Exception:
            continue

    if not completed:
        # Fall back to last race of previous year
        try:
            schedule = fastf1.get_event_schedule(year - 1, include_testing=False)
            for _, event in schedule.iterrows():
                completed.append((year - 1, int(event["RoundNumber"])))
        except Exception as e:
            print(f"[loader] Could not load {year - 1} schedule: {e}")
            return None

    if not completed:
        return None

    return completed[-1]


def load_session(year: int, round_number: int, session_type: str = "R") -> fastf1.core.Session | None:
    """
    Load and return a FastF1 session object with laps, weather, and messages.
    Telemetry is skipped for performance.
    """
    try:
        session = fastf1.get_session(year, round_number, session_type)
        session.load(laps=True, telemetry=False, weather=True, messages=True)
        print(f"[loader] Loaded: {session.event['EventName']} {year} — {session.name}")
        return session
    except Exception as e:
        print(f"[loader] Failed to load session {year} R{round_number}: {e}")
        return None


def extract_driver_info(session: fastf1.core.Session) -> dict:
    """
    Returns a dict keyed by driver abbreviation with static info:
    team name and team colour.
    """
    drivers = {}
    for _, row in session.results.iterrows():
        abbr = row["Abbreviation"]
        drivers[abbr] = {
            "team": row["TeamName"],
            "team_colour": "#" + row["TeamColor"] if row["TeamColor"] and not str(row["TeamColor"]).startswith("#") else (row["TeamColor"] or "#ffffff"),
        }
    return drivers


def extract_laps(session: fastf1.core.Session) -> list[dict]:
    """
    Returns all laps as a list of dicts sorted by session time.
    Each dict contains the fields needed to update shared state.
    """
    laps = session.laps.copy()
    laps = laps[laps["IsAccurate"] == True]

    records = []
    for _, lap in laps.iterrows():
        try:
            records.append({
                "driver":        lap["Driver"],
                "lap_number":    int(lap["LapNumber"]) if not pd.isna(lap["LapNumber"]) else None,
                "lap_time":      _fmt_timedelta(lap["LapTime"]),
                "session_time":  lap["Time"].total_seconds() if not pd.isna(lap["Time"]) else None,
                "lap_start_time": lap["LapStartTime"].total_seconds() if not pd.isna(lap["LapStartTime"]) else None,
                "pit_in_time":   lap["PitInTime"].total_seconds() if not pd.isna(lap["PitInTime"]) else None,
                "pit_out_time":  lap["PitOutTime"].total_seconds() if not pd.isna(lap["PitOutTime"]) else None,
                "compound":      lap["Compound"] if not pd.isna(lap["Compound"]) else "UNKNOWN",
                "tyre_life":     int(lap["TyreLife"]) if not pd.isna(lap["TyreLife"]) else 0,
                "fresh_tyre":    bool(lap["FreshTyre"]) if not pd.isna(lap["FreshTyre"]) else False,
                "stint":         int(lap["Stint"]) if not pd.isna(lap["Stint"]) else 1,
                "sector_1":      _fmt_timedelta(lap["Sector1Time"]),
                "sector_2":      _fmt_timedelta(lap["Sector2Time"]),
                "sector_3":      _fmt_timedelta(lap["Sector3Time"]),
                "position":      int(lap["Position"]) if not pd.isna(lap["Position"]) else None,
                "is_personal_best": bool(lap["IsPersonalBest"]) if not pd.isna(lap["IsPersonalBest"]) else False,
                "track_status":  lap["TrackStatus"] if not pd.isna(lap["TrackStatus"]) else "1",
            })
        except Exception:
            continue

    records.sort(key=lambda x: x["session_time"] or 0)
    return records


def extract_weather(session: fastf1.core.Session) -> list[dict]:
    """
    Returns weather snapshots as a list of dicts sorted by session time.
    """
    snapshots = []
    for _, row in session.weather_data.iterrows():
        try:
            snapshots.append({
                "session_time": row["Time"].total_seconds(),
                "air_temp":     float(row["AirTemp"]),
                "track_temp":   float(row["TrackTemp"]),
                "humidity":     float(row["Humidity"]),
                "wind_speed":   float(row["WindSpeed"]),
                "rainfall":     bool(row["Rainfall"]),
            })
        except Exception:
            continue
    return snapshots


def extract_race_control(session: fastf1.core.Session) -> list[dict]:
    """
    Returns race control messages as a list of dicts sorted by session time.
    """
    messages = []
    for _, row in session.race_control_messages.iterrows():
        try:
            messages.append({
                "session_time": row["Time"].total_seconds() if not pd.isna(row["Time"]) else 0,
                "message":      str(row["Message"]),
                "flag":         str(row["Flag"]) if not pd.isna(row["Flag"]) else "",
                "lap":          int(row["Lap"]) if not pd.isna(row["Lap"]) else None,
            })
        except Exception:
            continue
    return messages


def extract_total_laps(session: fastf1.core.Session) -> int:
    """Returns the total number of laps in the race."""
    try:
        return int(session.laps["LapNumber"].max())
    except Exception:
        return 0


def _fmt_timedelta(td) -> str | None:
    """Format a timedelta as M:SS.mmm string, or None if invalid."""
    if pd.isna(td):
        return None
    try:
        total_seconds = td.total_seconds()
        minutes = int(total_seconds // 60)
        seconds = total_seconds % 60
        return f"{minutes}:{seconds:06.3f}"
    except Exception:
        return None

import time
from collections import defaultdict

from fastf1_loader import (
    extract_driver_info,
    extract_laps,
    extract_race_control,
    extract_total_laps,
    extract_weather,
)
from state import update_state


class ReplayEngine:
    def __init__(self, session, speed: float = 1.0):
        self.speed = speed
        self.tick_interval = 3.0

        self.driver_info  = extract_driver_info(session)
        self.laps         = extract_laps(session)
        self.weather      = extract_weather(session)
        self.rc_messages  = extract_race_control(session)
        self.total_laps   = extract_total_laps(session)

        self.session_name = session.name
        self.circuit      = session.event["Location"]
        self.country      = session.event["Country"]
        self.round_number = int(session.event["RoundNumber"])
        self.year         = int(session.event["EventDate"].year)

        self.simulated_time = 0.0

        self._driver_state: dict[str, dict] = {}
        self._lap_times: dict[str, list[float]] = defaultdict(list)
        self._rc_emitted: list[dict] = []
        self._applied_laps: set[int] = set()

        self._max_time = max(
            (l["session_time"] for l in self.laps if l["session_time"]),
            default=7200.0,
        )

        print(f"[replay] Ready: {self.circuit} {self.year}, "
              f"{len(self.laps)} laps, {len(self.driver_info)} drivers, "
              f"max_time={self._max_time:.0f}s")

    # ------------------------------------------------------------------ #
    # Public                                                               #
    # ------------------------------------------------------------------ #

    def tick(self) -> None:
        self.simulated_time += self.tick_interval * self.speed

        if self.simulated_time > self._max_time:
            self._reset()

        self._process_laps()
        self._process_weather()
        self._process_race_control()
        self._push_state()

    def run(self, stop_event) -> None:
        print("[replay] Starting replay loop")
        while not stop_event.is_set():
            self.tick()
            time.sleep(self.tick_interval)
        print("[replay] Stopped")

    def seek(self, lap_number: int) -> bool:
        """
        Seek to the start of the given lap number.
        Returns True if successful, False if lap not found.
        """
        target_time = None
        for lap in self.laps:
            if lap["lap_number"] == lap_number and lap["lap_start_time"] is not None:
                if target_time is None or lap["lap_start_time"] < target_time:
                    target_time = lap["lap_start_time"]

        if target_time is None:
            return False

        print(f"[replay] Seeking to lap {lap_number} (t={target_time:.1f}s)")
        self.simulated_time = target_time
        self._driver_state.clear()
        self._lap_times.clear()
        self._rc_emitted.clear()
        self._applied_laps.clear()
        update_state({"race_control": []})

        # Fast-forward state up to the seek point
        self._process_laps()
        self._process_weather()
        self._process_race_control()
        self._push_state()

        return True

    # ------------------------------------------------------------------ #
    # Internal                                                             #
    # ------------------------------------------------------------------ #

    def _reset(self) -> None:
        print("[replay] End of session — looping back to start")
        self.simulated_time = 0.0
        self._driver_state.clear()
        self._lap_times.clear()
        self._rc_emitted.clear()
        self._applied_laps.clear()
        update_state({"race_control": []})

    def _process_laps(self) -> None:
        for idx, lap in enumerate(self.laps):
            if lap["session_time"] is None:
                continue
            if lap["session_time"] > self.simulated_time:
                break
            if idx in self._applied_laps:
                continue

            self._applied_laps.add(idx)

            driver = lap["driver"]
            if driver not in self._driver_state:
                self._driver_state[driver] = self._blank_driver(driver)

            ds = self._driver_state[driver]

            if lap.get("is_accurate") and lap["lap_time"]:
                try:
                    parts = lap["lap_time"].split(":")
                    secs = float(parts[0]) * 60 + float(parts[1])
                    if 60 < secs < 300:
                        self._lap_times[driver].append(secs)
                        if len(self._lap_times[driver]) > 3:
                            self._lap_times[driver].pop(0)
                except Exception:
                    pass

            if lap["lap_time"]:
                ds["last_lap"] = lap["lap_time"]
            ds["lap_number"]   = lap["lap_number"]
            ds["compound"]     = lap["compound"]
            ds["tyre_life"]    = lap["tyre_life"]
            ds["fresh_tyre"]   = lap["fresh_tyre"]
            ds["stint"]        = lap["stint"]
            ds["sector_1"]     = lap["sector_1"]
            ds["sector_2"]     = lap["sector_2"]
            ds["sector_3"]     = lap["sector_3"]
            ds["track_status"] = lap["track_status"]

            if lap["position"] is not None:
                ds["position"] = lap["position"]

            if lap["is_personal_best"] and lap["lap_time"]:
                ds["best_lap"] = lap["lap_time"]

            ds["in_pit"] = False
            if lap["pit_in_time"] is not None:
                pit_out = lap["pit_out_time"] or (lap["pit_in_time"] + 30)
                if lap["pit_in_time"] <= self.simulated_time <= pit_out:
                    ds["in_pit"] = True
                    ds["pit_stops"] = ds.get("pit_stops", 0) + 1

        for driver, ds in self._driver_state.items():
            ds["lap_fraction"] = self._compute_lap_fraction(driver, ds)

    def _compute_lap_fraction(self, driver: str, ds: dict) -> float:
        last_lap = None
        for lap in reversed(self.laps):
            if lap["driver"] == driver and lap["session_time"] <= self.simulated_time:
                last_lap = lap
                break
        if last_lap is None or last_lap["lap_start_time"] is None:
            return 0.0
        avg = self._avg_lap_time(driver)
        if avg <= 0:
            return 0.0
        elapsed = self.simulated_time - last_lap["lap_start_time"]
        return max(0.0, min(elapsed / avg, 1.0))

    def _avg_lap_time(self, driver: str) -> float:
        times = self._lap_times[driver]
        if not times:
            return 90.0
        return sum(times) / len(times)

    def _process_weather(self) -> None:
        current = None
        for snap in self.weather:
            if snap["session_time"] <= self.simulated_time:
                current = snap
            else:
                break
        if current:
            update_state({
                "weather": {
                    "air_temp":   current["air_temp"],
                    "track_temp": current["track_temp"],
                    "humidity":   current["humidity"],
                    "wind_speed": current["wind_speed"],
                    "rainfall":   current["rainfall"],
                }
            })

    def _process_race_control(self) -> None:
        new_messages = []
        for msg in self.rc_messages:
            if msg in self._rc_emitted:
                continue
            if msg["session_time"] <= self.simulated_time:
                new_messages.append(msg)
                self._rc_emitted.append(msg)

        if new_messages:
            from state import get_state
            existing = get_state().get("race_control", [])
            update_state({"race_control": existing + new_messages})

    def _push_state(self) -> None:
        drivers_patch = {}
        positions = sorted(
            [ds for ds in self._driver_state.values() if ds["position"] is not None],
            key=lambda x: x["position"],
        )

        leader_lap_time = None
        if positions:
            leader_abbr = positions[0]["abbreviation"]
            times = self._lap_times.get(leader_abbr)
            if times:
                leader_lap_time = times[-1]

        for ds in self._driver_state.values():
            abbr = ds["abbreviation"]
            gap, interval = self._compute_gaps(ds, positions, leader_lap_time)
            drivers_patch[abbr] = {
                "position":      ds["position"],
                "last_lap":      ds["last_lap"],
                "best_lap":      ds["best_lap"],
                "gap_to_leader": gap,
                "interval":      interval,
                "compound":      ds["compound"],
                "tyre_life":     ds["tyre_life"],
                "tyre_new":      ds["fresh_tyre"],
                "stint":         ds["stint"],
                "pit_stops":     ds["pit_stops"],
                "sector_1":      ds["sector_1"],
                "sector_2":      ds["sector_2"],
                "sector_3":      ds["sector_3"],
                "in_pit":        ds["in_pit"],
                "lap_fraction":  ds["lap_fraction"],
                "team":          ds["team"],
                "team_colour":   ds["team_colour"],
            }

        current_lap = max(
            (ds["lap_number"] for ds in self._driver_state.values() if ds["lap_number"]),
            default=None,
        )

        update_state({
            "mode": "REPLAY",
            "session": {
                "name":           self.session_name,
                "circuit":        self.circuit,
                "country":        self.country,
                "round":          self.round_number,
                "year":           self.year,
                "simulated_time": self._fmt_session_time(self.simulated_time),
                "total_laps":     self.total_laps,
                "current_lap":    current_lap,
            },
            "drivers": drivers_patch,
        })

    def _compute_gaps(self, ds: dict, positions: list, leader_lap_time: float | None) -> tuple[str, str]:
        if not positions or leader_lap_time is None or leader_lap_time <= 0:
            return ("leader", "+0.000")

        pos = ds["position"]
        if pos is None:
            return ("—", "—")

        if pos == 1:
            return ("leader", "+0.000")

        sorted_pos = sorted(positions, key=lambda x: x["position"])
        idx = next((i for i, d in enumerate(sorted_pos) if d["abbreviation"] == ds["abbreviation"]), None)
        if idx is None:
            return ("—", "—")

        leader = sorted_pos[0]
        ahead  = sorted_pos[idx - 1] if idx > 0 else None

        gap_frac    = (leader["lap_fraction"] - ds["lap_fraction"]) % 1.0
        gap_seconds = gap_frac * leader_lap_time

        if ahead:
            int_frac    = (ahead["lap_fraction"] - ds["lap_fraction"]) % 1.0
            int_seconds = int_frac * leader_lap_time
            return (f"+{gap_seconds:.3f}", f"+{int_seconds:.3f}")

        return (f"+{gap_seconds:.3f}", "—")

    def _blank_driver(self, abbreviation: str) -> dict:
        info = self.driver_info.get(abbreviation, {})
        return {
            "abbreviation": abbreviation,
            "team":         info.get("team", ""),
            "team_colour":  info.get("team_colour", "#ffffff"),
            "position":     None,
            "lap_number":   None,
            "last_lap":     None,
            "best_lap":     None,
            "compound":     "UNKNOWN",
            "tyre_life":    0,
            "fresh_tyre":   False,
            "stint":        1,
            "pit_stops":    0,
            "sector_1":     None,
            "sector_2":     None,
            "sector_3":     None,
            "in_pit":       False,
            "lap_fraction": 0.0,
            "track_status": "1",
        }

    @staticmethod
    def _fmt_session_time(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        return f"{h:02}:{m:02}:{s:02}"

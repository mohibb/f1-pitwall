import threading
import os
from dotenv import load_dotenv

from fastf1_loader import enable_cache, get_last_completed_race, load_session
from replay_engine import ReplayEngine
from state import update_state

load_dotenv()

CACHE_DIR    = os.getenv("CACHE_DIR", "f1_cache")
REPLAY_SPEED = float(os.getenv("REPLAY_SPEED", "1.0"))


class SessionManager:
    def __init__(self):
        self._stop_event    = threading.Event()
        self._replay_stop   = threading.Event()
        self._thread        = None
        self._replay_thread = None
        self.mode           = "IDLE"
        self.engine: ReplayEngine | None = None

    def start(self):
        enable_cache(CACHE_DIR)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print("[session] Session manager started")

    def stop(self):
        self._stop_event.set()
        self._replay_stop.set()
        print("[session] Session manager stopped")

    def seek(self, lap_number: int) -> bool:
        if self.engine is None:
            return False
        return self.engine.seek(lap_number)

    # ------------------------------------------------------------------ #
    # Internal                                                             #
    # ------------------------------------------------------------------ #

    def _run(self):
        update_state({"mode": "IDLE"})

        result = get_last_completed_race()
        if result is None:
            print("[session] No completed race found — staying IDLE")
            return

        year, round_number = result
        print(f"[session] Loading last completed race: {year} R{round_number}")

        session = load_session(year, round_number)
        if session is None:
            print("[session] Session load failed — staying IDLE")
            return

        self._start_replay(session)

    def _start_replay(self, session):
        self._replay_stop.clear()
        self.mode = "REPLAY"

        self.engine = ReplayEngine(session, speed=REPLAY_SPEED)

        self._replay_thread = threading.Thread(
            target=self.engine.run,
            args=(self._replay_stop,),
            daemon=True,
        )
        self._replay_thread.start()
        print("[session] Replay engine running")

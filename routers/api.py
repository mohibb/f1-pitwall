import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from auth import get_current_user
from state import get_state
from fastf1_loader import extract_schedule

router = APIRouter()

_start_time = time.time()
_schedule_cache: list[dict] = []
_schedule_year: int | None = None


def _get_schedule() -> list[dict]:
    global _schedule_cache, _schedule_year
    year = datetime.now(timezone.utc).year
    if _schedule_year == year and _schedule_cache:
        return _schedule_cache
    print(f"[api] Loading schedule for {year}")
    _schedule_cache = extract_schedule(year)
    _schedule_year = year
    return _schedule_cache


def _cache_size_mb(cache_dir: str = "f1_cache") -> float:
    total = 0
    if os.path.isdir(cache_dir):
        for dirpath, _, filenames in os.walk(cache_dir):
            for f in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
    return round(total / (1024 * 1024), 2)


@router.get("/state")
async def get_state_endpoint(current_user=Depends(get_current_user)):
    state = get_state()
    if state.get("mode") == "IDLE" and not state.get("drivers"):
        raise HTTPException(
            status_code=503,
            detail="Session data not yet available. Server is still loading.",
        )
    return JSONResponse(content=state)


@router.get("/schedule")
async def get_schedule(current_user=Depends(get_current_user)):
    schedule = _get_schedule()
    return {"schedule": schedule}


@router.get("/health")
async def health():
    state = get_state()
    uptime_seconds = int(time.time() - _start_time)
    hours, remainder = divmod(uptime_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return {
        "status": "ok",
        "mode": state.get("mode", "IDLE"),
        "uptime": f"{hours:02}:{minutes:02}:{seconds:02}",
        "uptime_seconds": uptime_seconds,
        "last_update": datetime.now(timezone.utc).isoformat(),
        "cache_size_mb": _cache_size_mb(),
    }

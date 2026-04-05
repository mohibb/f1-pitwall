from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from auth import get_current_user
from state import get_state

router = APIRouter()


@router.get("/state")
async def get_state_endpoint(current_user=Depends(get_current_user)):
    return JSONResponse(content=get_state())


@router.get("/schedule")
async def get_schedule(current_user=Depends(get_current_user)):
    state = get_state()
    return {"schedule": state.get("schedule", [])}


@router.get("/health")
async def health():
    state = get_state()
    return {
        "status": "ok",
        "mode": state.get("mode", "IDLE"),
    }

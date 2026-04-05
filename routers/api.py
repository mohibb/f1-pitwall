from fastapi import APIRouter, Depends
from auth import get_current_user

router = APIRouter()


@router.get("/state")
async def get_state(current_user=Depends(get_current_user)):
    return {"status": "ok", "data": {}}


@router.get("/schedule")
async def get_schedule(current_user=Depends(get_current_user)):
    return {"schedule": []}


@router.get("/health")
async def health():
    return {"status": "ok"}

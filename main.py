from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from database import init_db
from session_manager import SessionManager
from routers import api, web

limiter = Limiter(key_func=get_remote_address)
session_manager = SessionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    session_manager.start()
    yield
    session_manager.stop()


app = FastAPI(title="F1 Pit Wall", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(web.router)
app.include_router(api.router, prefix="/api")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

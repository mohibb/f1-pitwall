import aiosqlite
import os
from dotenv import load_dotenv
from passlib.context import CryptContext

load_dotenv()

DB_PATH = os.getenv("DB_PATH", "f1_data.db")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                username         TEXT UNIQUE NOT NULL,
                hashed_password  TEXT NOT NULL,
                is_admin         INTEGER DEFAULT 0,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS timing_history (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                session_key  TEXT NOT NULL,
                lap          INTEGER,
                driver       TEXT,
                data         TEXT,
                recorded_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        await db.execute("""
            INSERT OR IGNORE INTO settings (key, value) VALUES ('pit_stop_duration', '25')
        """)

        await db.execute("""
            INSERT OR REPLACE INTO settings (key, value) VALUES ('replay_speed', '1')
        """)

        await db.commit()
        await _seed_admin(db)


async def _seed_admin(db):
    async with db.execute(
        "SELECT id FROM users WHERE username = ?", (ADMIN_USERNAME,)
    ) as cursor:
        existing = await cursor.fetchone()

    if not existing:
        hashed = pwd_context.hash(ADMIN_PASSWORD)
        await db.execute(
            "INSERT INTO users (username, hashed_password, is_admin) VALUES (?, ?, 1)",
            (ADMIN_USERNAME, hashed),
        )
        await db.commit()
        print(f"[db] Admin user '{ADMIN_USERNAME}' created.")
    else:
        print(f"[db] Admin user '{ADMIN_USERNAME}' already exists.")


async def get_user_by_username(username: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ) as cursor:
            return await cursor.fetchone()


async def get_all_users():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, username, is_admin, created_at FROM users ORDER BY created_at"
        ) as cursor:
            return await cursor.fetchall()


async def create_user(username: str, password: str, is_admin: bool = False):
    hashed = pwd_context.hash(password)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO users (username, hashed_password, is_admin) VALUES (?, ?, ?)",
            (username, hashed, int(is_admin)),
        )
        await db.commit()


async def delete_user(username: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM users WHERE username = ?", (username,))
        await db.commit()


async def change_password(username: str, new_password: str):
    hashed = pwd_context.hash(new_password)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET hashed_password = ? WHERE username = ?",
            (hashed, username),
        )
        await db.commit()


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


async def get_setting(key: str, default: str = None) -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM settings WHERE key = ?", (key,)) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else default


async def set_setting(key: str, value: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value)
        )
        await db.commit()


async def get_all_settings() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT key, value FROM settings") as cursor:
            rows = await cursor.fetchall()
            return {row[0]: row[1] for row in rows}


def get_setting_sync(key: str, default: str = None) -> str:
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cur.fetchone()
        return row[0] if row else default
    finally:
        conn.close()

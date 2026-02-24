"""
Authentication and session management module
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

import aiosqlite
import bcrypt

# Session expiry duration (7 days)
SESSION_EXPIRY_DAYS = 7


def hash_password(plain: str) -> str:
    """Hash a plain text password using bcrypt"""
    password_bytes = plain.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain text password against a hashed password"""
    try:
        password_bytes = plain.encode('utf-8')
        hashed_bytes = hashed.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False


async def create_session(comercial_id: int, db: aiosqlite.Connection) -> str:
    """
    Create a new session for a user
    Returns: session_id (UUID string)
    """
    session_id = str(uuid.uuid4())
    created_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    expires_at = (datetime.now() + timedelta(days=SESSION_EXPIRY_DAYS)).strftime('%Y-%m-%d %H:%M:%S')
    
    await db.execute(
        "INSERT INTO sesiones (session_id, comercial_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (session_id, comercial_id, created_at, expires_at)
    )
    await db.commit()
    
    return session_id


async def get_session(session_id: str, db: aiosqlite.Connection) -> Optional[dict]:
    """
    Get session data and validate expiry
    Returns: dict with session info or None if invalid/expired
    """
    cursor = await db.execute(
        "SELECT session_id, comercial_id, created_at, expires_at FROM sesiones WHERE session_id = ?",
        (session_id,)
    )
    row = await cursor.fetchone()
    
    if not row:
        return None
    
    # Check if session has expired
    expires_at = datetime.strptime(row[3], '%Y-%m-%d %H:%M:%S')
    if datetime.now() > expires_at:
        # Delete expired session
        await delete_session(session_id, db)
        return None
    
    return {
        'session_id': row[0],
        'comercial_id': row[1],
        'created_at': row[2],
        'expires_at': row[3]
    }


async def delete_session(session_id: str, db: aiosqlite.Connection):
    """Delete a session (logout)"""
    await db.execute("DELETE FROM sesiones WHERE session_id = ?", (session_id,))
    await db.commit()


async def cleanup_expired_sessions(db: aiosqlite.Connection):
    """Delete all expired sessions"""
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    await db.execute("DELETE FROM sesiones WHERE expires_at < ?", (now,))
    await db.commit()

import csv
import hashlib
import io
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib
from typing import Optional

import aiosqlite
from fastapi import FastAPI, APIRouter, Request, HTTPException, Depends, Response, Cookie
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from database import init_db, get_db, DB_PATH
from auth import hash_password, verify_password, create_session, get_session, delete_session


# ── SMTP Configuration & Validation ─────────────────────────────────────────

def validate_smtp_config() -> tuple[bool, Optional[str]]:
    """
    Validate SMTP configuration from environment variables.
    Returns: (is_valid, error_message)
    """
    required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']
    missing = [k for k in required if not os.getenv(k) or 'tu-' in os.getenv(k, '').lower()]
    
    if missing:
        return False, f"SMTP no configurado. Variables faltantes o con valores placeholder: {', '.join(missing)}"
    
    return True, None

# Global flag for email availability
SMTP_ENABLED = False
SMTP_ERROR = None


# ── Pydantic Models ─────────────────────────────────────────────────────────

class NegocioCreate(BaseModel):
    nombre: str
    sector: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None

class NegocioUpdate(BaseModel):
    nombre: Optional[str] = None
    sector: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None

class ComercialCreate(BaseModel):
    nombre: str
    apellido: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    zona: Optional[str] = None
    activo: Optional[int] = 1

class ComercialUpdate(BaseModel):
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    zona: Optional[str] = None
    activo: Optional[int] = None

class IncidenciaCreate(BaseModel):
    negocio_id: int
    titulo: str
    descripcion: Optional[str] = None
    prioridad: Optional[str] = "media"
    estado: Optional[str] = "abierta"
    categoria: Optional[str] = None
    asignado_a: Optional[str] = None
    fecha_limite: Optional[str] = None
    resolucion: Optional[str] = None

class IncidenciaUpdate(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    prioridad: Optional[str] = None
    estado: Optional[str] = None
    categoria: Optional[str] = None
    asignado_a: Optional[str] = None
    fecha_limite: Optional[str] = None
    resolucion: Optional[str] = None

class ActividadCreate(BaseModel):
    comercial_id: int
    negocio_id: Optional[int] = None
    tipo: str
    titulo: str
    descripcion: Optional[str] = None
    resultado: Optional[str] = None
    estado: Optional[str] = "pendiente"
    fecha_actividad: str
    duracion_min: Optional[int] = 0

class ActividadUpdate(BaseModel):
    comercial_id: Optional[int] = None
    negocio_id: Optional[int] = None
    tipo: Optional[str] = None
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    resultado: Optional[str] = None
    estado: Optional[str] = None
    fecha_actividad: Optional[str] = None
    duracion_min: Optional[int] = None

class ComentarioCreate(BaseModel):
    autor: Optional[str] = "Anónimo"
    contenido: str

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    nombre: str
    apellido: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]


# ── App Factory ───────────────────────────────────────────────────────────────

def get_file_hash(filepath: str) -> str:
    with open(filepath, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:8]


def create_app(static_dir: str) -> FastAPI:

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        global SMTP_ENABLED, SMTP_ERROR
        
        # Initialize database
        await init_db()
        
        # Validate SMTP
        SMTP_ENABLED, SMTP_ERROR = validate_smtp_config()
        if not SMTP_ENABLED:
            print(f"⚠️  SMTP DESHABILITADO: {SMTP_ERROR}")
            print("    Los enlaces de recuperación se mostrarán en la consola.")
            print("    Para habilitar email:")
            print("    1. Ve a https://myaccount.google.com/apppasswords")
            print("    2. Genera una 'App Password' para tu Gmail")
            print("    3. Actualiza SMTP_USER y SMTP_PASS en .env")
        else:
            print("✅ SMTP configurado correctamente")
        
        yield

    app = FastAPI(lifespan=lifespan)
    api = APIRouter()
    templates = Jinja2Templates(directory=static_dir)

    # ── Auth Middleware ───────────────────────────────────────────────────────

    async def get_current_user(
        request: Request,
        db: aiosqlite.Connection = Depends(get_db),
        session_id: Optional[str] = Cookie(None)
    ):
        """Session middleware - validates session cookie and returns current user"""
        if not session_id:
            raise HTTPException(status_code=401, detail="No session")
        
        session = await get_session(session_id, db)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        
        # Fetch user data
        cursor = await db.execute(
            "SELECT id, username, nombre, apellido, email, telefono, zona, rol, subgrupo, activo FROM comerciales WHERE id = ?",
            (session['comercial_id'],)
        )
        user_row = await cursor.fetchone()
        
        if not user_row:
            raise HTTPException(status_code=401, detail="User not found")
        
        user = row_to_dict(user_row)
        
        if not user['activo']:
            raise HTTPException(status_code=403, detail="Usuario inactivo")
        
        return user

    async def get_visible_comercial_ids(current_user: dict, db: aiosqlite.Connection) -> list[int]:
        """
        Get list of comercial IDs visible to current user based on role
        - administrador/jefe: ALL comerciales
        - jefe_grupo: Own subgroup + self
        - comercial: Only self
        """
        if current_user['rol'] in ('administrador', 'jefe'):
            # See all
            cursor = await db.execute("SELECT id FROM comerciales")
            rows = await cursor.fetchall()
            return [row[0] for row in rows]
        elif current_user['rol'] == 'jefe_grupo':
            # See own subgroup
            cursor = await db.execute(
                "SELECT id FROM comerciales WHERE subgrupo = ? OR id = ?",
                (current_user['subgrupo'], current_user['id'])
            )
            rows = await cursor.fetchall()
            return [row[0] for row in rows]
        else:  # comercial
            # See only self
            return [current_user['id']]

    # ── Auth Endpoints ────────────────────────────────────────────────────────

    @api.post("/auth/register")
    async def register(data: RegisterRequest, db: aiosqlite.Connection = Depends(get_db)):
        """Register a new user"""
        # Check if username already exists
        cursor = await db.execute("SELECT id FROM comerciales WHERE username = ?", (data.username,))
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")
        
        # Hash password
        password_hash = hash_password(data.password)
        
        # Insert user
        cursor = await db.execute(
            """INSERT INTO comerciales (nombre, apellido, email, telefono, username, password_hash, rol, activo)
               VALUES (?, ?, ?, ?, ?, ?, 'comercial', 1)""",
            (data.nombre, data.apellido, data.email, data.telefono, data.username, password_hash)
        )
        await db.commit()
        
        return {"id": cursor.lastrowid, "username": data.username}

    @api.post("/auth/login")
    async def login(data: LoginRequest, response: Response, db: aiosqlite.Connection = Depends(get_db)):
        """Authenticate user and create session"""
        # Fetch user
        cursor = await db.execute(
            "SELECT id, username, password_hash, nombre, apellido, rol, subgrupo, activo FROM comerciales WHERE username = ?",
            (data.username,)
        )
        user_row = await cursor.fetchone()
        
        if not user_row:
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")
        
        user = row_to_dict(user_row)
        
        # Verify password
        if not verify_password(data.password, user['password_hash']):
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")
        
        # Check if user is active
        if not user['activo']:
            raise HTTPException(status_code=403, detail="Usuario inactivo")
        
        # Create session
        session_id = await create_session(user['id'], db)
        
        # Set cookie (HttpOnly, 7 days)
        response.set_cookie(
            key="session_id",
            value=session_id,
            httponly=True,
            max_age=7 * 24 * 60 * 60,  # 7 days in seconds
            samesite="lax"
        )
        
        return {
            "username": user['username'],
            "nombre": user['nombre'],
            "apellido": user['apellido'],
            "rol": user['rol'],
            "subgrupo": user['subgrupo']
        }

    @api.post("/auth/logout")
    async def logout(
        response: Response,
        db: aiosqlite.Connection = Depends(get_db),
        session_id: Optional[str] = Cookie(None)
    ):
        """Logout user and delete session"""
        if session_id:
            await delete_session(session_id, db)
        
        # Clear cookie
        response.delete_cookie(key="session_id")
        
        return {"success": True}

    @api.get("/auth/me")
    async def get_me(current_user: dict = Depends(get_current_user)):
        """Get current user info"""
        return {
            "id": current_user['id'],
            "username": current_user['username'],
            "nombre": current_user['nombre'],
            "apellido": current_user['apellido'],
            "email": current_user['email'],
            "telefono": current_user['telefono'],
            "zona": current_user['zona'],
            "rol": current_user['rol'],
            "subgrupo": current_user['subgrupo'],
            "activo": current_user['activo']
        }

    @api.post("/auth/forgot-password")
    async def forgot_password(data: dict, db: aiosqlite.Connection = Depends(get_db)):
        """
        Password reset request endpoint
        """
        email = data.get("email", "").strip()
        
        if not email:
            raise HTTPException(status_code=400, detail="Email requerido")
        
        # Find user by email
        cursor = await db.execute(
            "SELECT id, username, email, nombre FROM comerciales WHERE email = ?",
            (email,)
        )
        user_row = await cursor.fetchone()
        
        # Always return success to prevent email enumeration
        if not user_row:
            # Sleep to prevent timing attacks
            import asyncio
            await asyncio.sleep(0.5)
            return {"success": True, "message": "Si el email existe, recibirás instrucciones de recuperación"}
        
        user_id = user_row[0]
        username = user_row[1]
        user_email = user_row[2]
        nombre = user_row[3]
        
        # Generate reset token
        reset_token = str(uuid.uuid4())
        expires_at = (datetime.now() + timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')
        
        # Store token
        await db.execute(
            "INSERT INTO password_resets (comercial_id, token, expires_at) VALUES (?, ?, ?)",
            (user_id, reset_token, expires_at)
        )
        await db.commit()
        
        # Generate reset link
        base_url = os.getenv("APP_BASE_URL", "http://localhost:8000")
        reset_link = f"{base_url}/reset-password?token={reset_token}"
        
        # Try sending email if SMTP is enabled
        if SMTP_ENABLED:
            try:
                msg = MIMEMultipart('alternative')
                msg['Subject'] = 'Recuperación de Contraseña - Tracker'
                msg['From'] = os.getenv('SMTP_USER')
                msg['To'] = user_email
                
                text_body = f"""
Hola {nombre},

Has solicitado restablecer tu contraseña para el usuario '{username}'.

Haz clic en el siguiente enlace para crear una nueva contraseña:
{reset_link}

Este enlace expirará en 1 hora.

Si no solicitaste este cambio, ignora este mensaje.

---
Tracker - Gestión Comercial
                """
                
                html_body = f"""
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <h2 style="color: #4F46E5;">Recuperación de Contraseña</h2>
    <p>Hola <strong>{nombre}</strong>,</p>
    <p>Has solicitado restablecer tu contraseña para el usuario <code>{username}</code>.</p>
    <p>
        <a href="{reset_link}" 
           style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; 
                  text-decoration: none; border-radius: 6px; font-weight: 600;">
            Restablecer Contraseña
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        O copia este enlace en tu navegador:<br>
        <code>{reset_link}</code>
    </p>
    <p style="color: #999; font-size: 12px;">
        Este enlace expirará en 1 hora.<br>
        Si no solicitaste este cambio, ignora este mensaje.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">Tracker - Gestión Comercial</p>
</body>
</html>
                """
                
                msg.attach(MIMEText(text_body, 'plain'))
                msg.attach(MIMEText(html_body, 'html'))
                
                # Send email
                with smtplib.SMTP(os.getenv('SMTP_HOST'), int(os.getenv('SMTP_PORT', 587))) as server:
                    server.starttls()
                    server.login(os.getenv('SMTP_USER'), os.getenv('SMTP_PASS'))
                    server.send_message(msg)
                
                print(f"✅ Email de recuperación enviado a {user_email}")
                
            except Exception as e:
                print(f"❌ Error al enviar email: {str(e)}")
                print(f"📧 FALLBACK - Reset Link (cópialo manualmente): {reset_link}")
        else:
            # SMTP disabled - log to console
            print("\n" + "="*70)
            print("🔐 PASSWORD RESET REQUEST")
            print("="*70)
            print(f"Usuario: {username} ({nombre})")
            print(f"Email: {user_email}")
            print(f"Reset Link: {reset_link}")
            print(f"Expira: {expires_at}")
            print("="*70 + "\n")
        
        return {"success": True, "message": "Si el email existe, recibirás instrucciones de recuperación"}

    @api.post("/auth/reset-password")
    async def reset_password(data: dict, db: aiosqlite.Connection = Depends(get_db)):
        """Reset password with token"""
        token = data.get('token', '').strip()
        new_password = data.get('password', '')
        
        if not token or not new_password:
            raise HTTPException(status_code=400, detail="Token y contraseña requeridos")
        
        if len(new_password) < 8:
            raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")
        
        # Find valid token
        from datetime import datetime
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        cursor = await db.execute(
            "SELECT comercial_id FROM password_resets WHERE token = ? AND expires_at > ? AND used = 0",
            (token, now)
        )
        reset_row = await cursor.fetchone()
        
        if not reset_row:
            raise HTTPException(status_code=400, detail="Token inválido o expirado")
        
        comercial_id = reset_row[0]
        
        # Update password
        new_hash = hash_password(new_password)
        await db.execute(
            "UPDATE comerciales SET password_hash = ? WHERE id = ?",
            (new_hash, comercial_id)
        )
        
        # Mark token as used
        await db.execute(
            "UPDATE password_resets SET used = 1 WHERE token = ?",
            (token,)
        )
        
        await db.commit()
        
        return {"success": True, "message": "Contraseña actualizada correctamente"}

    # ── Health ────────────────────────────────────────────────────────────────

    @api.get("/health")
    async def health():
        return {"ok": True}

    # ── Stats (dashboard) ─────────────────────────────────────────────────────

    @api.get("/stats")
    async def get_stats(
        current_user: dict = Depends(get_current_user),
        db: aiosqlite.Connection = Depends(get_db)
    ):
        visible_ids = await get_visible_comercial_ids(current_user, db)
        ids_placeholder = ','.join('?' * len(visible_ids))
        
        # negocios: count all (TODO: could filter by related activities/incidents)
        cur = await db.execute("SELECT COUNT(*) FROM negocios")
        total_negocios = (await cur.fetchone())[0]

        # Visible comerciales
        cur = await db.execute(f"SELECT COUNT(*) FROM comerciales WHERE activo=1 AND id IN ({ids_placeholder})", visible_ids)
        total_comerciales = (await cur.fetchone())[0]

        # Incidencias: filter by assigned comercial (asignado_a matches comercial name)
        # For simplicity, we'll count all incidencias (could be improved to filter by assigned comercial)
        cur = await db.execute("SELECT COUNT(*) FROM incidencias")
        total_incidencias = (await cur.fetchone())[0]

        cur = await db.execute("SELECT COUNT(*) FROM incidencias WHERE estado NOT IN ('resuelta','cerrada')")
        incidencias_abiertas = (await cur.fetchone())[0]

        # Actividades: filter by visible comerciales
        cur = await db.execute(f"SELECT COUNT(*) FROM actividades WHERE comercial_id IN ({ids_placeholder})", visible_ids)
        total_actividades = (await cur.fetchone())[0]

        cur = await db.execute(f"SELECT COUNT(*) FROM actividades WHERE estado='pendiente' AND comercial_id IN ({ids_placeholder})", visible_ids)
        actividades_pendientes = (await cur.fetchone())[0]

        # Incidencias por prioridad (all incidencias for now)
        cur = await db.execute("""
            SELECT prioridad, COUNT(*) as total FROM incidencias
            WHERE estado NOT IN ('resuelta','cerrada')
            GROUP BY prioridad
        """)
        inc_por_prioridad = {r["prioridad"]: r["total"] for r in rows_to_list(await cur.fetchall())}

        # Actividades por tipo (filtered)
        cur = await db.execute(f"""
            SELECT tipo, COUNT(*) as total FROM actividades 
            WHERE comercial_id IN ({ids_placeholder})
            GROUP BY tipo
        """, visible_ids)
        act_por_tipo = {r["tipo"]: r["total"] for r in rows_to_list(await cur.fetchall())}

        # Incidencias por estado (all for now)
        cur = await db.execute("""
            SELECT estado, COUNT(*) as total FROM incidencias GROUP BY estado
        """)
        inc_por_estado = {r["estado"]: r["total"] for r in rows_to_list(await cur.fetchall())}

        # Incidencias por mes (all for now)
        cur = await db.execute("""
            SELECT strftime('%Y-%m', creado_en) as mes, COUNT(*) as total
            FROM incidencias
            WHERE creado_en >= date('now','-6 months')
            GROUP BY mes ORDER BY mes
        """)
        inc_por_mes = rows_to_list(await cur.fetchall())

        # Actividades por comercial (filtered by visible)
        cur = await db.execute(f"""
            SELECT c.nombre || ' ' || COALESCE(c.apellido,'') AS comercial, COUNT(a.id) as total
            FROM comerciales c LEFT JOIN actividades a ON a.comercial_id=c.id
            WHERE c.id IN ({ids_placeholder})
            GROUP BY c.id ORDER BY total DESC
        """, visible_ids)
        act_por_comercial = rows_to_list(await cur.fetchall())

        # Incidencias vencidas (all for now)
        cur = await db.execute("""
            SELECT COUNT(*) FROM incidencias
            WHERE fecha_limite < date('now') AND estado NOT IN ('resuelta','cerrada')
            AND fecha_limite IS NOT NULL
        """)
        incidencias_vencidas = (await cur.fetchone())[0]

        return {
            "total_negocios": total_negocios,
            "total_comerciales": total_comerciales,
            "total_incidencias": total_incidencias,
            "incidencias_abiertas": incidencias_abiertas,
            "incidencias_vencidas": incidencias_vencidas,
            "total_actividades": total_actividades,
            "actividades_pendientes": actividades_pendientes,
            "incidencias_por_prioridad": inc_por_prioridad,
            "incidencias_por_estado": inc_por_estado,
            "actividades_por_tipo": act_por_tipo,
            "incidencias_por_mes": inc_por_mes,
            "actividades_por_comercial": act_por_comercial,
        }

    # ── NEGOCIOS ──────────────────────────────────────────────────────────────

    @api.get("/negocios")
    async def list_negocios(
        q: Optional[str] = None,
        sector: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
        db: aiosqlite.Connection = Depends(get_db)
    ):
        sql = """
            SELECT n.*,
                   COUNT(DISTINCT i.id) AS total_incidencias,
                   COUNT(DISTINCT CASE WHEN i.estado NOT IN ('resuelta','cerrada') THEN i.id END) AS incidencias_abiertas
            FROM negocios n
            LEFT JOIN incidencias i ON i.negocio_id = n.id
            WHERE 1=1
        """
        params = []
        if q:
            sql += " AND (n.nombre LIKE ? OR n.sector LIKE ? OR n.email LIKE ? OR n.telefono LIKE ?)"
            params += [f"%{q}%"] * 4
        if sector:
            sql += " AND n.sector = ?"
            params.append(sector)
        sql += " GROUP BY n.id ORDER BY n.nombre"
        cur = await db.execute(sql, params)
        return rows_to_list(await cur.fetchall())

    @api.post("/negocios", status_code=201)
    async def create_negocio(data: NegocioCreate, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute(
            "INSERT INTO negocios (nombre,sector,telefono,email,direccion,notas) VALUES (?,?,?,?,?,?)",
            (data.nombre, data.sector, data.telefono, data.email, data.direccion, data.notas)
        )
        await db.commit()
        cur2 = await db.execute("SELECT * FROM negocios WHERE id=?", (cur.lastrowid,))
        return row_to_dict(await cur2.fetchone())

    @api.get("/negocios/{nid}")
    async def get_negocio(nid: int, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("SELECT * FROM negocios WHERE id=?", (nid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Negocio no encontrado")
        return row_to_dict(row)

    @api.put("/negocios/{nid}")
    async def update_negocio(nid: int, data: NegocioUpdate, db: aiosqlite.Connection = Depends(get_db)):
        fields = {k: v for k, v in data.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(400, "Sin datos para actualizar")
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [nid]
        await db.execute(f"UPDATE negocios SET {sets} WHERE id=?", vals)
        await db.commit()
        cur = await db.execute("SELECT * FROM negocios WHERE id=?", (nid,))
        return row_to_dict(await cur.fetchone())

    @api.delete("/negocios/{nid}")
    async def delete_negocio(nid: int, db: aiosqlite.Connection = Depends(get_db)):
        await db.execute("DELETE FROM negocios WHERE id=?", (nid,))
        await db.commit()
        return {"ok": True}

    @api.get("/negocios/{nid}/incidencias")
    async def get_incidencias_negocio(nid: int, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute(
            "SELECT * FROM incidencias WHERE negocio_id=? ORDER BY creado_en DESC", (nid,)
        )
        return rows_to_list(await cur.fetchall())

    @api.get("/sectores")
    async def get_sectores(db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("SELECT DISTINCT sector FROM negocios WHERE sector IS NOT NULL ORDER BY sector")
        return [r[0] for r in await cur.fetchall()]

    # ── COMERCIALES ───────────────────────────────────────────────────────────

    @api.get("/comerciales")
    async def list_comerciales(
        q: Optional[str] = None,
        zona: Optional[str] = None,
        activo: Optional[int] = None,
        db: aiosqlite.Connection = Depends(get_db)
    ):
        sql = """
            SELECT c.*,
                   COUNT(DISTINCT a.id) AS total_actividades,
                   COUNT(DISTINCT CASE WHEN a.estado='pendiente' THEN a.id END) AS actividades_pendientes
            FROM comerciales c
            LEFT JOIN actividades a ON a.comercial_id = c.id
            WHERE 1=1
        """
        params = []
        if q:
            sql += " AND (c.nombre LIKE ? OR c.apellido LIKE ? OR c.email LIKE ? OR c.zona LIKE ?)"
            params += [f"%{q}%"] * 4
        if zona:
            sql += " AND c.zona = ?"
            params.append(zona)
        if activo is not None:
            sql += " AND c.activo = ?"
            params.append(activo)
        sql += " GROUP BY c.id ORDER BY c.nombre"
        cur = await db.execute(sql, params)
        return rows_to_list(await cur.fetchall())

    @api.post("/comerciales", status_code=201)
    async def create_comercial(data: ComercialCreate, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute(
            "INSERT INTO comerciales (nombre,apellido,email,telefono,zona,activo) VALUES (?,?,?,?,?,?)",
            (data.nombre, data.apellido, data.email, data.telefono, data.zona, data.activo)
        )
        await db.commit()
        cur2 = await db.execute("SELECT * FROM comerciales WHERE id=?", (cur.lastrowid,))
        return row_to_dict(await cur2.fetchone())

    @api.get("/comerciales/{cid}")
    async def get_comercial(cid: int, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("SELECT * FROM comerciales WHERE id=?", (cid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Comercial no encontrado")
        return row_to_dict(row)

    @api.put("/comerciales/{cid}")
    async def update_comercial(cid: int, data: ComercialUpdate, db: aiosqlite.Connection = Depends(get_db)):
        fields = {k: v for k, v in data.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(400, "Sin datos para actualizar")
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [cid]
        await db.execute(f"UPDATE comerciales SET {sets} WHERE id=?", vals)
        await db.commit()
        cur = await db.execute("SELECT * FROM comerciales WHERE id=?", (cid,))
        return row_to_dict(await cur.fetchone())

    @api.delete("/comerciales/{cid}")
    async def delete_comercial(cid: int, db: aiosqlite.Connection = Depends(get_db)):
        await db.execute("DELETE FROM comerciales WHERE id=?", (cid,))
        await db.commit()
        return {"ok": True}

    @api.get("/comerciales/{cid}/actividades")
    async def get_actividades_comercial(cid: int, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("""
            SELECT a.*, n.nombre AS negocio_nombre
            FROM actividades a
            LEFT JOIN negocios n ON n.id = a.negocio_id
            WHERE a.comercial_id=?
            ORDER BY a.fecha_actividad DESC
        """, (cid,))
        return rows_to_list(await cur.fetchall())

    @api.get("/zonas")
    async def get_zonas(db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("SELECT DISTINCT zona FROM comerciales WHERE zona IS NOT NULL ORDER BY zona")
        return [r[0] for r in await cur.fetchall()]

    # ── INCIDENCIAS ───────────────────────────────────────────────────────────

    @api.get("/incidencias")
    async def list_incidencias(
        q: Optional[str] = None,
        negocio_id: Optional[int] = None,
        estado: Optional[str] = None,
        prioridad: Optional[str] = None,
        categoria: Optional[str] = None,
        db: aiosqlite.Connection = Depends(get_db)
    ):
        sql = """
            SELECT i.*, n.nombre AS negocio_nombre
            FROM incidencias i
            JOIN negocios n ON n.id = i.negocio_id
            WHERE 1=1
        """
        params = []
        if q:
            sql += " AND (i.titulo LIKE ? OR i.descripcion LIKE ? OR n.nombre LIKE ? OR i.categoria LIKE ?)"
            params += [f"%{q}%"] * 4
        if negocio_id:
            sql += " AND i.negocio_id = ?"
            params.append(negocio_id)
        if estado:
            sql += " AND i.estado = ?"
            params.append(estado)
        if prioridad:
            sql += " AND i.prioridad = ?"
            params.append(prioridad)
        if categoria:
            sql += " AND i.categoria = ?"
            params.append(categoria)
        sql += " ORDER BY CASE i.prioridad WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END, i.creado_en DESC"
        cur = await db.execute(sql, params)
        return rows_to_list(await cur.fetchall())

    @api.post("/incidencias", status_code=201)
    async def create_incidencia(data: IncidenciaCreate, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("""
            INSERT INTO incidencias
            (negocio_id,titulo,descripcion,prioridad,estado,categoria,asignado_a,fecha_limite,resolucion)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (data.negocio_id, data.titulo, data.descripcion, data.prioridad,
              data.estado, data.categoria, data.asignado_a, data.fecha_limite, data.resolucion))
        await db.commit()
        cur2 = await db.execute("""
            SELECT i.*, n.nombre AS negocio_nombre FROM incidencias i
            JOIN negocios n ON n.id=i.negocio_id WHERE i.id=?
        """, (cur.lastrowid,))
        return row_to_dict(await cur2.fetchone())

    @api.get("/incidencias/{iid}")
    async def get_incidencia(iid: int, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("""
            SELECT i.*, n.nombre AS negocio_nombre FROM incidencias i
            JOIN negocios n ON n.id=i.negocio_id WHERE i.id=?
        """, (iid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Incidencia no encontrada")
        return row_to_dict(row)

    @api.put("/incidencias/{iid}")
    async def update_incidencia(iid: int, data: IncidenciaUpdate, db: aiosqlite.Connection = Depends(get_db)):
        fields = {k: v for k, v in data.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(400, "Sin datos para actualizar")
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [iid]
        await db.execute(f"UPDATE incidencias SET {sets} WHERE id=?", vals)
        await db.commit()
        cur = await db.execute("""
            SELECT i.*, n.nombre AS negocio_nombre FROM incidencias i
            JOIN negocios n ON n.id=i.negocio_id WHERE i.id=?
        """, (iid,))
        return row_to_dict(await cur.fetchone())

    @api.delete("/incidencias/{iid}")
    async def delete_incidencia(iid: int, db: aiosqlite.Connection = Depends(get_db)):
        await db.execute("DELETE FROM incidencias WHERE id=?", (iid,))
        await db.commit()
        return {"ok": True}

    @api.get("/categorias-incidencias")
    async def get_categorias(db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("SELECT DISTINCT categoria FROM incidencias WHERE categoria IS NOT NULL ORDER BY categoria")
        return [r[0] for r in await cur.fetchall()]

    # ── ACTIVIDADES ───────────────────────────────────────────────────────────

    @api.get("/actividades")
    async def list_actividades(
        q: Optional[str] = None,
        comercial_id: Optional[int] = None,
        negocio_id: Optional[int] = None,
        tipo: Optional[str] = None,
        estado: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
        db: aiosqlite.Connection = Depends(get_db)
    ):
        visible_ids = await get_visible_comercial_ids(current_user, db)
        ids_placeholder = ','.join('?' * len(visible_ids))
        
        sql = f"""
            SELECT a.*,
                   c.nombre || ' ' || COALESCE(c.apellido,'') AS comercial_nombre,
                   n.nombre AS negocio_nombre
            FROM actividades a
            JOIN comerciales c ON c.id = a.comercial_id
            LEFT JOIN negocios n ON n.id = a.negocio_id
            WHERE a.comercial_id IN ({ids_placeholder})
        """
        params = list(visible_ids)
        if q:
            sql += " AND (a.titulo LIKE ? OR a.descripcion LIKE ? OR c.nombre LIKE ? OR n.nombre LIKE ?)"
            params += [f"%{q}%"] * 4
        if comercial_id:
            sql += " AND a.comercial_id = ?"
            params.append(comercial_id)
        if negocio_id:
            sql += " AND a.negocio_id = ?"
            params.append(negocio_id)
        if tipo:
            sql += " AND a.tipo = ?"
            params.append(tipo)
        if estado:
            sql += " AND a.estado = ?"
            params.append(estado)
        sql += " ORDER BY a.fecha_actividad DESC, a.creado_en DESC"
        cur = await db.execute(sql, params)
        return rows_to_list(await cur.fetchall())

    @api.post("/actividades", status_code=201)
    async def create_actividad(data: ActividadCreate, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("""
            INSERT INTO actividades
            (comercial_id,negocio_id,tipo,titulo,descripcion,resultado,estado,fecha_actividad,duracion_min)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (data.comercial_id, data.negocio_id, data.tipo, data.titulo,
              data.descripcion, data.resultado, data.estado, data.fecha_actividad, data.duracion_min))
        await db.commit()
        cur2 = await db.execute("""
            SELECT a.*, c.nombre || ' ' || COALESCE(c.apellido,'') AS comercial_nombre, n.nombre AS negocio_nombre
            FROM actividades a JOIN comerciales c ON c.id=a.comercial_id LEFT JOIN negocios n ON n.id=a.negocio_id
            WHERE a.id=?
        """, (cur.lastrowid,))
        return row_to_dict(await cur2.fetchone())

    @api.get("/actividades/{aid}")
    async def get_actividad(aid: int, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute("""
            SELECT a.*, c.nombre || ' ' || COALESCE(c.apellido,'') AS comercial_nombre, n.nombre AS negocio_nombre
            FROM actividades a JOIN comerciales c ON c.id=a.comercial_id LEFT JOIN negocios n ON n.id=a.negocio_id
            WHERE a.id=?
        """, (aid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Actividad no encontrada")
        return row_to_dict(row)

    @api.put("/actividades/{aid}")
    async def update_actividad(aid: int, data: ActividadUpdate, db: aiosqlite.Connection = Depends(get_db)):
        fields = {k: v for k, v in data.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(400, "Sin datos para actualizar")
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [aid]
        await db.execute(f"UPDATE actividades SET {sets} WHERE id=?", vals)
        await db.commit()
        cur = await db.execute("""
            SELECT a.*, c.nombre || ' ' || COALESCE(c.apellido,'') AS comercial_nombre, n.nombre AS negocio_nombre
            FROM actividades a JOIN comerciales c ON c.id=a.comercial_id LEFT JOIN negocios n ON n.id=a.negocio_id
            WHERE a.id=?
        """, (aid,))
        return row_to_dict(await cur.fetchone())

    @api.delete("/actividades/{aid}")
    async def delete_actividad(aid: int, db: aiosqlite.Connection = Depends(get_db)):
        await db.execute("DELETE FROM actividades WHERE id=?", (aid,))
        await db.commit()
        return {"ok": True}

    # ── COMENTARIOS ───────────────────────────────────────────────────────────

    @api.get("/incidencias/{iid}/comentarios")
    async def get_comentarios(iid: int, db: aiosqlite.Connection = Depends(get_db)):
        cur = await db.execute(
            "SELECT * FROM comentarios WHERE incidencia_id=? ORDER BY creado_en ASC", (iid,)
        )
        return rows_to_list(await cur.fetchall())

    @api.post("/incidencias/{iid}/comentarios", status_code=201)
    async def add_comentario(iid: int, data: ComentarioCreate, db: aiosqlite.Connection = Depends(get_db)):
        # Check incidencia exists
        cur = await db.execute("SELECT id FROM incidencias WHERE id=?", (iid,))
        if not await cur.fetchone():
            raise HTTPException(404, "Incidencia no encontrada")
        cur = await db.execute(
            "INSERT INTO comentarios (incidencia_id, autor, contenido) VALUES (?,?,?)",
            (iid, data.autor or "Anónimo", data.contenido)
        )
        await db.commit()
        cur2 = await db.execute("SELECT * FROM comentarios WHERE id=?", (cur.lastrowid,))
        return row_to_dict(await cur2.fetchone())

    @api.delete("/comentarios/{cid}")
    async def delete_comentario(cid: int, db: aiosqlite.Connection = Depends(get_db)):
        await db.execute("DELETE FROM comentarios WHERE id=?", (cid,))
        await db.commit()
        return {"ok": True}

    # ── CALENDARIO (events feed) ───────────────────────────────────────────────

    @api.get("/eventos")
    async def get_eventos(db: aiosqlite.Connection = Depends(get_db)):
        """FullCalendar-compatible events feed."""
        cur = await db.execute("""
            SELECT i.id, i.titulo, i.prioridad, i.estado, i.fecha_limite,
                   i.creado_en, n.nombre AS negocio_nombre
            FROM incidencias i JOIN negocios n ON n.id=i.negocio_id
            WHERE i.fecha_limite IS NOT NULL
        """)
        incs = rows_to_list(await cur.fetchall())

        cur = await db.execute("""
            SELECT a.id, a.titulo, a.tipo, a.estado, a.fecha_actividad,
                   c.nombre || ' ' || COALESCE(c.apellido,'') AS comercial_nombre
            FROM actividades a JOIN comerciales c ON c.id=a.comercial_id
        """)
        acts = rows_to_list(await cur.fetchall())

        color_map = {"critica": "#ef4444", "alta": "#f59e0b", "media": "#4f7cff", "baja": "#62637a"}
        tipo_color = {"visita": "#22c55e", "llamada": "#06b6d4", "email": "#8b5cf6",
                      "reunion": "#f59e0b", "demo": "#4f7cff", "propuesta": "#ec4899",
                      "cierre": "#22c55e", "otro": "#62637a"}

        events = []
        for i in incs:
            events.append({
                "id": "inc-" + str(i["id"]),
                "title": f"⚠ {i['titulo']}",
                "start": i["fecha_limite"],
                "backgroundColor": color_map.get(i["prioridad"], "#62637a"),
                "borderColor": color_map.get(i["prioridad"], "#62637a"),
                "extendedProps": {
                    "type": "incidencia", "entity_id": i["id"],
                    "negocio": i["negocio_nombre"], "prioridad": i["prioridad"], "estado": i["estado"]
                }
            })
        for a in acts:
            events.append({
                "id": "act-" + str(a["id"]),
                "title": f"● {a['titulo']}",
                "start": a["fecha_actividad"],
                "backgroundColor": tipo_color.get(a["tipo"], "#62637a"),
                "borderColor": tipo_color.get(a["tipo"], "#62637a"),
                "extendedProps": {
                    "type": "actividad", "entity_id": a["id"],
                    "comercial": a["comercial_nombre"], "tipo": a["tipo"], "estado": a["estado"]
                }
            })
        return events

    # ── EXPORT ────────────────────────────────────────────────────────────────

    @api.get("/export/incidencias")
    async def export_incidencias(
        estado: Optional[str] = None,
        prioridad: Optional[str] = None,
        db: aiosqlite.Connection = Depends(get_db)
    ):
        sql = """
            SELECT i.id, i.titulo, i.descripcion, i.prioridad, i.estado,
                   i.categoria, i.asignado_a, i.fecha_limite, i.resolucion,
                   n.nombre AS negocio, i.creado_en, i.actualizado_en
            FROM incidencias i JOIN negocios n ON n.id=i.negocio_id WHERE 1=1
        """
        params = []
        if estado: sql += " AND i.estado=?"; params.append(estado)
        if prioridad: sql += " AND i.prioridad=?"; params.append(prioridad)
        sql += " ORDER BY CASE i.prioridad WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END"
        cur = await db.execute(sql, params)
        rows = rows_to_list(await cur.fetchall())

        output = io.StringIO()
        if rows:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=incidencias.csv"}
        )

    @api.get("/export/actividades")
    async def export_actividades(
        estado: Optional[str] = None,
        comercial_id: Optional[int] = None,
        db: aiosqlite.Connection = Depends(get_db)
    ):
        sql = """
            SELECT a.id, a.titulo, a.descripcion, a.tipo, a.estado,
                   a.fecha_actividad, a.duracion_min, a.resultado,
                   c.nombre || ' ' || COALESCE(c.apellido,'') AS comercial,
                   n.nombre AS negocio,
                   a.creado_en
            FROM actividades a
            JOIN comerciales c ON c.id=a.comercial_id
            LEFT JOIN negocios n ON n.id=a.negocio_id
            WHERE 1=1
        """
        params = []
        if estado: sql += " AND a.estado=?"; params.append(estado)
        if comercial_id: sql += " AND a.comercial_id=?"; params.append(comercial_id)
        sql += " ORDER BY a.fecha_actividad DESC"
        cur = await db.execute(sql, params)
        rows = rows_to_list(await cur.fetchall())

        output = io.StringIO()
        if rows:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=actividades.csv"}
        )

    # ── Mount ─────────────────────────────────────────────────────────────────

    app.include_router(api, prefix="/api")

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request):
        css_hash = get_file_hash(os.path.join(static_dir, "styles.css"))
        js_hash = get_file_hash(os.path.join(static_dir, "app.js"))
        return templates.TemplateResponse(
            request, "index.html", {"css_hash": css_hash, "js_hash": js_hash}
        )

    app.mount("/static", StaticFiles(directory=static_dir), name="ui")
    return app

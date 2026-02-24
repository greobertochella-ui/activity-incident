# Authentication & Role-Based Access Control System

## Spec Provenance

**Created**: 2026-02-22  
**Context**: Existing Activity & Incident Tracker (FastAPI + SQLite + vanilla JS SPA)  
**Request**: Add login/register + 4-role RBAC + subgroups + admin panel  
**User decisions**:
- Full system from day 1 (not phased)
- Session cookies (server-side sessions in SQLite)
- Merge users into `comerciales` table (add password/role fields)
- Jefe role sees ALL subgroups (read-only manager), Jefe de Grupo manages one subgroup

---

## Spec Header

### Name
**Authentication & Role-Based Access Control System**

### Smallest Acceptable Scope
Complete authentication + authorization system with:
- **Login/register** screens (username + password, no email verification for MVP)
- **4 roles** with hierarchical access:
  - **Administrador**: Full access + user management panel (CRUD users, assign roles/subgroups)
  - **Jefe**: Read-only access to ALL comerciales/activities/incidents across both subgroups (no user admin)
  - **Jefe de Grupo**: Manages their assigned subgroup (sees team's activities/incidents + own data)
  - **Comercial**: Sees only their own activities/incidents
- **2 subgroups** ("A" and "B") for organizing comerciales under jefes de grupo
- **Admin panel** view (only visible to Administrador role) for user management
- **Session management** (7-day cookie expiry, logout, auto-redirect to login on expired session)
- **Backend RBAC filtering** on all API routes (dashboard stats, lists, detail views)

### Non-Goals (defer to later)
- Email verification or password reset flows
- OAuth/SSO integration
- Two-factor authentication
- Audit logs for user actions
- Password complexity requirements UI
- "Remember me" checkbox (all sessions are 7 days)
- User profile editing by non-admins (admin changes only for MVP)
- Activity/incident reassignment workflows tied to RBAC
- Granular permissions (e.g., "can view but not edit incidents")

---

## Paths to Supplementary Guidelines

**Design system**: Continue using existing industrial dark theme from `static/styles.css`  
- Colors: `#0d0e11` base, `#4f7cff` accent, `#ef4444` danger, `#22c55e` success
- Fonts: Barlow Condensed (headings) + Barlow (body) + DM Mono (labels)
- Patterns: `.badge-*`, `.kpi-card`, `.card`, `.modal-overlay`, etc.

**Tech stack**: No external guidelines needed—stays FastAPI + SQLite + vanilla JS  
- Reference: https://raw.githubusercontent.com/memextech/templates/refs/heads/main/README.md (informational only; project already established)

---

## Decision Snapshot

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Auth method** | Session cookies (HttpOnly) | Simpler than JWT for single-domain app; server controls invalidation |
| **Session storage** | SQLite `sesiones` table | Consistent with existing data layer; no Redis needed |
| **User schema** | Extend `comerciales` table | Avoid join complexity; every user is a comercial (including admins) |
| **Password hashing** | bcrypt via `passlib` | Industry standard, slow hashing defends against brute force |
| **Role model** | Single `rol` enum field | 4 roles is small enough for single field; avoids role_permissions tables |
| **Subgroup model** | `subgrupo` field ('A'/'B'/NULL) | Comerciales + Jefes de Grupo have subgroups; Jefe/Admin don't need one |
| **Frontend auth** | Login screen before app, session cookie auto-sent | No tokens in localStorage; backend middleware enforces auth |
| **Admin panel** | New SPA view "administracion" | Uses existing modal/form patterns; CRUD users via `/api/usuarios/*` |
| **RBAC enforcement** | Backend filters SQL queries by role | Frontend doesn't need role logic; API returns only permitted data |

---

## Architecture at a Glance

### Database Schema Changes

**Extend `comerciales` table**:
```sql
ALTER TABLE comerciales ADD COLUMN username TEXT UNIQUE NOT NULL DEFAULT '';
ALTER TABLE comerciales ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE comerciales ADD COLUMN rol TEXT NOT NULL DEFAULT 'comercial' 
    CHECK(rol IN ('administrador','jefe','jefe_grupo','comercial'));
ALTER TABLE comerciales ADD COLUMN subgrupo TEXT CHECK(subgrupo IN ('A','B') OR subgrupo IS NULL);
```

**New `sesiones` table**:
```sql
CREATE TABLE sesiones (
    session_id   TEXT PRIMARY KEY,
    comercial_id INTEGER NOT NULL REFERENCES comerciales(id) ON DELETE CASCADE,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sesiones_expires ON sesiones(expires_at);
```

**Seed data updates**:
- 1 Administrador: `admin` / `Admin2026!`
- 1 Jefe: `jefe_general` / `Jefe2026!`
- 2 Jefes de Grupo: `jefe_a` (subgrupo A) / `JefeA2026!`, `jefe_b` (subgrupo B) / `JefeB2026!`
- 4 Comerciales: 2 in subgrupo A, 2 in subgrupo B (reuse existing names, add passwords)

### API Endpoints (New)

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| POST | `/api/auth/register` | Create new user (admin-only in production; open for MVP) | No |
| POST | `/api/auth/login` | Authenticate user, create session, return cookie | No |
| POST | `/api/auth/logout` | Delete session | Yes |
| GET | `/api/auth/me` | Get current user info (username, rol, subgrupo) | Yes |
| GET | `/api/usuarios` | List all users (admin-only) | Yes (admin) |
| POST | `/api/usuarios` | Create user (admin-only) | Yes (admin) |
| GET | `/api/usuarios/{id}` | Get user detail (admin-only) | Yes (admin) |
| PUT | `/api/usuarios/{id}` | Update user (admin-only, can change rol/subgrupo/password) | Yes (admin) |
| DELETE | `/api/usuarios/{id}` | Delete user (admin-only) | Yes (admin) |

### API Endpoint Changes (Existing)

**All `/api/*` routes** (except `/auth/*`):
- Add session middleware → validate session cookie → extract `current_user` (comercial record)
- Filter queries by role:
  - **Administrador**: No filters (sees all)
  - **Jefe**: No filters (sees all)
  - **Jefe de Grupo**: Filter `actividades.comercial_id IN (subgroup_member_ids)` + own data
  - **Comercial**: Filter `actividades.comercial_id = current_user.id` (own data only)

**Example: `/api/actividades`**:
```python
# Before (no auth)
SELECT * FROM actividades

# After (RBAC filtering)
if current_user.rol == 'comercial':
    WHERE comercial_id = current_user.id
elif current_user.rol == 'jefe_grupo':
    WHERE comercial_id IN (
        SELECT id FROM comerciales WHERE subgrupo = current_user.subgrupo
    )
# else (admin/jefe): no filter
```

### Frontend Changes

**New navigation states**:
- `login` — Login form (username + password + "Registrarse" link)
- `register` — Register form (username + password + confirm password + "Ya tengo cuenta" link)
- `administracion` — Admin panel (user table + create/edit/delete modals)

**Existing views** (no visual changes, backend filters data):
- `dashboard`, `incidencias`, `actividades`, `negocios`, `comerciales`, `calendario`, `reportes`

**Session flow**:
1. App loads → check `/api/auth/me` → if 401, navigate to `login`
2. User logs in → POST `/api/auth/login` → session cookie set → navigate to `dashboard`
3. User logs out → POST `/api/auth/logout` → session cleared → navigate to `login`
4. Session expires → any API call returns 401 → toast "Sesión expirada" → navigate to `login`

**Admin panel UI**:
- Table columns: ID, Username, Nombre, Rol, Subgrupo, Activo, Acciones (Edit/Delete icons)
- Create/Edit modal: username, nombre, apellido, email, rol dropdown, subgrupo dropdown (conditional on rol), password (required on create, optional on update), activo checkbox
- Delete confirmation: "¿Eliminar usuario X? Todas sus actividades e incidencias se eliminarán."

---

## Implementation Plan

### Phase 1: Database Migration & Seed Users
**Goal**: Extend schema + populate test users

1. **Backup existing DB**: Copy `tracker.db` → `tracker.db.backup` (safety)
2. **Create migration script** `migrations/001_add_auth.sql`:
   - Add 4 columns to `comerciales` (username, password_hash, rol, subgrupo)
   - Create `sesiones` table + index
   - Update existing seed data (add username/password_hash/rol/subgrupo to 4 comerciales)
3. **Run migration**: Execute in `init_db()` if tables are fresh; manual script if DB exists
4. **Seed 7 users**:
   - 1 admin (no subgrupo)
   - 1 jefe (no subgrupo)
   - 2 jefes_grupo (one per subgrupo)
   - Existing 4 comerciales → assign 2 to subgrupo A, 2 to subgrupo B
5. **Verify**: Query `SELECT username, rol, subgrupo FROM comerciales` → expect 7+ rows

**Files modified**: `database.py`

---

### Phase 2: Backend Auth Endpoints
**Goal**: Login/register/logout/me + session management

1. **Install dependencies**: Add `passlib[bcrypt]>=1.7.4` + `python-multipart` to `pyproject.toml`
2. **Create `auth.py` module**:
   - `hash_password(plain: str) -> str` (bcrypt)
   - `verify_password(plain: str, hashed: str) -> bool`
   - `create_session(comercial_id: int, db) -> str` (generate UUID, insert into `sesiones`, return session_id)
   - `get_session(session_id: str, db) -> dict | None` (fetch + validate expires_at)
   - `delete_session(session_id: str, db)` (delete from `sesiones`)
3. **Create auth router** in `routes.py`:
   - `POST /api/auth/register`: Accept `{username, password, nombre, apellido}` → hash password → insert comerciales → return `{id, username}`
   - `POST /api/auth/login`: Accept `{username, password}` → fetch user → verify password → create session → set HttpOnly cookie (`session_id`, 7 days) → return `{username, rol, subgrupo}`
   - `POST /api/auth/logout`: Read session cookie → delete session → clear cookie → return `{success: true}`
   - `GET /api/auth/me`: Read session cookie → get session → fetch user → return `{id, username, nombre, apellido, rol, subgrupo, activo}`
4. **Session middleware**:
   - Create `get_current_user(request: Request, db)` dependency → reads `session_id` cookie → validates session → returns comercial record or raises 401
   - Apply to all `/api/*` routes EXCEPT `/api/auth/register` and `/api/auth/login`
5. **Test with curl**:
   - Register user → login → check `/api/auth/me` → logout → verify 401

**Files created**: `auth.py`  
**Files modified**: `routes.py`, `pyproject.toml`

---

### Phase 3: RBAC Filtering in API Routes
**Goal**: Filter data by role in all existing endpoints

1. **Update `/api/stats`** (dashboard KPIs):
   - Comercial: Count only their incidencias/actividades
   - Jefe de Grupo: Count subgroup's incidencias/actividades
   - Jefe/Admin: Count all (no filter)
2. **Update `/api/actividades` (list)**:
   - Add `WHERE comercial_id IN (...)` filter based on role
   - Keep existing filters (estado, tipo, q) + add role filter
3. **Update `/api/actividades/{id}` (detail)**:
   - Check if current_user can access (owns it OR is jefe/admin OR is jefe_grupo of owner's subgrupo)
   - Raise 403 if forbidden
4. **Update `/api/incidencias` (list)**:
   - Filter by `asignado_a` → resolve to comercial_id → apply role filter
   - (Note: incidencias are assigned to negocio, but may be assigned to a comercial name—match against comerciales)
5. **Update `/api/incidencias/{id}` (detail)**:
   - Check if assigned comercial is in current_user's visible scope
   - Raise 403 if forbidden
6. **Update `/api/comerciales` (list)**:
   - Comercial: See only self
   - Jefe de Grupo: See subgroup + self
   - Jefe/Admin: See all
7. **Update `/api/negocios` (list)**:
   - Link negocios to comerciales via incidencias/actividades → filter by visible comerciales
   - (Or simpler: Admin/Jefe see all, others see negocios they interact with)
8. **Update `/api/calendario` (events)**:
   - Filter incidencias + actividades by same role logic
9. **Update export endpoints** (`/api/export/actividades`, `/api/export/incidencias`):
   - Apply same filters as list endpoints
10. **Helper function** `get_visible_comercial_ids(current_user, db) -> list[int]`:
    - Centralize role → IDs logic
    - Reuse across all routes

**Files modified**: `routes.py`

---

### Phase 4: Frontend Login/Register UI
**Goal**: Login screen before app access

1. **Update `app.js` navigation**:
   - Add `login` and `register` to `state.view`
   - Modify `navigate(view)` → hide `#sidebar` and `#header` if view is `login` or `register`
   - Add `checkAuth()` function → calls `/api/auth/me` on app load → if 401, navigate to `login`
2. **Create `loadLogin()` function**:
   - Render login form in `#main-content`
   - Fields: username (text input), password (password input)
   - Buttons: "Iniciar sesión" (submit), "Registrarse" (link to register view)
   - On submit → POST `/api/auth/login` → if success, call `checkAuth()` → navigate to `dashboard`
   - On error → toast "Usuario o contraseña incorrectos"
3. **Create `loadRegister()` function**:
   - Render register form in `#main-content`
   - Fields: username, password, confirm password, nombre, apellido
   - Buttons: "Crear cuenta" (submit), "Ya tengo cuenta" (link to login view)
   - On submit → validate password === confirmPassword → POST `/api/auth/register` → auto-login → navigate to `dashboard`
   - On error → toast error message
4. **Update `index.html`**:
   - Add logout button in header (icon + tooltip) → visible only when authenticated
   - On click → POST `/api/auth/logout` → navigate to `login`
5. **Global error handler**:
   - Wrap `api.get/post/put/del` → catch 401 → navigate to `login` + toast "Sesión expirada"
6. **Test flow**: Open app → see login → register new user → auto-login → see dashboard → logout → see login

**Files modified**: `static/app.js`, `static/index.html`

---

### Phase 5: Admin Panel UI
**Goal**: User management interface for admins

1. **Add "Administración" nav item** in `index.html`:
   - Show only if `state.currentUser.rol === 'administrador'`
   - Icon: user-cog or shield
2. **Create `loadAdministracion()` function** in `app.js`:
   - Fetch `/api/usuarios` → render table
   - Columns: ID, Username, Nombre Completo, Rol (badge), Subgrupo (badge or "—"), Activo (✓/✗), Acciones (edit/delete icons)
   - Add "Crear Usuario" button above table
3. **Create `openUsuarioForm(id)` function**:
   - If `id` is null → create mode; else → fetch `/api/usuarios/{id}` → edit mode
   - Modal fields:
     - username (text, required)
     - nombre (text, required)
     - apellido (text, optional)
     - email (text, optional)
     - telefono (text, optional)
     - rol (dropdown: administrador/jefe/jefe_grupo/comercial, required)
     - subgrupo (dropdown: A/B/—, shown only if rol is jefe_grupo or comercial)
     - password (password input, required on create, optional on edit with placeholder "Dejar vacío para no cambiar")
     - activo (checkbox, default checked)
   - On save → POST `/api/usuarios` or PUT `/api/usuarios/{id}` → refresh table → toast success
4. **Create `deleteUsuario(id)` function**:
   - Confirm modal: "¿Eliminar usuario X? Todas sus actividades e incidencias se eliminarán."
   - On confirm → DELETE `/api/usuarios/{id}` → refresh table → toast success
5. **Backend `/api/usuarios` routes** (created in Phase 2):
   - GET `/api/usuarios` → fetch all comerciales (admin-only)
   - POST `/api/usuarios` → insert comerciales (admin-only, hash password)
   - PUT `/api/usuarios/{id}` → update comerciales (admin-only, hash password if provided)
   - DELETE `/api/usuarios/{id}` → delete comerciales (admin-only, CASCADE deletes actividades/incidencias)
6. **Test**: Login as admin → navigate to Administración → create user → edit user → delete user

**Files modified**: `static/app.js`, `static/index.html`, `routes.py`

---

### Phase 6: Session Management & Cleanup
**Goal**: Auto-expire sessions + cleanup old sessions

1. **Session expiry check** in `get_session()`:
   - If `expires_at < now()` → delete session → return None
2. **Periodic cleanup task**:
   - Add lifespan startup task → schedule every 1 hour → delete expired sessions
   - Use `asyncio.create_task()` + `while True: await asyncio.sleep(3600)`
3. **Frontend session refresh**:
   - Optional: Every 30 min, call `/api/auth/me` to keep session alive
   - (Or simpler: 7-day expiry is long enough, no refresh needed)
4. **Test expiry**: Manually set `expires_at` to past → verify API returns 401 → frontend redirects to login

**Files modified**: `auth.py`, `routes.py`

---

### Phase 7: Polish & Edge Cases
**Goal**: Handle edge cases + improve UX

1. **Prevent self-deletion**: Admin can't delete their own account → show error toast
2. **Prevent last admin deletion**: If only 1 admin exists, can't delete → show error toast
3. **Username validation**: No spaces, 3-20 chars, alphanumeric+underscore only
4. **Password validation**: Min 8 chars (enforce in backend, show hint in frontend)
5. **Loading states**: Show spinner on login/register submit buttons
6. **Remember last view**: Store `state.lastView` in sessionStorage → restore after login
7. **Role badges in UI**: Add colored badges for roles (like prioridad badges):
   - `.badge-administrador` → red
   - `.badge-jefe` → purple
   - `.badge-jefe_grupo` → blue
   - `.badge-comercial` → gray
8. **Subgrupo badges**: `.badge-subgrupo-a` → orange, `.badge-subgrupo-b` → green
9. **Test all roles**: Login as each role → verify correct data visibility

**Files modified**: `static/app.js`, `static/styles.css`, `routes.py`

---

## Verification & Demo Script

### Test Users (Seeded)
```
Username          Password      Rol              Subgrupo
---------------------------------------------------------
admin             Admin2026!    administrador    —
jefe_general      Jefe2026!     jefe             —
jefe_a            JefeA2026!    jefe_grupo       A
jefe_b            JefeB2026!    jefe_grupo       B
carlos_ruiz       Carlos2026!   comercial        A
maria_lopez       Maria2026!    comercial        A
ana_gomez         Ana2026!      comercial        B
javier_perez      Javier2026!   comercial        B
```

### Verification Steps

**1. Authentication Flow**
```
✓ Open http://localhost:8000 → Redirect to login
✓ Register new user "test_user" → Auto-login → See dashboard
✓ Logout → Redirect to login
✓ Login with wrong password → Error toast "Usuario o contraseña incorrectos"
✓ Login with correct credentials → Dashboard
```

**2. Role-Based Data Visibility**
```
✓ Login as comercial (carlos_ruiz)
  → Dashboard shows only own actividades/incidencias
  → Comerciales list shows only self
  → Actividades list shows only own
  → Try to access /api/actividades/1 (owned by maria_lopez) → 403 error

✓ Login as jefe_grupo (jefe_a)
  → Dashboard shows subgrupo A stats (carlos_ruiz + maria_lopez + self)
  → Comerciales list shows subgrupo A members
  → Actividades list shows subgrupo A activities
  → Try to access subgrupo B activity → 403 error

✓ Login as jefe (jefe_general)
  → Dashboard shows ALL stats (both subgroups)
  → Comerciales list shows everyone
  → Can view any activity/incident (read-only)
  → No "Administración" nav item

✓ Login as admin (admin)
  → Dashboard shows ALL stats
  → "Administración" nav item visible
  → Can access admin panel
```

**3. Admin Panel**
```
✓ Login as admin → Navigate to Administración
✓ See table with 8 users (seeded)
✓ Create new user → Set rol=comercial, subgrupo=A → Save → See in table
✓ Edit user → Change rol to jefe_grupo → Change subgrupo to B → Save → Verify update
✓ Delete user → Confirm → User removed from table
✓ Try to delete self (admin) → Error toast "No puedes eliminar tu propia cuenta"
✓ Create user with duplicate username → Error toast
✓ Create user with password < 8 chars → Error toast
```

**4. Session Expiry**
```
✓ Login → Wait for session expiry (or manually set expires_at to past in DB)
✓ Try to access /api/stats → 401 → Redirect to login + toast "Sesión expirada"
✓ Login again → Session restored
```

**5. Calendar & Reports (RBAC Filtering)**
```
✓ Login as comercial → Calendario shows only own events
✓ Login as jefe_grupo → Calendario shows subgroup events
✓ Login as jefe → Calendario shows all events
✓ Export actividades → CSV contains only visible data (filtered by role)
```

**6. Edge Cases**
```
✓ Login with inactive user (activo=0) → Error "Usuario inactivo"
✓ Admin deactivates user → User's session still valid until expiry (or logout)
✓ Admin changes user's rol → User sees new permissions after logout/login
✓ Jefe de Grupo owns actividades → Visible to self + admin + jefe + own subgroup leader
```

---

## Deploy

**No deployment changes needed** — existing deploy process remains:
1. `./deploy.sh` (if using hosting) or `./start.sh` (local)
2. Database migrates automatically on startup (if `init_db()` detects missing columns)
3. Session cookies work on any domain (no CORS issues for same-origin)

**Security checklist for production**:
- [ ] Disable `/api/auth/register` endpoint (or add admin-only check)
- [ ] Set `SESSION_SECRET` env var for cookie signing (use secrets module)
- [ ] Use HTTPS in production (cookies with `Secure` flag)
- [ ] Set `COOKIE_DOMAIN` to actual domain (not localhost)
- [ ] Rate-limit login endpoint (e.g., max 5 attempts per 15 min per IP)
- [ ] Add password complexity regex validation
- [ ] Audit log for admin actions (user create/edit/delete)

**Optional enhancements** (post-MVP):
- Email verification on register
- Password reset via email token
- "Remember me" checkbox (30-day vs 7-day session)
- User profile self-edit (change own password)
- Activity/incident reassignment UI (with RBAC checks)
- Audit trail table (who changed what when)
- Two-factor authentication (TOTP)

---

**END OF PLAN**

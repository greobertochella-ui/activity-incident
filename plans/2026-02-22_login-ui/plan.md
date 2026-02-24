# Spec Provenance

**Request**: "lo unico q quiero q hagas es cambiar el inicio de dashboard a login" → discovered full auth backend exists, needs frontend UI

**Discovery findings**:
- ✅ Backend auth system fully implemented (`auth.py`, session management, bcrypt password hashing)
- ✅ API endpoints ready: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- ✅ Role system in place: `administrador`, `jefe`, `jefe_grupo`, `comercial`
- ✅ Seed users with credentials (admin/Admin2026!, jefe_general/Jefe2026!, etc.)
- ❌ Frontend login/register UI missing entirely
- ❌ No session check on app initialization

**User choice**: "Pantalla única con tabs (Login | Registro) - estilo moderno"

---

# Spec Header

## Name
**Activity & Incident Tracker — Login/Register Frontend UI**

## Smallest Acceptable Scope
Add login/register screen with tab switcher that:
1. Shows before dashboard on app load
2. Login tab: username + password → calls `/api/auth/login` → redirects to dashboard on success
3. Register tab: full form → calls `/api/auth/register` → auto-login → redirects to dashboard
4. Session check on init: if valid session exists, skip login and go to dashboard
5. Logout button in sidebar → calls `/api/auth/logout` → back to login screen

**Design**: Single view with animated tab switcher (Login | Registro), dark industrial theme matching existing app, glassmorphic card on gradient background.

## Non-Goals (defer to future)
- Password recovery / reset flow
- "Remember me" checkbox (session already lasts 7 days via backend)
- Email verification
- CAPTCHA / rate limiting
- Edit profile from frontend (use existing CRUD comerciales for now)
- Admin panel for user management UI (use backend endpoints directly)

---

# Paths to Supplementary Guidelines

**Design system**: Current app uses custom dark industrial theme (not a standard template):
- Colors: `#0d0e11` base, `#4f7cff` accent, `#ef4444` danger, `#22c55e` success
- Fonts: Barlow Condensed + Barlow + DM Mono
- Reference existing `styles.css` for consistency

**Tech stack**: Vanilla HTML/CSS/JS SPA (no framework), FastAPI backend
- Pattern: https://raw.githubusercontent.com/memextech/templates/refs/heads/main/stack/python_streamlit.md (closest match for Python + simple frontend)
- Note: App uses FastAPI not Streamlit, but guidelines help with Python backend patterns

---

# Decision Snapshot

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Login UI pattern** | Single view with tabs | Modern UX, less navigation, fits user request |
| **Styling approach** | Extend existing `styles.css` | Reuse theme variables, maintain consistency |
| **Session management** | Cookie-based (HttpOnly) | Backend already handles it, more secure than localStorage |
| **Form validation** | Client-side + backend errors | Fast feedback + server-side security |
| **Auth check timing** | On `init()` before any navigation | Prevents flash of dashboard before redirect |
| **Logout placement** | Button at bottom of sidebar | Accessible from any view, non-intrusive |
| **Tab switching** | CSS classes + JS toggle | No dependencies, smooth animations |
| **Registration role** | Hardcoded to `comercial` | Safe default, admins can edit via backend/DB |

---

# Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Load                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                    init() called
                         │
                         ▼
              ┌──────────────────────┐
              │  checkAuth()         │──────► GET /api/auth/me
              └──────────┬───────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
     Session valid?            No session?
            │                         │
            ▼                         ▼
    navigate('dashboard')     navigate('login')
            │                         │
            │                    loadLogin()
            │                         │
            │              ┌──────────┴──────────┐
            │              │                     │
            │         [Login Tab]           [Registro Tab]
            │              │                     │
            │     handleLogin() ─────┐   handleRegister() ────┐
            │              │         │          │              │
            │              ▼         ▼          ▼              ▼
            │      POST /auth/login   POST /auth/register
            │              │                     │
            │       Set session cookie    Auto-login after
            │              │                     │
            └──────────────┴─────────────────────┘
                           │
                    navigate('dashboard')
                           │
                  User works in app...
                           │
                  Click "Cerrar Sesión"
                           │
                   handleLogout() ─────► POST /api/auth/logout
                           │
                   Clear cookie & navigate('login')
```

**Key flow changes**:
1. `init()` now calls `checkAuth()` FIRST
2. If no valid session → stay on login view
3. Login/register success → call `checkAuth()` again → navigate to dashboard
4. All other views require auth (already enforced by backend middleware)

---

# Implementation Plan

## Phase 1: HTML Structure (index.html)

**1.1 Add login view section**
Location: Inside `<main class="main-content">`, before existing views

```html
<!-- LOGIN VIEW -->
<section class="view active" id="view-login">
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="logo-mark">
          <span class="logo-dot"></span>
          <span class="logo-dot"></span>
          <span class="logo-dot"></span>
        </div>
        <h1>TRACKER</h1>
        <p>Gestión Comercial</p>
      </div>

      <div class="login-tabs">
        <button class="login-tab active" data-tab="login">Iniciar Sesión</button>
        <button class="login-tab" data-tab="register">Registrarse</button>
      </div>

      <div class="login-tab-content active" id="tab-login">
        <form id="form-login" onsubmit="handleLogin(event)">
          <div class="form-group">
            <label>Usuario</label>
            <input type="text" name="username" required autocomplete="username">
          </div>
          <div class="form-group">
            <label>Contraseña</label>
            <input type="password" name="password" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn-primary btn-block">Entrar</button>
        </form>
      </div>

      <div class="login-tab-content" id="tab-register">
        <form id="form-register" onsubmit="handleRegister(event)">
          <div class="form-row">
            <div class="form-group">
              <label>Nombre</label>
              <input type="text" name="nombre" required>
            </div>
            <div class="form-group">
              <label>Apellido</label>
              <input type="text" name="apellido" required>
            </div>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" name="email" required>
          </div>
          <div class="form-group">
            <label>Teléfono</label>
            <input type="tel" name="telefono">
          </div>
          <div class="form-group">
            <label>Usuario</label>
            <input type="text" name="username" required autocomplete="username">
          </div>
          <div class="form-group">
            <label>Contraseña</label>
            <input type="password" name="password" required minlength="8" autocomplete="new-password">
            <small>Mínimo 8 caracteres</small>
          </div>
          <button type="submit" class="btn-primary btn-block">Crear Cuenta</button>
        </form>
      </div>
    </div>
  </div>
</section>
```

**1.2 Add logout button to sidebar**
Location: Bottom of `.sidebar-nav`, after all nav items

```html
<div class="sidebar-footer">
  <button class="btn-logout" onclick="handleLogout()" style="display:none;" id="btn-logout">
    <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9"/></svg>
    Cerrar Sesión
  </button>
</div>
```

## Phase 2: CSS Styles (styles.css)

**2.1 Login view layout**
Append to end of `styles.css`:

```css
/* ═══════════════════════════════════════════════════════════
   LOGIN VIEW
   ═══════════════════════════════════════════════════════════ */

.login-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0d0e11 0%, #1a1d29 50%, #0d0e11 100%);
  z-index: 999;
}

.login-card {
  width: 90%;
  max-width: 480px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.login-header .logo-mark {
  display: inline-flex;
  gap: 6px;
  margin-bottom: 12px;
}

.login-header .logo-dot {
  width: 8px;
  height: 8px;
  background: var(--accent-blue);
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

.login-header .logo-dot:nth-child(2) { animation-delay: 0.2s; }
.login-header .logo-dot:nth-child(3) { animation-delay: 0.4s; }

.login-header h1 {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 2rem;
  font-weight: 700;
  color: var(--accent-blue);
  margin: 0 0 4px 0;
  letter-spacing: 2px;
}

.login-header p {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin: 0;
}

.login-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  background: rgba(255, 255, 255, 0.02);
  padding: 4px;
  border-radius: 8px;
}

.login-tab {
  flex: 1;
  padding: 10px 16px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-family: 'Barlow', sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.login-tab:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.login-tab.active {
  background: var(--accent-blue);
  color: white;
}

.login-tab-content {
  display: none;
}

.login-tab-content.active {
  display: block;
  animation: fadeInUp 0.3s ease;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-group small {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.btn-block {
  width: 100%;
  margin-top: 8px;
}

/* Sidebar logout button */
.sidebar-footer {
  margin-top: auto;
  padding: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.btn-logout {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  color: var(--danger-red);
  font-family: 'Barlow', sans-serif;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-logout:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: var(--danger-red);
}

.btn-logout svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

## Phase 3: JavaScript Auth Logic (app.js)

**3.1 Add auth state to global state object**
Location: After existing `state` declaration (~line 58)

```javascript
const state = {
  view: 'dashboard',
  search: '',
  negocios: [],
  comerciales: [],
  currentUser: null  // ADD THIS
};
```

**3.2 Add auth functions**
Location: After `navigate()` function (~line 95), before `loadView()`

```javascript
// ═══════════════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function checkAuth() {
  try {
    const user = await api.get('/auth/me');
    state.currentUser = user;
    return true;
  } catch (err) {
    state.currentUser = null;
    return false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const data = {
    username: form.username.value.trim(),
    password: form.password.value
  };

  try {
    const result = await api.post('/auth/login', data);
    toast('Bienvenido, ' + result.nombre, 'success');
    
    // Re-check auth to populate currentUser
    await checkAuth();
    
    // Show logout button
    document.getElementById('btn-logout').style.display = 'flex';
    
    // Navigate to dashboard
    navigate('dashboard');
  } catch (err) {
    toast(err.message || 'Error al iniciar sesión', 'error');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.target;
  const data = {
    nombre: form.nombre.value.trim(),
    apellido: form.apellido.value.trim(),
    email: form.email.value.trim(),
    telefono: form.telefono.value.trim(),
    username: form.username.value.trim(),
    password: form.password.value
  };

  try {
    await api.post('/auth/register', data);
    toast('Cuenta creada exitosamente', 'success');
    
    // Auto-login after registration
    await handleLogin({ 
      preventDefault: () => {},
      target: {
        username: { value: data.username },
        password: { value: data.password }
      }
    });
  } catch (err) {
    toast(err.message || 'Error al crear cuenta', 'error');
  }
}

async function handleLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  
  try {
    await api.post('/auth/logout', {});
    state.currentUser = null;
    document.getElementById('btn-logout').style.display = 'none';
    navigate('login');
    toast('Sesión cerrada', 'info');
  } catch (err) {
    toast('Error al cerrar sesión', 'error');
  }
}

function loadLogin() {
  // Setup tab switching
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update tab buttons
      document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update tab content
      document.querySelectorAll('.login-tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tab-' + targetTab).classList.add('active');
    });
  });
}
```

**3.3 Update navigate() function**
Location: Replace existing `navigate()` function (~line 85)

```javascript
function navigate(view) {
  state.view = view;
  
  // Hide sidebar for login view
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.querySelector('.main-content');
  
  if (view === 'login') {
    sidebar.style.display = 'none';
    mainContent.style.marginLeft = '0';
  } else {
    sidebar.style.display = 'flex';
    mainContent.style.marginLeft = '260px';
  }
  
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view===view));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id==='view-'+view));
  
  const titles = {
    dashboard:'Dashboard',
    incidencias:'Incidencias',
    actividades:'Actividades',
    negocios:'Negocios',
    comerciales:'Comerciales',
    calendario:'Calendario',
    reportes:'Reportes',
    login:'Iniciar Sesión'
  };
  document.getElementById('page-title').textContent = titles[view]||view;
  
  loadView(view);
}
```

**3.4 Update loadView() function**
Location: Replace existing `loadView()` function (~line 95)

```javascript
function loadView(view) {
  if (view==='login')       return loadLogin();
  if (view==='dashboard')   return loadDashboard();
  if (view==='incidencias') return loadIncidencias();
  if (view==='actividades') return loadActividades();
  if (view==='negocios')    return loadNegocios();
  if (view==='comerciales') return loadComerciales();
  if (view==='calendario')  return loadCalendario();
  if (view==='reportes')    return loadReportes();
}
```

**3.5 Update init() function**
Location: Replace existing `init()` function (~line 500)

```javascript
async function init() {
  modal.init();
  
  // Check authentication first
  const isAuthenticated = await checkAuth();
  
  if (isAuthenticated) {
    // Show logout button
    document.getElementById('btn-logout').style.display = 'flex';
    
    // Setup navigation
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.view));
    });
    document.getElementById('btn-nuevo').onclick = handleNuevo;
    
    await refreshLists();
    navigate('dashboard');
  } else {
    // Not authenticated, go to login
    navigate('login');
  }
}
```

**3.6 Make functions globally available**
Location: After existing `window.` assignments (~line 510)

```javascript
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
```

---

# Verification & Demo Script

## Test Sequence

### 1. Fresh Start (No Session)
```bash
# Delete tracker.db to reset
rm tracker.db

# Start app
./start.sh
```

**Expected**:
- ✅ App loads on login screen (no sidebar visible)
- ✅ Login tab active by default
- ✅ Username/password fields present

### 2. Login with Seed User
**Action**: Enter `admin` / `Admin2026!` → click "Entrar"

**Expected**:
- ✅ Toast: "Bienvenido, Admin"
- ✅ Redirect to dashboard
- ✅ Sidebar appears with all nav items
- ✅ "Cerrar Sesión" button visible at bottom of sidebar
- ✅ Dashboard loads with KPIs and charts

### 3. Navigation While Authenticated
**Action**: Click through nav items (Incidencias, Actividades, Negocios, etc.)

**Expected**:
- ✅ All views load normally
- ✅ API calls succeed (session cookie sent automatically)
- ✅ No 401 errors in console

### 4. Logout
**Action**: Click "Cerrar Sesión" button → confirm

**Expected**:
- ✅ Confirmation dialog appears
- ✅ Toast: "Sesión cerrada"
- ✅ Redirect to login screen
- ✅ Sidebar hidden again

### 5. Registration Flow
**Action**: Click "Registrarse" tab

**Expected**:
- ✅ Tab switches with smooth animation
- ✅ Registration form appears with all fields

**Action**: Fill form with:
- Nombre: "Test"
- Apellido: "User"
- Email: "test@example.com"
- Teléfono: "600000099"
- Usuario: "testuser"
- Contraseña: "Test1234!"

→ Click "Crear Cuenta"

**Expected**:
- ✅ Toast: "Cuenta creada exitosamente"
- ✅ Auto-login happens (toast: "Bienvenido, Test")
- ✅ Redirect to dashboard
- ✅ User can work normally

### 6. Session Persistence
**Action**: Reload browser page (F5)

**Expected**:
- ✅ App loads directly on dashboard (session cookie still valid)
- ✅ No flash of login screen
- ✅ User stays authenticated

### 7. Session Expiry Simulation
**Action**: Manually delete session from database:
```bash
sqlite3 tracker.db "DELETE FROM sesiones WHERE comercial_id = (SELECT id FROM comerciales WHERE username='testuser')"
```

**Action**: Try to navigate or refresh page

**Expected**:
- ✅ API returns 401
- ✅ App redirects to login
- ✅ User must login again

### 8. Invalid Credentials
**Action**: Login tab → enter wrong password

**Expected**:
- ✅ Toast error: "Usuario o contraseña incorrectos"
- ✅ Stay on login screen
- ✅ Form not cleared (can retry)

### 9. Duplicate Username Registration
**Action**: Try to register with username "admin" (already exists)

**Expected**:
- ✅ Toast error: "El nombre de usuario ya existe"
- ✅ Stay on registration form

## Role-Based Testing (Optional)
Test different user roles to verify backend permissions:

| User | Password | Role | Expected Access |
|------|----------|------|-----------------|
| `admin` | `Admin2026!` | administrador | Full access |
| `jefe_general` | `Jefe2026!` | jefe | All comerciales data |
| `jefe_a` | `JefeA2026!` | jefe_grupo | Only subgrupo A data |
| `carlos_ruiz` | `Carlos2026!` | comercial | Own activities only |

**Note**: Role restrictions are backend-enforced via `get_current_user()` middleware. Frontend shows all data but backend filters by role.

---

# Deploy

**No deploy changes needed** — this is frontend-only addition to existing app.

## Development
```bash
./start.sh
# App runs on $APP_PORT (default from start.sh)
```

## Production Considerations
1. **HTTPS required** for HttpOnly cookies in production
2. **SameSite cookie** already set to `lax` (good for CSRF protection)
3. **Session cleanup**: Backend has `cleanup_expired_sessions()` function — consider adding a background task to run it daily
4. **Rate limiting**: Consider adding login attempt limits (not in scope for MVP)

## Environment Variables
No new env vars needed. Existing:
- `DB_PATH` (default: `./tracker.db`)
- `APP_PORT` (from `start.sh`)

## Database Migrations
**None required** — `sesiones` table already exists in schema.

---

**Implementation estimate**: ~2-3 hours for a single developer  
**Complexity**: Low (pure frontend addition, backend ready)  
**Risk**: Minimal (isolated changes, easy to test and rollback)

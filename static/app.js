/* ═══════════════════════════════════════════════════
   TRACKER SPA — app.js
   ═══════════════════════════════════════════════════ */

'use strict';

const api = {
  async get(path) {
    const r = await fetch('/api' + path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(path, body) {
    const r = await fetch('/api' + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path) {
    const r = await fetch('/api' + path, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

function toast(msg, type) {
  type = type || 'info';
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(function(){ el.remove(); }, 3200);
}

const modal = {
  overlay: null, titleEl: null, bodyEl: null, footerEl: null,
  init() {
    this.overlay  = document.getElementById('modal-overlay');
    this.titleEl  = document.getElementById('modal-title');
    this.bodyEl   = document.getElementById('modal-body');
    this.footerEl = document.getElementById('modal-footer');
    const self = this;
    document.getElementById('modal-close').onclick = function(){ self.close(); };
    this.overlay.addEventListener('click', function(e){ if (e.target === self.overlay) self.close(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') self.close(); });
  },
  open(title, body, footer) {
    footer = footer || '';
    this.titleEl.textContent = title;
    this.bodyEl.innerHTML = body;
    this.footerEl.innerHTML = footer;
    this.overlay.classList.add('open');
  },
  close() { this.overlay.classList.remove('open'); },
};

const state = { view: 'dashboard', search: '', negocios: [], comerciales: [], currentUser: null };

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const fmt = {
  date(s) { if (!s) return '—'; const d = new Date(s); return isNaN(d)?s:d.toLocaleDateString('es-ES'); },
  datetime(s) { if (!s) return '—'; return new Date(s).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'}); },
  badge(val) { return '<span class="badge badge-'+val+'">'+val.replace('_',' ')+'</span>'; },
  avatar(nombre) { return (nombre||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase(); },
  tipoIcon(tipo) { const m={visita:'VIS',llamada:'TEL',email:'MAL',reunion:'REU',demo:'DEM',propuesta:'PRO',cierre:'CIE',otro:'OTR'}; return m[tipo]||tipo.slice(0,3).toUpperCase(); },
  dur(min) { if(!min) return '—'; if(min<60) return min+' min'; return Math.floor(min/60)+'h '+(min%60?(min%60)+'m':''); },
};

function emptyState(msg, description, actionText, actionCallback) {
  // Support old single-param usage
  if (typeof msg === 'string' && !description) {
    const icon = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-title">${msg || 'Sin resultados'}</div></div>`;
  }
  
  // New enhanced version
  const icon = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${msg}</div>
      ${description ? `<div class="empty-state-description">${description}</div>` : ''}
      ${actionText ? `<button class="btn-primary" onclick="${actionCallback || ''}">${actionText}</button>` : ''}
    </div>
  `;
}

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
    
    // Show admin menu if user is administrador
    if (state.currentUser && state.currentUser.rol === 'administrador') {
      document.getElementById('nav-admin').style.display = 'flex';
    }
    
    // Setup navigation listeners (same as init)
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.view));
    });
    document.getElementById('btn-nuevo').onclick = handleNuevo;
    
    // Load initial data
    await refreshLists();
    
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
    const loginResult = await api.post('/auth/login', {
      username: data.username,
      password: data.password
    });
    
    toast('Bienvenido, ' + loginResult.nombre, 'success');
    
    // Re-check auth to populate currentUser
    await checkAuth();
    
    // Show logout button
    document.getElementById('btn-logout').style.display = 'flex';
    
    // Show admin menu if user is administrador
    if (state.currentUser && state.currentUser.rol === 'administrador') {
      document.getElementById('nav-admin').style.display = 'flex';
    }
    
    // Setup navigation listeners (same as init)
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.view));
    });
    document.getElementById('btn-nuevo').onclick = handleNuevo;
    
    // Load initial data
    await refreshLists();
    
    // Navigate to dashboard
    navigate('dashboard');
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

function showForgotPassword() {
  modal.open('Recuperar Contraseña',
    '<div class="form-group">'+
    '<label>Email</label>'+
    '<input type="email" id="forgot-email" placeholder="correo@ejemplo.com" required>'+
    '<small style="color:var(--text3);margin-top:8px;display:block">Te enviaremos un enlace para restablecer tu contraseña</small>'+
    '</div>',
    '<button class="btn-ghost" onclick="modal.close()">Cancelar</button>'+
    '<button class="btn-primary" onclick="sendPasswordReset()">Enviar</button>'
  );
}

async function sendPasswordReset() {
  const email = document.getElementById('forgot-email').value.trim();
  
  if (!email) {
    toast('Ingresa tu email', 'error');
    return;
  }
  
  try {
    await api.post('/auth/forgot-password', { email });
    modal.close();
    toast('Si el email existe, recibirás instrucciones de recuperación', 'success');
  } catch (err) {
    toast(err.message || 'Error al enviar email', 'error');
  }
}

async function handlePasswordReset() {
  // Get token from URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  
  if (!token) {
    toast('Token inválido', 'error');
    return;
  }
  
  modal.open('Restablecer Contraseña',
    '<div class="form-group">'+
    '<label>Nueva Contraseña</label>'+
    '<input type="password" id="reset-password" placeholder="Mínimo 8 caracteres" minlength="8" required>'+
    '</div>'+
    '<div class="form-group">'+
    '<label>Confirmar Contraseña</label>'+
    '<input type="password" id="reset-password-confirm" placeholder="Repite la contraseña" minlength="8" required>'+
    '</div>',
    '<button class="btn-ghost" onclick="modal.close(); window.location.href=\'/\';">Cancelar</button>'+
    '<button class="btn-primary" onclick="submitPasswordReset(\''+escAttr(token)+'\')">Restablecer</button>'
  );
}

async function submitPasswordReset(token) {
  const password = document.getElementById('reset-password').value;
  const confirm = document.getElementById('reset-password-confirm').value;
  
  if (!password || password.length < 8) {
    toast('La contraseña debe tener al menos 8 caracteres', 'error');
    return;
  }
  
  if (password !== confirm) {
    toast('Las contraseñas no coinciden', 'error');
    return;
  }
  
  try {
    await api.post('/auth/reset-password', { token, password });
    modal.close();
    toast('Contraseña actualizada correctamente. Ya puedes iniciar sesión', 'success');
    
    // Remove token from URL and reload
    window.history.replaceState({}, document.title, '/');
    setTimeout(() => navigate('login'), 1500);
  } catch (err) {
    toast(err.message || 'Error al restablecer contraseña', 'error');
  }
}

function loadLogin() {
  // Remove existing listeners to avoid duplicates
  const tabs = document.querySelectorAll('.login-tab');
  tabs.forEach(tab => {
    const newTab = tab.cloneNode(true);
    tab.parentNode.replaceChild(newTab, tab);
  });
  
  // Setup tab switching with fresh elements
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
  
  // Ensure forms are properly set
  const loginForm = document.getElementById('form-login');
  const registerForm = document.getElementById('form-register');
  
  if (loginForm) {
    loginForm.onsubmit = handleLogin;
  }
  if (registerForm) {
    registerForm.onsubmit = handleRegister;
  }
}

function navigate(view) {
  state.view = view;
  
  // Hide sidebar for login view
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.querySelector('.main');
  
  if (view === 'login') {
    sidebar.style.display = 'none';
    mainContent.style.marginLeft = '0';
  } else {
    sidebar.style.display = 'flex';
    mainContent.style.marginLeft = '';
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
    administracion:'Administración',
    login:'Iniciar Sesión'
  };
  document.getElementById('page-title').textContent = titles[view]||view;
  
  loadView(view);
}

function loadView(view) {
  if (view==='login')          return loadLogin();
  if (view==='dashboard')      return loadDashboard();
  if (view==='incidencias')    return loadIncidencias();
  if (view==='actividades')    return loadActividades();
  if (view==='negocios')       return loadNegocios();
  if (view==='comerciales')    return loadComerciales();
  if (view==='calendario')     return loadCalendario();
  if (view==='reportes')       return loadReportes();
  if (view==='administracion') return loadAdministracion();
}

async function loadDashboard() {
  try {
    const [stats, incs, acts] = await Promise.all([
      api.get('/stats'), api.get('/incidencias?estado=abierta'), api.get('/actividades?estado=pendiente'),
    ]);
    document.getElementById('kpi-inc-abiertas').textContent = stats.incidencias_abiertas;
    document.getElementById('kpi-act-pendientes').textContent = stats.actividades_pendientes;
    document.getElementById('kpi-negocios').textContent = stats.total_negocios;
    document.getElementById('kpi-comerciales').textContent = stats.total_comerciales;
    const critica = (stats.incidencias_por_prioridad&&stats.incidencias_por_prioridad.critica)||0;
    document.getElementById('kpi-inc-critica').textContent = critica>0?'⚠ '+critica+' crítica'+(critica>1?'s':''):'';
    document.getElementById('badge-incidencias').textContent = stats.incidencias_abiertas||'';
    document.getElementById('badge-actividades').textContent = stats.actividades_pendientes||'';

    const dil = document.getElementById('dash-incidencias-list');
    dil.innerHTML = !incs.length ? emptyState('Sin incidencias abiertas') :
      incs.slice(0,6).map(i=>'<div class="mini-item" onclick="openIncidenciaDetail('+i.id+')"><div class="mini-item-main"><span class="mini-item-title">'+escHtml(i.titulo)+'</span><span class="mini-item-sub">'+escHtml(i.negocio_nombre)+' · '+fmt.date(i.creado_en)+'</span></div>'+fmt.badge(i.prioridad)+' '+fmt.badge(i.estado)+'</div>').join('');

    const dal = document.getElementById('dash-actividades-list');
    dal.innerHTML = !acts.length ? emptyState('Sin actividades pendientes') :
      acts.slice(0,6).map(a=>'<div class="mini-item" onclick="openActividadDetail('+a.id+')"><div class="mini-item-main"><span class="mini-item-title">'+escHtml(a.titulo)+'</span><span class="mini-item-sub">'+escHtml((a.comercial_nombre||'').trim())+' · '+fmt.date(a.fecha_actividad)+'</span></div><span class="tipo-chip">'+a.tipo+'</span></div>').join('');

    const total = stats.incidencias_abiertas||1;
    const prioData = [{key:'critica',label:'Crítica'},{key:'alta',label:'Alta'},{key:'media',label:'Media'},{key:'baja',label:'Baja'}];
    document.getElementById('prioridad-bars').innerHTML = prioData.map(p=>{
      const count = (stats.incidencias_por_prioridad&&stats.incidencias_por_prioridad[p.key])||0;
      const pct = Math.round((count/total)*100);
      return '<div class="prio-bar-item prio-'+p.key+'"><div class="prio-bar-label"><span style="color:var(--text2)">'+p.label+'</span><span style="color:var(--text)">'+count+'</span></div><div class="prio-bar-track"><div class="prio-bar-fill" style="width:0%" data-target="'+pct+'%"></div></div></div>';
    }).join('');
    requestAnimationFrame(()=>{ document.querySelectorAll('.prio-bar-fill').forEach(el=>{ el.style.width=el.dataset.target; }); });
  } catch(e) { toast('Error dashboard: '+e.message,'error'); }
}

async function loadIncidencias() {
  const wrap = document.getElementById('table-incidencias');
  wrap.innerHTML = '<div class="loading-pulse"></div>';
  let url = '/incidencias?';
  if (state.search) url += 'q='+encodeURIComponent(state.search)+'&';
  const e1 = document.getElementById('filter-inc-estado'); if(e1&&e1.value) url+='estado='+e1.value+'&';
  const e2 = document.getElementById('filter-inc-prioridad'); if(e2&&e2.value) url+='prioridad='+e2.value+'&';
  const e3 = document.getElementById('filter-inc-negocio'); if(e3&&e3.value) url+='negocio_id='+e3.value+'&';
  try {
    const data = await api.get(url);
    if (!data.length) { wrap.innerHTML = emptyState('Sin incidencias'); return; }
    wrap.innerHTML = '<table><thead><tr><th>#</th><th>Título</th><th>Negocio</th><th>Prioridad</th><th>Estado</th><th>Categoría</th><th>Fecha</th><th></th></tr></thead><tbody>'+
      data.map(i=>'<tr onclick="openIncidenciaDetail('+i.id+')"><td class="mono">#'+i.id+'</td><td><div class="td-main">'+escHtml(i.titulo)+'</div>'+(i.asignado_a?'<div class="td-sub">→ '+escHtml(i.asignado_a)+'</div>':'')+'</td><td><span style="cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openNegocioDetail('+i.negocio_id+')">'+escHtml(i.negocio_nombre)+'</span></td><td>'+fmt.badge(i.prioridad)+'</td><td>'+fmt.badge(i.estado)+'</td><td class="mono">'+(i.categoria||'—')+'</td><td class="mono">'+fmt.date(i.creado_en)+'</td><td><div class="row-actions" onclick="event.stopPropagation()"><button class="row-action-btn" onclick="openIncidenciaForm('+i.id+')">editar</button><button class="row-action-btn del" onclick="deleteIncidencia('+i.id+')">×</button></div></td></tr>').join('')+
      '</tbody></table>';
  } catch(e) { wrap.innerHTML = emptyState('Error: '+e.message); }
}

async function loadActividades() {
  const wrap = document.getElementById('table-actividades');
  wrap.innerHTML = '<div class="loading-pulse"></div>';
  let url = '/actividades?';
  if (state.search) url += 'q='+encodeURIComponent(state.search)+'&';
  const e1 = document.getElementById('filter-act-estado'); if(e1&&e1.value) url+='estado='+e1.value+'&';
  const e2 = document.getElementById('filter-act-tipo'); if(e2&&e2.value) url+='tipo='+e2.value+'&';
  const e3 = document.getElementById('filter-act-comercial'); if(e3&&e3.value) url+='comercial_id='+e3.value+'&';
  try {
    const data = await api.get(url);
    if (!data.length) { wrap.innerHTML = emptyState('Sin actividades'); return; }
    wrap.innerHTML = '<table><thead><tr><th>#</th><th>Título</th><th>Tipo</th><th>Comercial</th><th>Negocio</th><th>Estado</th><th>Fecha</th><th>Dur.</th><th></th></tr></thead><tbody>'+
      data.map(a=>{
        const neg = a.negocio_nombre?'<span style="cursor:pointer;color:var(--info)" onclick="event.stopPropagation();openNegocioDetail('+a.negocio_id+')">'+escHtml(a.negocio_nombre)+'</span>':'—';
        return '<tr onclick="openActividadDetail('+a.id+')"><td class="mono">#'+a.id+'</td><td><div class="td-main">'+escHtml(a.titulo)+'</div>'+(a.resultado?'<div class="td-sub">'+escHtml(a.resultado)+'</div>':'')+'</td><td><span class="tipo-chip">'+a.tipo+'</span></td><td><span style="cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openComercialDetail('+a.comercial_id+')">'+escHtml((a.comercial_nombre||'').trim())+'</span></td><td>'+neg+'</td><td>'+fmt.badge(a.estado)+'</td><td class="mono">'+fmt.date(a.fecha_actividad)+'</td><td class="mono">'+fmt.dur(a.duracion_min)+'</td><td><div class="row-actions" onclick="event.stopPropagation()"><button class="row-action-btn" onclick="openActividadForm('+a.id+')">editar</button><button class="row-action-btn del" onclick="deleteActividad('+a.id+')">×</button></div></td></tr>';
      }).join('')+'</tbody></table>';
  } catch(e) { wrap.innerHTML = emptyState('Error: '+e.message); }
}

async function loadNegocios() {
  const wrap = document.getElementById('grid-negocios');
  wrap.innerHTML = '<div class="loading-pulse"></div>';
  let url = '/negocios?';
  if (state.search) url += 'q='+encodeURIComponent(state.search)+'&';
  const e1 = document.getElementById('filter-neg-sector'); if(e1&&e1.value) url+='sector='+encodeURIComponent(e1.value)+'&';
  try {
    const data = await api.get(url);
    state.negocios = data;
    if (!data.length) { wrap.innerHTML = emptyState('Sin negocios'); return; }
    wrap.innerHTML = data.map(n=>'<div class="card" onclick="openNegocioDetail('+n.id+')"><div class="card-header"><div class="card-avatar">'+fmt.avatar(n.nombre)+'</div><div style="flex:1;min-width:0"><div class="card-title">'+escHtml(n.nombre)+'</div><span class="card-sub">'+(n.sector||'—')+'</span></div>'+(n.incidencias_abiertas>0?'<span class="badge badge-alta">'+n.incidencias_abiertas+' inc</span>':'')+'</div><div class="card-meta">'+(n.telefono?'<div class="card-meta-row">📞 '+escHtml(n.telefono)+'</div>':'')+(n.email?'<div class="card-meta-row">✉ '+escHtml(n.email)+'</div>':'')+(n.direccion?'<div class="card-meta-row">📍 '+escHtml(n.direccion)+'</div>':'')+'</div><div class="card-stats"><div class="card-stat"><span class="card-stat-num">'+(n.total_incidencias||0)+'</span><span class="card-stat-label">Incidencias</span></div><div class="card-stat"><span class="card-stat-num" style="color:'+(n.incidencias_abiertas>0?'var(--warn)':'var(--success)')+'">'+(n.incidencias_abiertas||0)+'</span><span class="card-stat-label">Abiertas</span></div></div></div>').join('');
  } catch(e) { wrap.innerHTML = emptyState('Error: '+e.message); }
}

async function loadComerciales() {
  const wrap = document.getElementById('grid-comerciales');
  wrap.innerHTML = '<div class="loading-pulse"></div>';
  let url = '/comerciales?';
  if (state.search) url += 'q='+encodeURIComponent(state.search)+'&';
  const e1 = document.getElementById('filter-com-zona'); if(e1&&e1.value) url+='zona='+encodeURIComponent(e1.value)+'&';
  try {
    const data = await api.get(url);
    state.comerciales = data;
    if (!data.length) { wrap.innerHTML = emptyState('Sin comerciales'); return; }
    wrap.innerHTML = data.map(c=>'<div class="card" onclick="openComercialDetail('+c.id+')"><div class="card-header"><div class="card-avatar">'+fmt.avatar(c.nombre+' '+(c.apellido||''))+'</div><div style="flex:1;min-width:0"><div class="card-title">'+escHtml(c.nombre)+' '+escHtml(c.apellido||'')+'</div><span class="card-sub">Zona: '+(c.zona||'—')+'</span></div>'+(c.activo?'<span class="badge badge-resuelta">activo</span>':'<span class="badge badge-cerrada">inactivo</span>')+'</div><div class="card-meta">'+(c.email?'<div class="card-meta-row">✉ '+escHtml(c.email)+'</div>':'')+(c.telefono?'<div class="card-meta-row">📞 '+escHtml(c.telefono)+'</div>':'')+'</div><div class="card-stats"><div class="card-stat"><span class="card-stat-num">'+(c.total_actividades||0)+'</span><span class="card-stat-label">Actividades</span></div><div class="card-stat"><span class="card-stat-num" style="color:'+(c.actividades_pendientes>0?'var(--warn)':'var(--success)')+'">'+(c.actividades_pendientes||0)+'</span><span class="card-stat-label">Pendientes</span></div></div></div>').join('');
  } catch(e) { wrap.innerHTML = emptyState('Error: '+e.message); }
}

async function openIncidenciaDetail(id) {
  try {
    const i = await api.get('/incidencias/'+id);
    modal.open('Incidencia #'+i.id,
      '<div class="detail-section"><div class="detail-section-title">Información</div><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-key">Título</span><span class="detail-val">'+escHtml(i.titulo)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Negocio</span><span class="detail-val" style="color:var(--accent);cursor:pointer" onclick="modal.close();openNegocioDetail('+i.negocio_id+')">'+escHtml(i.negocio_nombre)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Prioridad</span><span class="detail-val">'+fmt.badge(i.prioridad)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Estado</span><span class="detail-val">'+fmt.badge(i.estado)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Categoría</span><span class="detail-val">'+(i.categoria||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Asignado a</span><span class="detail-val">'+(i.asignado_a||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Fecha límite</span><span class="detail-val">'+fmt.date(i.fecha_limite)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Creado</span><span class="detail-val">'+fmt.datetime(i.creado_en)+'</span></div>'+
      '</div></div>'+
      (i.descripcion?'<div class="detail-section"><div class="detail-section-title">Descripción</div><p style="font-size:13px;color:var(--text2);line-height:1.6">'+escHtml(i.descripcion)+'</p></div>':'')+
      (i.resolucion?'<div class="detail-section"><div class="detail-section-title">Resolución</div><p style="font-size:13px;color:var(--success);line-height:1.6">'+escHtml(i.resolucion)+'</p></div>':''),
      '<button class="btn-ghost" onclick="modal.close()">Cerrar</button><button class="btn-ghost" onclick="openIncidenciaForm('+id+')">Editar</button><button class="btn-danger" onclick="deleteIncidencia('+id+')">Eliminar</button>'
    );
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function openNegocioDetail(id) {
  try {
    const [n, incs] = await Promise.all([api.get('/negocios/'+id), api.get('/negocios/'+id+'/incidencias')]);
    const incHtml = incs.length
      ? '<div class="inc-sub-list">'+incs.map(i=>'<div class="inc-sub-item prio-'+i.prioridad+'" onclick="modal.close();openIncidenciaDetail('+i.id+')"><div class="inc-sub-title">'+escHtml(i.titulo)+'</div>'+fmt.badge(i.prioridad)+' '+fmt.badge(i.estado)+'<span class="inc-sub-fecha">'+fmt.date(i.creado_en)+'</span></div>').join('')+'</div>'
      : emptyState('Sin incidencias');
    modal.open(n.nombre,
      '<div class="detail-section"><div class="detail-section-title">Datos</div><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-key">Sector</span><span class="detail-val">'+(n.sector||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Teléfono</span><span class="detail-val">'+(n.telefono||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Email</span><span class="detail-val">'+(n.email||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Dirección</span><span class="detail-val">'+(n.direccion||'—')+'</span></div>'+
      '</div></div>'+(n.notas?'<div class="detail-section"><div class="detail-section-title">Notas</div><p style="font-size:13px;color:var(--text2)">'+escHtml(n.notas)+'</p></div>':'')+
      '<div class="detail-section"><div class="detail-section-title">Incidencias ('+incs.length+')</div>'+incHtml+'</div>',
      '<button class="btn-ghost" onclick="modal.close()">Cerrar</button><button class="btn-ghost" onclick="openNegocioForm('+id+')">Editar</button><button class="btn-primary" onclick="modal.close();openIncidenciaForm(null,'+id+')">+ Nueva incidencia</button>'
    );
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function openComercialDetail(id) {
  try {
    const [c, acts] = await Promise.all([api.get('/comerciales/'+id), api.get('/comerciales/'+id+'/actividades')]);
    const actHtml = acts.length
      ? '<div class="act-sub-list">'+acts.map(a=>'<div class="act-sub-item" onclick="modal.close();openActividadDetail('+a.id+')"><div class="act-tipo-icon">'+fmt.tipoIcon(a.tipo)+'</div><div class="act-sub-title">'+escHtml(a.titulo)+'</div>'+fmt.badge(a.estado)+'<span class="inc-sub-fecha">'+fmt.date(a.fecha_actividad)+'</span></div>').join('')+'</div>'
      : emptyState('Sin actividades');
    modal.open(c.nombre+' '+(c.apellido||''),
      '<div class="detail-section"><div class="detail-section-title">Datos</div><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-key">Zona</span><span class="detail-val">'+(c.zona||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Estado</span><span class="detail-val">'+(c.activo?'<span class="badge badge-resuelta">Activo</span>':'<span class="badge badge-cerrada">Inactivo</span>')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Email</span><span class="detail-val">'+(c.email||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Teléfono</span><span class="detail-val">'+(c.telefono||'—')+'</span></div>'+
      '</div></div><div class="detail-section"><div class="detail-section-title">Actividades ('+acts.length+')</div>'+actHtml+'</div>',
      '<button class="btn-ghost" onclick="modal.close()">Cerrar</button><button class="btn-ghost" onclick="openComercialForm('+id+')">Editar</button><button class="btn-primary" onclick="modal.close();openActividadForm(null,'+id+')">+ Nueva actividad</button>'
    );
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function openActividadDetail(id) {
  try {
    const a = await api.get('/actividades/'+id);
    modal.open('Actividad #'+a.id,
      '<div class="detail-section"><div class="detail-section-title">Información</div><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-key">Título</span><span class="detail-val">'+escHtml(a.titulo)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Tipo</span><span class="detail-val"><span class="tipo-chip">'+a.tipo+'</span></span></div>'+
      '<div class="detail-item"><span class="detail-key">Comercial</span><span class="detail-val" style="color:var(--accent);cursor:pointer" onclick="modal.close();openComercialDetail('+a.comercial_id+')">'+escHtml((a.comercial_nombre||'').trim())+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Negocio</span><span class="detail-val">'+(a.negocio_nombre?'<span style="color:var(--info);cursor:pointer" onclick="modal.close();openNegocioDetail('+a.negocio_id+')">'+escHtml(a.negocio_nombre)+'</span>':'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Estado</span><span class="detail-val">'+fmt.badge(a.estado)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Fecha</span><span class="detail-val">'+fmt.date(a.fecha_actividad)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Duración</span><span class="detail-val">'+fmt.dur(a.duracion_min)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Registrado</span><span class="detail-val">'+fmt.datetime(a.creado_en)+'</span></div>'+
      '</div></div>'+
      (a.descripcion?'<div class="detail-section"><div class="detail-section-title">Descripción</div><p style="font-size:13px;color:var(--text2);line-height:1.6">'+escHtml(a.descripcion)+'</p></div>':'')+
      (a.resultado?'<div class="detail-section"><div class="detail-section-title">Resultado</div><p style="font-size:13px;color:var(--success);line-height:1.6">'+escHtml(a.resultado)+'</p></div>':''),
      '<button class="btn-ghost" onclick="modal.close()">Cerrar</button><button class="btn-ghost" onclick="openActividadForm('+id+')">Editar</button><button class="btn-danger" onclick="deleteActividad('+id+')">Eliminar</button>'
    );
  } catch(e) { toast('Error: '+e.message,'error'); }
}

function selOpts(arr, valFn, labelFn, selectedVal) {
  return arr.map(x=>'<option value="'+valFn(x)+'"'+(valFn(x)==selectedVal?' selected':'')+'>'+labelFn(x)+'</option>').join('');
}

async function openIncidenciaForm(id, negocioIdPre) {
  id = id||null; negocioIdPre = negocioIdPre||null;
  let inc = {};
  if (id) { try { inc = await api.get('/incidencias/'+id); } catch(e) { toast('Error','error'); return; } }
  const negOpts = selOpts(state.negocios, n=>n.id, n=>escHtml(n.nombre), inc.negocio_id||negocioIdPre);
  modal.open(id?'Editar incidencia':'Nueva incidencia',
    '<div class="form-grid">'+
    '<div class="form-group full"><label>Negocio *</label><select id="f-inc-negocio"><option value="">Seleccionar...</option>'+negOpts+'</select></div>'+
    '<div class="form-group full"><label>Título *</label><input type="text" id="f-inc-titulo" value="'+escAttr(inc.titulo||'')+'" placeholder="Descripción breve..."></div>'+
    '<div class="form-group"><label>Prioridad</label><select id="f-inc-prioridad">'+['baja','media','alta','critica'].map(p=>'<option value="'+p+'"'+(inc.prioridad===p?' selected':'')+'>'+p.charAt(0).toUpperCase()+p.slice(1)+'</option>').join('')+'</select></div>'+
    '<div class="form-group"><label>Estado</label><select id="f-inc-estado">'+['abierta','en_progreso','resuelta','cerrada'].map(s=>'<option value="'+s+'"'+(inc.estado===s?' selected':'')+'>'+s.replace('_',' ')+'</option>').join('')+'</select></div>'+
    '<div class="form-group"><label>Categoría</label><input type="text" id="f-inc-categoria" value="'+escAttr(inc.categoria||'')+'" placeholder="IT, Facturación..."></div>'+
    '<div class="form-group"><label>Asignado a</label><input type="text" id="f-inc-asignado" value="'+escAttr(inc.asignado_a||'')+'"></div>'+
    '<div class="form-group"><label>Fecha límite</label><input type="date" id="f-inc-limite" value="'+(inc.fecha_limite||'')+'"></div>'+
    '<div class="form-group full"><label>Descripción</label><textarea id="f-inc-desc" placeholder="Detalles...">'+escHtml(inc.descripcion||'')+'</textarea></div>'+
    '<div class="form-group full"><label>Resolución</label><textarea id="f-inc-res" placeholder="Cómo se resolvió...">'+escHtml(inc.resolucion||'')+'</textarea></div>'+
    '</div>',
    '<button class="btn-ghost" onclick="modal.close()">Cancelar</button><button class="btn-primary" onclick="saveIncidencia('+(id||'null')+')">Guardar</button>'
  );
}

async function saveIncidencia(id) {
  const body = {
    negocio_id: parseInt(document.getElementById('f-inc-negocio').value),
    titulo: document.getElementById('f-inc-titulo').value.trim(),
    prioridad: document.getElementById('f-inc-prioridad').value,
    estado: document.getElementById('f-inc-estado').value,
    categoria: document.getElementById('f-inc-categoria').value.trim()||null,
    asignado_a: document.getElementById('f-inc-asignado').value.trim()||null,
    fecha_limite: document.getElementById('f-inc-limite').value||null,
    descripcion: document.getElementById('f-inc-desc').value.trim()||null,
    resolucion: document.getElementById('f-inc-res').value.trim()||null,
  };
  if (!body.negocio_id||!body.titulo) { toast('Negocio y título son obligatorios','error'); return; }
  try {
    if (id&&id!=='null') await api.put('/incidencias/'+id, body); else await api.post('/incidencias', body);
    modal.close(); toast(id&&id!=='null'?'Incidencia actualizada':'Incidencia creada','success'); loadView(state.view);
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function deleteIncidencia(id) {
  if (!confirm('¿Eliminar esta incidencia?')) return;
  try { await api.del('/incidencias/'+id); modal.close(); toast('Incidencia eliminada','info'); loadView(state.view); }
  catch(e) { toast('Error: '+e.message,'error'); }
}

async function openActividadForm(id, comercialIdPre) {
  id = id||null; comercialIdPre = comercialIdPre||null;
  let act = {};
  if (id) { try { act = await api.get('/actividades/'+id); } catch(e) { toast('Error','error'); return; } }
  const cOpts = selOpts(state.comerciales, c=>c.id, c=>escHtml(c.nombre+' '+(c.apellido||'')), act.comercial_id||comercialIdPre);
  const nOpts = '<option value="">Sin negocio</option>'+selOpts(state.negocios, n=>n.id, n=>escHtml(n.nombre), act.negocio_id);
  const tipos = ['visita','llamada','email','reunion','demo','propuesta','cierre','otro'];
  modal.open(id?'Editar actividad':'Nueva actividad',
    '<div class="form-grid">'+
    '<div class="form-group"><label>Comercial *</label><select id="f-act-com"><option value="">Seleccionar...</option>'+cOpts+'</select></div>'+
    '<div class="form-group"><label>Negocio</label><select id="f-act-neg">'+nOpts+'</select></div>'+
    '<div class="form-group full"><label>Título *</label><input type="text" id="f-act-titulo" value="'+escAttr(act.titulo||'')+'" placeholder="Nombre de la actividad..."></div>'+
    '<div class="form-group"><label>Tipo *</label><select id="f-act-tipo">'+tipos.map(t=>'<option value="'+t+'"'+(act.tipo===t?' selected':'')+'>'+t.charAt(0).toUpperCase()+t.slice(1)+'</option>').join('')+'</select></div>'+
    '<div class="form-group"><label>Estado</label><select id="f-act-estado">'+['pendiente','completada','cancelada'].map(s=>'<option value="'+s+'"'+(act.estado===s?' selected':'')+'>'+s.charAt(0).toUpperCase()+s.slice(1)+'</option>').join('')+'</select></div>'+
    '<div class="form-group"><label>Fecha *</label><input type="date" id="f-act-fecha" value="'+(act.fecha_actividad||new Date().toISOString().slice(0,10))+'"></div>'+
    '<div class="form-group"><label>Duración (min)</label><input type="number" id="f-act-dur" value="'+(act.duracion_min||0)+'" min="0"></div>'+
    '<div class="form-group full"><label>Descripción</label><textarea id="f-act-desc" placeholder="Detalles...">'+escHtml(act.descripcion||'')+'</textarea></div>'+
    '<div class="form-group full"><label>Resultado</label><textarea id="f-act-res" placeholder="Resultado obtenido...">'+escHtml(act.resultado||'')+'</textarea></div>'+
    '</div>',
    '<button class="btn-ghost" onclick="modal.close()">Cancelar</button><button class="btn-primary" onclick="saveActividad('+(id||'null')+')">Guardar</button>'
  );
}

async function saveActividad(id) {
  const body = {
    comercial_id: parseInt(document.getElementById('f-act-com').value),
    negocio_id: parseInt(document.getElementById('f-act-neg').value)||null,
    tipo: document.getElementById('f-act-tipo').value,
    titulo: document.getElementById('f-act-titulo').value.trim(),
    estado: document.getElementById('f-act-estado').value,
    fecha_actividad: document.getElementById('f-act-fecha').value,
    duracion_min: parseInt(document.getElementById('f-act-dur').value)||0,
    descripcion: document.getElementById('f-act-desc').value.trim()||null,
    resultado: document.getElementById('f-act-res').value.trim()||null,
  };
  if (!body.comercial_id||!body.titulo||!body.fecha_actividad) { toast('Comercial, título y fecha son obligatorios','error'); return; }
  try {
    if (id&&id!=='null') await api.put('/actividades/'+id, body); else await api.post('/actividades', body);
    modal.close(); toast(id&&id!=='null'?'Actividad actualizada':'Actividad creada','success'); loadView(state.view);
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function deleteActividad(id) {
  if (!confirm('¿Eliminar esta actividad?')) return;
  try { await api.del('/actividades/'+id); modal.close(); toast('Actividad eliminada','info'); loadView(state.view); }
  catch(e) { toast('Error: '+e.message,'error'); }
}

async function openNegocioForm(id) {
  id = id||null;
  let n = {};
  if (id) { try { n = await api.get('/negocios/'+id); } catch(e) { toast('Error','error'); return; } }
  modal.open(id?'Editar negocio':'Nuevo negocio',
    '<div class="form-grid">'+
    '<div class="form-group full"><label>Nombre *</label><input type="text" id="f-neg-nom" value="'+escAttr(n.nombre||'')+'"></div>'+
    '<div class="form-group"><label>Sector</label><input type="text" id="f-neg-sec" value="'+escAttr(n.sector||'')+'" placeholder="Retail, Salud..."></div>'+
    '<div class="form-group"><label>Teléfono</label><input type="tel" id="f-neg-tel" value="'+escAttr(n.telefono||'')+'"></div>'+
    '<div class="form-group"><label>Email</label><input type="email" id="f-neg-email" value="'+escAttr(n.email||'')+'"></div>'+
    '<div class="form-group full"><label>Dirección</label><input type="text" id="f-neg-dir" value="'+escAttr(n.direccion||'')+'"></div>'+
    '<div class="form-group full"><label>Notas</label><textarea id="f-neg-notas">'+escHtml(n.notas||'')+'</textarea></div>'+
    '</div>',
    '<button class="btn-ghost" onclick="modal.close()">Cancelar</button>'+(id?'<button class="btn-danger" onclick="deleteNegocio('+id+')">Eliminar</button>':'')+
    '<button class="btn-primary" onclick="saveNegocio('+(id||'null')+')">Guardar</button>'
  );
}

async function saveNegocio(id) {
  const body = {
    nombre: document.getElementById('f-neg-nom').value.trim(),
    sector: document.getElementById('f-neg-sec').value.trim()||null,
    telefono: document.getElementById('f-neg-tel').value.trim()||null,
    email: document.getElementById('f-neg-email').value.trim()||null,
    direccion: document.getElementById('f-neg-dir').value.trim()||null,
    notas: document.getElementById('f-neg-notas').value.trim()||null,
  };
  if (!body.nombre) { toast('El nombre es obligatorio','error'); return; }
  try {
    if (id&&id!=='null') await api.put('/negocios/'+id, body); else await api.post('/negocios', body);
    modal.close(); toast(id&&id!=='null'?'Negocio actualizado':'Negocio creado','success');
    await refreshLists(); loadView(state.view);
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function deleteNegocio(id) {
  if (!confirm('¿Eliminar este negocio y todas sus incidencias?')) return;
  try { await api.del('/negocios/'+id); modal.close(); toast('Negocio eliminado','info'); await refreshLists(); loadView(state.view); }
  catch(e) { toast('Error: '+e.message,'error'); }
}

async function openComercialForm(id) {
  id = id||null;
  let c = {};
  if (id) { try { c = await api.get('/comerciales/'+id); } catch(e) { toast('Error','error'); return; } }
  modal.open(id?'Editar comercial':'Nuevo comercial',
    '<div class="form-grid">'+
    '<div class="form-group"><label>Nombre *</label><input type="text" id="f-com-nom" value="'+escAttr(c.nombre||'')+'"></div>'+
    '<div class="form-group"><label>Apellido</label><input type="text" id="f-com-ape" value="'+escAttr(c.apellido||'')+'"></div>'+
    '<div class="form-group"><label>Email</label><input type="email" id="f-com-email" value="'+escAttr(c.email||'')+'"></div>'+
    '<div class="form-group"><label>Teléfono</label><input type="tel" id="f-com-tel" value="'+escAttr(c.telefono||'')+'"></div>'+
    '<div class="form-group"><label>Zona</label><input type="text" id="f-com-zona" value="'+escAttr(c.zona||'')+'" placeholder="Norte, Sur..."></div>'+
    '<div class="form-group"><label>Estado</label><select id="f-com-activo"><option value="1"'+(c.activo!=0?' selected':'')+'>Activo</option><option value="0"'+(c.activo==0?' selected':'')+'>Inactivo</option></select></div>'+
    '</div>',
    '<button class="btn-ghost" onclick="modal.close()">Cancelar</button>'+(id?'<button class="btn-danger" onclick="deleteComercial('+id+')">Eliminar</button>':'')+
    '<button class="btn-primary" onclick="saveComercial('+(id||'null')+')">Guardar</button>'
  );
}

async function saveComercial(id) {
  const body = {
    nombre: document.getElementById('f-com-nom').value.trim(),
    apellido: document.getElementById('f-com-ape').value.trim()||null,
    email: document.getElementById('f-com-email').value.trim()||null,
    telefono: document.getElementById('f-com-tel').value.trim()||null,
    zona: document.getElementById('f-com-zona').value.trim()||null,
    activo: parseInt(document.getElementById('f-com-activo').value),
  };
  if (!body.nombre) { toast('El nombre es obligatorio','error'); return; }
  try {
    if (id&&id!=='null') await api.put('/comerciales/'+id, body); else await api.post('/comerciales', body);
    modal.close(); toast(id&&id!=='null'?'Comercial actualizado':'Comercial creado','success');
    await refreshLists(); loadView(state.view);
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function deleteComercial(id) {
  if (!confirm('¿Eliminar este comercial?')) return;
  try { await api.del('/comerciales/'+id); modal.close(); toast('Comercial eliminado','info'); await refreshLists(); loadView(state.view); }
  catch(e) { toast('Error: '+e.message,'error'); }
}

function handleNuevo() {
  const map = { incidencias:()=>openIncidenciaForm(), actividades:()=>openActividadForm(), negocios:()=>openNegocioForm(), comerciales:()=>openComercialForm(), dashboard:()=>openIncidenciaForm() };
  (map[state.view]||map.dashboard)();
}

async function refreshLists() {
  try {
    const [negs, coms] = await Promise.all([api.get('/negocios'), api.get('/comerciales')]);
    state.negocios = negs; state.comerciales = coms;
    const fn = document.getElementById('filter-inc-negocio');
    if (fn) { const cur=fn.value; fn.innerHTML='<option value="">Todos los negocios</option>'+negs.map(n=>'<option value="'+n.id+'">'+escHtml(n.nombre)+'</option>').join(''); fn.value=cur; }
    const fc = document.getElementById('filter-act-comercial');
    if (fc) { const cur=fc.value; fc.innerHTML='<option value="">Todos los comerciales</option>'+coms.map(c=>'<option value="'+c.id+'">'+escHtml(c.nombre+' '+(c.apellido||''))+'</option>').join(''); fc.value=cur; }
  } catch(e) { console.warn('refreshLists',e); }
  try {
    const secs = await api.get('/sectores');
    const fs = document.getElementById('filter-neg-sector');
    if (fs) { const cur=fs.value; fs.innerHTML='<option value="">Todos los sectores</option>'+secs.map(s=>'<option value="'+s+'">'+s+'</option>').join(''); fs.value=cur; }
  } catch(_){}
  try {
    const zonas = await api.get('/zonas');
    const fz = document.getElementById('filter-com-zona');
    if (fz) { const cur=fz.value; fz.innerHTML='<option value="">Todas las zonas</option>'+zonas.map(z=>'<option value="'+z+'">'+z+'</option>').join(''); fz.value=cur; }
  } catch(_){}
}

let searchTimer;
document.getElementById('global-search').addEventListener('input', function(){
  state.search = this.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>{ if(state.view!=='dashboard') loadView(state.view); }, 350);
});

document.getElementById('sidebar-toggle').onclick = ()=>{ document.getElementById('sidebar').classList.toggle('collapsed'); };

['filter-inc-estado','filter-inc-prioridad','filter-inc-negocio'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('change',()=>loadIncidencias()); });
['filter-act-estado','filter-act-tipo','filter-act-comercial'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('change',()=>loadActividades()); });
const _fns=document.getElementById('filter-neg-sector'); if(_fns) _fns.addEventListener('change',()=>loadNegocios());
const _fcz=document.getElementById('filter-com-zona'); if(_fcz) _fcz.addEventListener('change',()=>loadComerciales());

// ══════════════════════════════════════════════════════════════════════════
//  ADMINISTRACIÓN DE USUARIOS
// ══════════════════════════════════════════════════════════════════════════

async function loadAdministracion() {
  const tbody = document.getElementById('tbody-usuarios');
  
  // Show skeleton loading
  tbody.innerHTML = '<tr><td colspan="7" style="padding:0">'+showSkeletonTable(5)+'</td></tr>';
  
  try {
    const usuarios = await api.get('/comerciales');
    
    if (!usuarios || usuarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px">'+emptyState('No hay usuarios creados', 'Crea el primer usuario para comenzar', 'Crear Usuario', 'openUsuarioForm(null)')+'</td></tr>';
      return;
    }
    
    tbody.innerHTML = usuarios.map(u => `
      <tr onclick="openUsuarioDetail(${u.id})">
        <td class="td-main">${escHtml(u.username)}</td>
        <td>${escHtml(u.nombre)} ${escHtml(u.apellido||'')}</td>
        <td class="mono">${escHtml(u.email||'—')}</td>
        <td><span class="badge badge-${u.rol}">${escHtml(u.rol)}</span></td>
        <td class="mono">${escHtml(u.subgrupo||'—')}</td>
        <td>${u.activo ? '<span style="color:var(--success)">Activo</span>' : '<span style="color:var(--text3)">Inactivo</span>'}</td>
        <td>
          <button class="btn-icon" onclick="event.stopPropagation(); openUsuarioForm(${u.id})" title="Editar">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--error)">Error al cargar usuarios: '+escHtml(e.message)+'</td></tr>';
    toast('Error al cargar usuarios: '+e.message, 'error');
  }
}

async function openUsuarioDetail(id) {
  try {
    const u = await api.get('/comerciales/'+id);
    modal.open('Usuario: '+u.username,
      '<div class="detail-section">'+
      '<div class="detail-grid">'+
      '<div><span class="detail-key">Username</span><span class="detail-val">'+escHtml(u.username)+'</span></div>'+
      '<div><span class="detail-key">Rol</span><span class="detail-val">'+fmt.badge(u.rol)+'</span></div>'+
      '<div><span class="detail-key">Nombre</span><span class="detail-val">'+escHtml(u.nombre)+'</span></div>'+
      '<div><span class="detail-key">Apellido</span><span class="detail-val">'+escHtml(u.apellido||'—')+'</span></div>'+
      '<div><span class="detail-key">Email</span><span class="detail-val">'+escHtml(u.email||'—')+'</span></div>'+
      '<div><span class="detail-key">Teléfono</span><span class="detail-val">'+escHtml(u.telefono||'—')+'</span></div>'+
      '<div><span class="detail-key">Zona</span><span class="detail-val">'+escHtml(u.zona||'—')+'</span></div>'+
      '<div><span class="detail-key">Subgrupo</span><span class="detail-val">'+escHtml(u.subgrupo||'—')+'</span></div>'+
      '<div><span class="detail-key">Estado</span><span class="detail-val">'+(u.activo?'<span style="color:var(--success)">Activo</span>':'<span style="color:var(--text3)">Inactivo</span>')+'</span></div>'+
      '<div><span class="detail-key">Creado</span><span class="detail-val">'+fmt.datetime(u.creado_en)+'</span></div>'+
      '</div></div>',
      '<button class="btn-ghost" onclick="modal.close()">Cerrar</button>'+
      '<button class="btn-ghost" onclick="openUsuarioForm('+id+')">Editar</button>'+
      (u.id !== state.currentUser.id ? '<button class="btn-danger" onclick="deleteUsuario('+id+')">Eliminar</button>' : '')
    );
  } catch(e) {
    toast('Error: '+e.message, 'error');
  }
}

async function openUsuarioForm(id) {
  id = id||null;
  let u = { activo: 1 };
  if (id) {
    try { u = await api.get('/comerciales/'+id); }
    catch(e) { toast('Error','error'); return; }
  }
  
  modal.open(id?'Editar usuario':'Nuevo usuario',
    '<div class="form-grid">'+
    '<div class="form-group"><label>Username *</label><input type="text" id="f-usr-username" value="'+escAttr(u.username||'')+'" '+(id?'readonly':'')+' placeholder="username"></div>'+
    '<div class="form-group"><label>Nombre *</label><input type="text" id="f-usr-nombre" value="'+escAttr(u.nombre||'')+'"></div>'+
    '<div class="form-group"><label>Apellido</label><input type="text" id="f-usr-apellido" value="'+escAttr(u.apellido||'')+'"></div>'+
    '<div class="form-group"><label>Email *</label><input type="email" id="f-usr-email" value="'+escAttr(u.email||'')+'" required></div>'+
    '<div class="form-group"><label>Teléfono</label><input type="tel" id="f-usr-telefono" value="'+escAttr(u.telefono||'')+'"></div>'+
    '<div class="form-group"><label>Zona</label><input type="text" id="f-usr-zona" value="'+escAttr(u.zona||'')+'" placeholder="Norte, Sur..."></div>'+
    '<div class="form-group"><label>Rol *</label><select id="f-usr-rol">'+
    '<option value="comercial" '+(u.rol==='comercial'?'selected':'')+'>Comercial</option>'+
    '<option value="jefe_grupo" '+(u.rol==='jefe_grupo'?'selected':'')+'>Jefe de Grupo</option>'+
    '<option value="jefe" '+(u.rol==='jefe'?'selected':'')+'>Jefe</option>'+
    '<option value="administrador" '+(u.rol==='administrador'?'selected':'')+'>Administrador</option>'+
    '</select></div>'+
    '<div class="form-group"><label>Subgrupo</label><select id="f-usr-subgrupo">'+
    '<option value="">—</option>'+
    '<option value="A" '+(u.subgrupo==='A'?'selected':'')+'>A</option>'+
    '<option value="B" '+(u.subgrupo==='B'?'selected':'')+'>B</option>'+
    '</select></div>'+
    '<div class="form-group"><label>Estado</label><select id="f-usr-activo">'+
    '<option value="1" '+(u.activo?'selected':'')+'>Activo</option>'+
    '<option value="0" '+(!u.activo?'selected':'')+'>Inactivo</option>'+
    '</select></div>'+
    '<div class="form-group full"><label>Contraseña '+(id?'(dejar vacío para no cambiar)':'*')+'</label><input type="password" id="f-usr-password" placeholder="Mínimo 8 caracteres"></div>'+
    '</div>',
    '<button class="btn-ghost" onclick="modal.close()">Cancelar</button>'+
    (id && u.id !== state.currentUser.id ? '<button class="btn-danger" onclick="deleteUsuario('+id+')">Eliminar</button>' : '')+
    '<button class="btn-primary" onclick="saveUsuario('+(id||'null')+')">Guardar</button>'
  );
}

async function saveUsuario(id) {
  const password = document.getElementById('f-usr-password').value;
  const data = {
    username: document.getElementById('f-usr-username').value.trim(),
    nombre: document.getElementById('f-usr-nombre').value.trim(),
    apellido: document.getElementById('f-usr-apellido').value.trim(),
    email: document.getElementById('f-usr-email').value.trim(),
    telefono: document.getElementById('f-usr-telefono').value.trim(),
    zona: document.getElementById('f-usr-zona').value.trim(),
    rol: document.getElementById('f-usr-rol').value,
    subgrupo: document.getElementById('f-usr-subgrupo').value || null,
    activo: parseInt(document.getElementById('f-usr-activo').value)
  };
  
  if (!data.username || !data.nombre || !data.email) {
    toast('Completa los campos requeridos (username, nombre, email)', 'error');
    return;
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.email)) {
    toast('Email inválido', 'error');
    return;
  }
  
  try {
    if (id) {
      // Editing existing user
      if (password && password.length > 0) {
        if (password.length < 8) {
          toast('La contraseña debe tener al menos 8 caracteres', 'error');
          return;
        }
        data.password_hash = password;
      }
      await api.put('/comerciales/'+id, data);
      toast('Usuario actualizado', 'success');
    } else {
      // Creating new user
      if (!password || password.length < 8) {
        toast('La contraseña debe tener al menos 8 caracteres', 'error');
        return;
      }
      data.password_hash = password;
      await api.post('/comerciales', data);
      toast('Usuario creado', 'success');
    }
    modal.close();
    loadAdministracion();
  } catch(e) {
    toast('Error: '+e.message, 'error');
  }
}

async function deleteUsuario(id) {
  if (id === state.currentUser.id) {
    toast('No puedes eliminar tu propio usuario', 'error');
    return;
  }
  
  if (!confirm('¿Eliminar este usuario?')) return;
  
  try {
    await api.del('/comerciales/'+id);
    modal.close();
    toast('Usuario eliminado', 'info');
    loadAdministracion();
  } catch(e) {
    toast('Error: '+e.message, 'error');
  }
}

async function init() {
  modal.init();
  
  // Check if there's a password reset token in URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('token')) {
    handlePasswordReset();
    return;
  }
  
  // Check authentication first
  const isAuthenticated = await checkAuth();
  
  if (isAuthenticated) {
    // Show logout button
    document.getElementById('btn-logout').style.display = 'flex';
    
    // Show admin menu if user is administrador
    if (state.currentUser && state.currentUser.rol === 'administrador') {
      document.getElementById('nav-admin').style.display = 'flex';
    }
    
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

document.addEventListener('DOMContentLoaded', init);

window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
window.showForgotPassword = showForgotPassword;
window.sendPasswordReset = sendPasswordReset;
window.handlePasswordReset = handlePasswordReset;
window.submitPasswordReset = submitPasswordReset;
window.openIncidenciaDetail=openIncidenciaDetail; window.openNegocioDetail=openNegocioDetail;
window.openComercialDetail=openComercialDetail;   window.openActividadDetail=openActividadDetail;
window.openIncidenciaForm=openIncidenciaForm;     window.openActividadForm=openActividadForm;
window.openNegocioForm=openNegocioForm;           window.openComercialForm=openComercialForm;
window.deleteIncidencia=deleteIncidencia;         window.deleteActividad=deleteActividad;
window.deleteNegocio=deleteNegocio;               window.deleteComercial=deleteComercial;
window.saveIncidencia=saveIncidencia;             window.saveActividad=saveActividad;
window.saveNegocio=saveNegocio;                   window.saveComercial=saveComercial;
window.openUsuarioDetail=openUsuarioDetail;       window.openUsuarioForm=openUsuarioForm;
window.saveUsuario=saveUsuario;                   window.deleteUsuario=deleteUsuario;
window.modal=modal;


// ═══════════════════════════════════════════════════
//  THEME TOGGLE & VISUAL ENHANCEMENTS
// ═══════════════════════════════════════════════════

// ── Theme Toggle ───────────────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  
  // Update theme toggle icon
  const darkIcon = document.querySelector('.theme-icon-dark');
  const lightIcon = document.querySelector('.theme-icon-light');
  
  if (next === 'light') {
    darkIcon.style.display = 'none';
    lightIcon.style.display = 'block';
  } else {
    darkIcon.style.display = 'block';
    lightIcon.style.display = 'none';
  }
}

// Load saved theme on init
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.dataset.theme = savedTheme;

// Set initial icon state
if (savedTheme === 'light') {
  document.addEventListener('DOMContentLoaded', () => {
    const darkIcon = document.querySelector('.theme-icon-dark');
    const lightIcon = document.querySelector('.theme-icon-light');
    if (darkIcon && lightIcon) {
      darkIcon.style.display = 'none';
      lightIcon.style.display = 'block';
    }
  });
}

// Attach toggle event
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
});

// ── Enhanced Toast with Close Button ──────────────────────────────────────
const _originalToast = toast;
function toast(msg, type) {
  type = type || 'info';
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  
  // Add close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  };
  el.appendChild(closeBtn);
  
  c.appendChild(el);
  
  setTimeout(() => {
    if (el.parentNode) {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    }
  }, 4000);
}

// ── Skeleton Loading States ───────────────────────────────────────────────
function showSkeletonCards(count = 6) {
  return Array(count).fill(0).map(() => '<div class="card skeleton skeleton-card"></div>').join('');
}

function showSkeletonTable(rows = 5) {
  return Array(rows).fill(0).map(() => '<div class="skeleton skeleton-table-row"></div>').join('');
}

function showSkeletonKPI() {
  return '<div class="kpi-card skeleton skeleton-kpi"></div>';
}

// ── Loading Spinner ────────────────────────────────────────────────────────
function showLoading(message = 'Cargando...') {
  return `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

window.toggleTheme = toggleTheme;
window.emptyState = emptyState;
window.showLoading = showLoading;
window.showSkeletonCards = showSkeletonCards;
window.showSkeletonTable = showSkeletonTable;
window.showSkeletonKPI = showSkeletonKPI;


// ═══════════════════════════════════════════════════
//  ENHANCEMENTS — Charts, Calendar, Comments, Kanban
// ═══════════════════════════════════════════════════

// ── CHART INSTANCES (keep refs to destroy on reload) ──────────────────────
const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

const CHART_DEFAULTS = {
  color: '#e8e9f0',
  font: { family: "'DM Mono', monospace", size: 11 },
};
Chart.defaults.color = CHART_DEFAULTS.color;
Chart.defaults.font  = CHART_DEFAULTS.font;

function chartGrid() {
  return { color: 'rgba(42,43,53,.8)', borderColor: 'rgba(42,43,53,.8)' };
}

// ── DASHBOARD CHARTS ──────────────────────────────────────────────────────
function renderDashboardCharts(stats) {
  // 1) Donut — por estado
  destroyChart('estados');
  const ctxE = document.getElementById('chart-estados');
  if (ctxE) {
    const estadoData = stats.incidencias_por_estado || {};
    const labels = Object.keys(estadoData);
    const values = Object.values(estadoData);
    const colors = { abierta:'#f59e0b', en_progreso:'#4f7cff', resuelta:'#22c55e', cerrada:'#62637a' };
    charts['estados'] = new Chart(ctxE, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: labels.map(l=>colors[l]||'#62637a'), borderWidth: 0, hoverOffset: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { padding: 12, boxWidth: 10 } } },
        cutout: '65%',
      }
    });
  }

  // 2) Bar — actividades por comercial
  destroyChart('com');
  const ctxC = document.getElementById('chart-comerciales');
  if (ctxC && stats.actividades_por_comercial && stats.actividades_por_comercial.length) {
    const labels = stats.actividades_por_comercial.map(x=>x.comercial.trim());
    const values = stats.actividades_por_comercial.map(x=>x.total);
    charts['com'] = new Chart(ctxC, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Actividades', data: values, backgroundColor: '#4f7cff', borderRadius: 4, borderSkipped: false }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: chartGrid(), ticks: { maxRotation: 30 } },
          y: { grid: chartGrid(), beginAtZero: true, ticks: { stepSize: 1 } },
        }
      }
    });
  }

  // 3) Line — tendencia mensual
  destroyChart('mensual');
  const ctxM = document.getElementById('chart-mensual');
  if (ctxM && stats.incidencias_por_mes && stats.incidencias_por_mes.length) {
    const labels = stats.incidencias_por_mes.map(x=>x.mes);
    const values = stats.incidencias_por_mes.map(x=>x.total);
    charts['mensual'] = new Chart(ctxM, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Incidencias', data: values,
          borderColor: '#4f7cff', backgroundColor: 'rgba(79,124,255,.12)',
          fill: true, tension: 0.4, pointBackgroundColor: '#4f7cff', pointRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: chartGrid() },
          y: { grid: chartGrid(), beginAtZero: true, ticks: { stepSize: 1 } },
        }
      }
    });
  }
}

// Override loadDashboard to also render charts
const _origLoadDashboard = loadDashboard;
async function loadDashboard() {
  try {
    const [stats, incs, acts] = await Promise.all([
      api.get('/stats'), api.get('/incidencias?estado=abierta'), api.get('/actividades?estado=pendiente'),
    ]);
    document.getElementById('kpi-inc-abiertas').textContent = stats.incidencias_abiertas;
    document.getElementById('kpi-act-pendientes').textContent = stats.actividades_pendientes;
    document.getElementById('kpi-negocios').textContent = stats.total_negocios;
    document.getElementById('kpi-comerciales').textContent = stats.total_comerciales;
    const critica = (stats.incidencias_por_prioridad&&stats.incidencias_por_prioridad.critica)||0;
    document.getElementById('kpi-inc-critica').textContent = critica>0?'⚠ '+critica+' crítica'+(critica>1?'s':''):'';
    document.getElementById('badge-incidencias').textContent = stats.incidencias_abiertas||'';
    document.getElementById('badge-actividades').textContent = stats.actividades_pendientes||'';

    const dil = document.getElementById('dash-incidencias-list');
    dil.innerHTML = !incs.length ? emptyState('Sin incidencias abiertas') :
      incs.slice(0,6).map(i=>'<div class="mini-item" onclick="openIncidenciaDetail('+i.id+')"><div class="mini-item-main"><span class="mini-item-title">'+escHtml(i.titulo)+'</span><span class="mini-item-sub">'+escHtml(i.negocio_nombre)+' · '+fmt.date(i.creado_en)+'</span></div>'+fmt.badge(i.prioridad)+' '+fmt.badge(i.estado)+'</div>').join('');

    const dal = document.getElementById('dash-actividades-list');
    dal.innerHTML = !acts.length ? emptyState('Sin actividades pendientes') :
      acts.slice(0,6).map(a=>'<div class="mini-item" onclick="openActividadDetail('+a.id+')"><div class="mini-item-main"><span class="mini-item-title">'+escHtml(a.titulo)+'</span><span class="mini-item-sub">'+escHtml((a.comercial_nombre||'').trim())+' · '+fmt.date(a.fecha_actividad)+'</span></div><span class="tipo-chip">'+a.tipo+'</span></div>').join('');

    const total = stats.incidencias_abiertas||1;
    const prioData = [{key:'critica',label:'Crítica'},{key:'alta',label:'Alta'},{key:'media',label:'Media'},{key:'baja',label:'Baja'}];
    document.getElementById('prioridad-bars').innerHTML = prioData.map(p=>{
      const count = (stats.incidencias_por_prioridad&&stats.incidencias_por_prioridad[p.key])||0;
      const pct = Math.round((count/total)*100);
      return '<div class="prio-bar-item prio-'+p.key+'"><div class="prio-bar-label"><span style="color:var(--text2)">'+p.label+'</span><span style="color:var(--text)">'+count+'</span></div><div class="prio-bar-track"><div class="prio-bar-fill" style="width:0%" data-target="'+pct+'%"></div></div></div>';
    }).join('');
    requestAnimationFrame(()=>{ document.querySelectorAll('.prio-bar-fill').forEach(el=>{ el.style.width=el.dataset.target; }); });

    // Render Charts
    setTimeout(()=>{ renderDashboardCharts(stats); }, 100);

  } catch(e) { toast('Error dashboard: '+e.message,'error'); }
}

// ── KANBAN VIEW ───────────────────────────────────────────────────────────
let incView = 'tabla';

function setIncView(mode) {
  incView = mode;
  document.getElementById('inc-view-tabla').classList.toggle('active', mode==='tabla');
  document.getElementById('inc-view-kanban').classList.toggle('active', mode==='kanban');
  loadIncidencias();
}
window.setIncView = setIncView;

const _origLoadIncidencias = loadIncidencias;
async function loadIncidencias() {
  if (incView === 'kanban') return loadKanban();

  const wrap = document.getElementById('inc-content-area');
  wrap.innerHTML = '<div class="table-wrap"><div class="loading-pulse"></div></div>';
  let url = '/incidencias?';
  if (state.search) url += 'q='+encodeURIComponent(state.search)+'&';
  const e1 = document.getElementById('filter-inc-estado'); if(e1&&e1.value) url+='estado='+e1.value+'&';
  const e2 = document.getElementById('filter-inc-prioridad'); if(e2&&e2.value) url+='prioridad='+e2.value+'&';
  const e3 = document.getElementById('filter-inc-negocio'); if(e3&&e3.value) url+='negocio_id='+e3.value+'&';
  try {
    const data = await api.get(url);
    if (!data.length) { wrap.innerHTML = '<div class="table-wrap">'+emptyState('Sin incidencias')+'</div>'; return; }
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Título</th><th>Negocio</th><th>Prioridad</th><th>Estado</th><th>Categoría</th><th>Fecha</th><th></th></tr></thead><tbody>'+
      data.map(i=>'<tr onclick="openIncidenciaDetail('+i.id+')"><td class="mono">#'+i.id+'</td><td><div class="td-main">'+escHtml(i.titulo)+'</div>'+(i.asignado_a?'<div class="td-sub">→ '+escHtml(i.asignado_a)+'</div>':'')+'</td><td><span style="cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openNegocioDetail('+i.negocio_id+')">'+escHtml(i.negocio_nombre)+'</span></td><td>'+fmt.badge(i.prioridad)+'</td><td>'+fmt.badge(i.estado)+'</td><td class="mono">'+(i.categoria||'—')+'</td><td class="mono">'+fmt.date(i.creado_en)+'</td><td><div class="row-actions" onclick="event.stopPropagation()"><button class="row-action-btn" onclick="openIncidenciaForm('+i.id+')">editar</button><button class="row-action-btn del" onclick="deleteIncidencia('+i.id+')">×</button></div></td></tr>').join('')+
      '</tbody></table></div>';
  } catch(e) { wrap.innerHTML = '<div class="table-wrap">'+emptyState('Error: '+e.message)+'</div>'; }
}

async function loadKanban() {
  const wrap = document.getElementById('inc-content-area');
  wrap.innerHTML = '<div class="loading-pulse"></div>';
  let url = '/incidencias?';
  if (state.search) url += 'q='+encodeURIComponent(state.search)+'&';
  const e2 = document.getElementById('filter-inc-prioridad'); if(e2&&e2.value) url+='prioridad='+e2.value+'&';
  const e3 = document.getElementById('filter-inc-negocio'); if(e3&&e3.value) url+='negocio_id='+e3.value+'&';
  try {
    const data = await api.get(url);
    const cols = {
      abierta:    { label: 'Abierta',    color: 'var(--warn)',    items: [] },
      en_progreso:{ label: 'En progreso',color: 'var(--accent)',  items: [] },
      resuelta:   { label: 'Resuelta',   color: 'var(--success)', items: [] },
      cerrada:    { label: 'Cerrada',    color: 'var(--text3)',   items: [] },
    };
    data.forEach(i=>{ if (cols[i.estado]) cols[i.estado].items.push(i); });
    wrap.innerHTML = '<div class="kanban-board">'+
      Object.entries(cols).map(([key, col])=>'<div class="kanban-col">'+
        '<div class="kanban-col-head"><span class="kanban-col-title" style="color:'+col.color+'">'+col.label+'</span><span class="kanban-count">'+col.items.length+'</span></div>'+
        '<div class="kanban-col-body">'+
        (col.items.length ? col.items.map(i=>'<div class="kanban-card prio-'+i.prioridad+'" onclick="openIncidenciaDetail('+i.id+')">'+
          '<div class="kanban-card-title">'+escHtml(i.titulo)+'</div>'+
          '<div class="kanban-card-meta"><span class="kanban-card-neg">'+escHtml(i.negocio_nombre)+'</span>'+fmt.badge(i.prioridad)+'</div>'+
          '</div>').join('') : '<div style="padding:12px;font-family:var(--mono);font-size:11px;color:var(--text3);text-align:center">Vacío</div>')+
        '</div></div>').join('')+
      '</div>';
  } catch(e) { wrap.innerHTML = emptyState('Error: '+e.message); }
}

// ── CALENDAR ─────────────────────────────────────────────────────────────
let calendarInstance = null;

async function loadCalendario() {
  const el = document.getElementById('fullcalendar');
  if (!el) return;

  // Destroy previous instance
  if (calendarInstance) { calendarInstance.destroy(); calendarInstance = null; }

  try {
    const events = await api.get('/eventos');

    calendarInstance = new FullCalendar.Calendar(el, {
      initialView: 'dayGridMonth',
      locale: 'es',
      height: 580,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listWeek',
      },
      buttonText: { today: 'Hoy', month: 'Mes', week: 'Semana', list: 'Lista' },
      events: events,
      eventClick: function(info) {
        const p = info.event.extendedProps;
        if (p.type === 'incidencia') openIncidenciaDetail(p.entity_id);
        else openActividadDetail(p.entity_id);
      },
      eventMouseEnter: function(info) {
        info.el.title = info.event.title;
      },
    });
    calendarInstance.render();
  } catch(e) { toast('Error calendario: '+e.message, 'error'); }
}

// ── REPORTES ──────────────────────────────────────────────────────────────
let repChartsRendered = false;

async function loadReportes() {
  try {
    const stats = await api.get('/stats');

    // KPIs
    document.getElementById('rep-kpis').innerHTML =
      '<div class="kpi-card kpi-warn"><div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg></div><div class="kpi-data"><span class="kpi-num">'+stats.incidencias_abiertas+'</span><span class="kpi-label">Incidencias abiertas</span></div></div>'+
      '<div class="kpi-card kpi-blue"><div class="kpi-icon"><svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div><div class="kpi-data"><span class="kpi-num">'+stats.total_actividades+'</span><span class="kpi-label">Total actividades</span></div></div>'+
      '<div class="kpi-card kpi-neutral"><div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg></div><div class="kpi-data"><span class="kpi-num">'+stats.total_negocios+'</span><span class="kpi-label">Negocios</span></div></div>'+
      '<div class="kpi-card kpi-green"><div class="kpi-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="kpi-data"><span class="kpi-num">'+(stats.incidencias_vencidas||0)+'</span><span class="kpi-label">Vencidas</span></div></div>';

    setTimeout(()=>{
      // Donut estados
      destroyChart('rep-estados');
      const ctxE = document.getElementById('rep-chart-estados');
      if (ctxE) {
        const d = stats.incidencias_por_estado||{};
        const labels = Object.keys(d), values = Object.values(d);
        const clr = {abierta:'#f59e0b',en_progreso:'#4f7cff',resuelta:'#22c55e',cerrada:'#62637a'};
        charts['rep-estados'] = new Chart(ctxE, { type:'doughnut', data:{ labels, datasets:[{ data:values, backgroundColor:labels.map(l=>clr[l]||'#62637a'), borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:true, cutout:'60%', plugins:{ legend:{ position:'bottom', labels:{padding:10,boxWidth:10} } } } });
      }

      // Bar prioridad
      destroyChart('rep-prio');
      const ctxP = document.getElementById('rep-chart-prioridad');
      if (ctxP) {
        const d = stats.incidencias_por_prioridad||{};
        const order=['critica','alta','media','baja'], clr={critica:'#ef4444',alta:'#f59e0b',media:'#4f7cff',baja:'#62637a'};
        charts['rep-prio'] = new Chart(ctxP, { type:'bar', data:{ labels:order.map(k=>k.charAt(0).toUpperCase()+k.slice(1)), datasets:[{ data:order.map(k=>d[k]||0), backgroundColor:order.map(k=>clr[k]), borderRadius:4, borderSkipped:false }] }, options:{ responsive:true, maintainAspectRatio:true, plugins:{legend:{display:false}}, scales:{ x:{grid:chartGrid()}, y:{grid:chartGrid(),beginAtZero:true,ticks:{stepSize:1}} } } });
      }

      // Pie tipos actividad
      destroyChart('rep-tipos');
      const ctxT = document.getElementById('rep-chart-tipos');
      if (ctxT) {
        const d = stats.actividades_por_tipo||{};
        const labels=Object.keys(d), values=Object.values(d);
        const palette=['#4f7cff','#22c55e','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#ec4899','#62637a'];
        charts['rep-tipos'] = new Chart(ctxT, { type:'pie', data:{ labels, datasets:[{ data:values, backgroundColor:labels.map((_,i)=>palette[i%palette.length]), borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:true, plugins:{legend:{position:'bottom',labels:{padding:10,boxWidth:10}}} } });
      }

      // Bar comerciales
      destroyChart('rep-com');
      const ctxC = document.getElementById('rep-chart-comerciales');
      if (ctxC && stats.actividades_por_comercial && stats.actividades_por_comercial.length) {
        charts['rep-com'] = new Chart(ctxC, { type:'bar', data:{ labels:stats.actividades_por_comercial.map(x=>x.comercial.trim()), datasets:[{ label:'Actividades', data:stats.actividades_por_comercial.map(x=>x.total), backgroundColor:'#4f7cff', borderRadius:4, borderSkipped:false }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{grid:chartGrid()}, y:{grid:chartGrid(),beginAtZero:true,ticks:{stepSize:1}} } } });
      }

      // Line mensual
      destroyChart('rep-mensual');
      const ctxM = document.getElementById('rep-chart-mensual');
      if (ctxM && stats.incidencias_por_mes && stats.incidencias_por_mes.length) {
        charts['rep-mensual'] = new Chart(ctxM, { type:'line', data:{ labels:stats.incidencias_por_mes.map(x=>x.mes), datasets:[{ label:'Incidencias', data:stats.incidencias_por_mes.map(x=>x.total), borderColor:'#4f7cff', backgroundColor:'rgba(79,124,255,.12)', fill:true, tension:0.4, pointBackgroundColor:'#4f7cff', pointRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{grid:chartGrid()}, y:{grid:chartGrid(),beginAtZero:true,ticks:{stepSize:1}} } } });
      }
    }, 120);

  } catch(e) { toast('Error reportes: '+e.message,'error'); }
}

// ── COMMENTS in detail view ────────────────────────────────────────────────
async function loadComentarios(incId) {
  const container = document.getElementById('comentarios-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-pulse" style="height:24px;margin:4px 0"></div>';
  try {
    const data = await api.get('/incidencias/'+incId+'/comentarios');
    if (!data.length) {
      container.innerHTML = '<p style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:4px 0">Sin comentarios aún.</p>';
      return;
    }
    container.innerHTML = '<div class="comentarios-list">'+
      data.map(c=>'<div class="comentario-item">'+
        '<div class="comentario-avatar">'+fmt.avatar(c.autor)+'</div>'+
        '<div class="comentario-body">'+
        '<div class="comentario-header"><span class="comentario-autor">'+escHtml(c.autor)+'</span><span class="comentario-fecha">'+fmt.datetime(c.creado_en)+'</span></div>'+
        '<div class="comentario-text">'+escHtml(c.contenido)+'</div>'+
        '</div></div>').join('')+
      '</div>';
  } catch(e) { container.innerHTML = '<p style="color:var(--danger);font-size:12px">Error cargando comentarios</p>'; }
}

async function addComentario(incId) {
  const autorEl   = document.getElementById('cmt-autor');
  const contentEl = document.getElementById('cmt-content');
  const autor   = autorEl?.value.trim() || 'Anónimo';
  const contenido = contentEl?.value.trim();
  if (!contenido) { toast('El comentario no puede estar vacío', 'error'); return; }
  try {
    await api.post('/incidencias/'+incId+'/comentarios', { autor, contenido });
    if (contentEl) contentEl.value = '';
    toast('Comentario añadido', 'success');
    await loadComentarios(incId);
  } catch(e) { toast('Error: '+e.message, 'error'); }
}
window.addComentario = addComentario;

// Override openIncidenciaDetail to include comments
const _origOpenIncidenciaDetail = openIncidenciaDetail;
async function openIncidenciaDetail(id) {
  try {
    const i = await api.get('/incidencias/'+id);
    modal.open('Incidencia #'+i.id,
      '<div class="detail-section"><div class="detail-section-title">Información</div>' +
      '<div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-key">Título</span><span class="detail-val">'+escHtml(i.titulo)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Negocio</span><span class="detail-val" style="color:var(--accent);cursor:pointer" onclick="modal.close();openNegocioDetail('+i.negocio_id+')">'+escHtml(i.negocio_nombre)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Prioridad</span><span class="detail-val">'+fmt.badge(i.prioridad)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Estado</span><span class="detail-val">'+fmt.badge(i.estado)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Categoría</span><span class="detail-val">'+(i.categoria||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Asignado a</span><span class="detail-val">'+(i.asignado_a||'—')+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Fecha límite</span><span class="detail-val">'+fmt.date(i.fecha_limite)+'</span></div>'+
      '<div class="detail-item"><span class="detail-key">Creado</span><span class="detail-val">'+fmt.datetime(i.creado_en)+'</span></div>'+
      '</div></div>'+
      (i.descripcion?'<div class="detail-section"><div class="detail-section-title">Descripción</div><p style="font-size:13px;color:var(--text2);line-height:1.6">'+escHtml(i.descripcion)+'</p></div>':'')+
      (i.resolucion?'<div class="detail-section"><div class="detail-section-title">Resolución</div><p style="font-size:13px;color:var(--success);line-height:1.6">'+escHtml(i.resolucion)+'</p></div>':'')+
      '<div class="detail-section">'+
      '<div class="detail-section-title">Comentarios</div>'+
      '<div id="comentarios-list"></div>'+
      '<div class="comentario-form" style="margin-top:10px">'+
      '<input type="text" id="cmt-autor" placeholder="Tu nombre" style="flex:0 0 130px">'+
      '<textarea id="cmt-content" placeholder="Añadir comentario..." style="flex:1;min-height:52px;resize:none"></textarea>'+
      '<button class="btn-primary" style="align-self:flex-end" onclick="addComentario('+id+')">Enviar</button>'+
      '</div></div>',
      '<button class="btn-ghost" onclick="modal.close()">Cerrar</button>'+
      '<button class="btn-ghost" onclick="openIncidenciaForm('+id+')">Editar</button>'+
      '<button class="btn-danger" onclick="deleteIncidencia('+id+')">Eliminar</button>'
    );
    // Load comments after modal is open
    setTimeout(()=>loadComentarios(id), 50);
  } catch(e) { toast('Error: '+e.message,'error'); }
}
window.openIncidenciaDetail = openIncidenciaDetail;

// ── EXPORT CSV ────────────────────────────────────────────────────────────
function exportCSV(type) {
  const url = '/api/export/'+type;
  const a = document.createElement('a');
  a.href = url;
  a.download = type+'.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('Descargando '+type+'.csv…', 'info');
}
window.exportCSV = exportCSV;

// ── Override loadView to add new views ─────────────────────────────────────
const _origLoadView = loadView;
function loadView(view) {
  if (view === 'dashboard')   return loadDashboard();
  if (view === 'incidencias') return loadIncidencias();
  if (view === 'actividades') return loadActividades();
  if (view === 'negocios')    return loadNegocios();
  if (view === 'comerciales') return loadComerciales();
  if (view === 'calendario')  return loadCalendario();
  if (view === 'reportes')    return loadReportes();
  if (view === 'administracion') return loadAdministracion();
}

// ── Override navigate to support new views ─────────────────────────────────
const _origNavigate = navigate;
function navigate(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view===view));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id==='view-'+view));
  const titles = {dashboard:'Dashboard',incidencias:'Incidencias',actividades:'Actividades',negocios:'Negocios',comerciales:'Comerciales',calendario:'Calendario',reportes:'Reportes'};
  document.getElementById('page-title').textContent = titles[view]||view;
  loadView(view);
}

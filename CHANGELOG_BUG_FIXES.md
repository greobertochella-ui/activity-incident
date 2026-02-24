# Changelog - Bug Fixes (2026-02-22)

## Resumen
Se han corregido 3 bugs críticos que bloqueaban la funcionalidad básica del sistema:

## Bugs Corregidos

### 1. ✅ Login/Navigation - Menú admin aparece inmediatamente después del login
**Problema**: Después del login exitoso, el botón "Administración" no aparecía en el sidebar hasta refrescar la página.

**Archivos modificados**:
- `static/app.js` - Líneas ~98-122 (función `handleLogin`)

**Cambios**:
```javascript
// Agregado después de checkAuth() en handleLogin:
if (state.currentUser && state.currentUser.rol === 'administrador') {
  document.getElementById('nav-admin').style.display = 'flex';
}
```

---

### 2. ✅ Admin Table Loading - Estados de carga/vacío/error apropiados
**Problema**: La tabla de usuarios en "Administración" quedaba en "Cargando..." indefinidamente si no había usuarios o al entrar por primera vez.

**Archivos modificados**:
- `static/app.js` - Líneas ~728-760 (función `loadAdministracion`)
- `static/app.js` - Líneas ~1348-1356 (función `loadView` - segunda definición)

**Cambios**:
1. Agregado estado de carga explícito al inicio
2. Manejo de array vacío o nulo
3. Manejo de errores con mensaje apropiado
4. Agregado `if (view === 'administracion') return loadAdministracion();` en la segunda definición de loadView

---

### 3. ✅ Email Recovery - Validación SMTP + fallback a consola
**Problema**: Los emails de recuperación de contraseña no llegaban porque faltaban credenciales de Gmail SMTP.

**Archivos modificados**:
- `routes.py` - Imports (líneas ~1-20)
- `routes.py` - Nueva función `validate_smtp_config()` (después de imports)
- `routes.py` - Variables globales `SMTP_ENABLED` y `SMTP_ERROR`
- `routes.py` - Función `lifespan` actualizada (líneas ~156-175)
- `routes.py` - Función `forgot_password` completamente reescrita (líneas ~334-430)

**Archivos creados**:
- `SMTP_SETUP.md` - Documentación completa para configurar Gmail SMTP

**Cambios**:
1. Validación de configuración SMTP al inicio del servidor
2. Mensaje claro en consola si SMTP está deshabilitado
3. Fallback a consola logging si SMTP no está configurado
4. HTML emails mejorados con estilos
5. Instrucciones claras para configurar Gmail App Passwords

---

## Para hacer commit (si tienes git instalado):

```bash
git add static/app.js routes.py SMTP_SETUP.md CHANGELOG_BUG_FIXES.md

# En bash/zsh:
git commit -m "$(cat <<'EOF'
fix: corregir bugs críticos de login, administración y email recovery

- Fix: Admin menu ahora aparece inmediatamente después del login
- Fix: Tabla de usuarios muestra estados apropiados (loading/empty/error)
- Fix: Sistema de recuperación de contraseña con validación SMTP y fallback
- Add: Documentación SMTP_SETUP.md con instrucciones de Gmail
- Add: Validación de configuración SMTP al startup

Refs: Phase 1, 2, 3 del plan 2026-02-22_fix-critical-bugs
EOF
)"

# En PowerShell:
git commit -m "fix: corregir bugs críticos de login, administración y email recovery`n`n- Fix: Admin menu ahora aparece inmediatamente después del login`n- Fix: Tabla de usuarios muestra estados apropiados (loading/empty/error)`n- Fix: Sistema de recuperación de contraseña con validación SMTP y fallback`n- Add: Documentación SMTP_SETUP.md con instrucciones de Gmail`n- Add: Validación de configuración SMTP al startup`n`nRefs: Phase 1, 2, 3 del plan 2026-02-22_fix-critical-bugs"
```

## Verificación

El servidor está corriendo en `http://localhost:8000` y muestra:
```
⚠️  SMTP DESHABILITADO: SMTP no configurado. Variables faltantes o con valores placeholder: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
    Los enlaces de recuperación se mostrarán en la consola.
```

**Esto es correcto** - el sistema ahora funciona con fallback a consola. Para habilitar emails reales, sigue las instrucciones en `SMTP_SETUP.md`.

## Pruebas Sugeridas

1. **Login/Admin Menu**:
   - Hacer login con usuario administrador
   - Verificar que "Administración" aparece sin refrescar
   - Todos los botones responden correctamente

2. **Tabla Usuarios**:
   - Click en "Administración"
   - Verificar que tabla carga correctamente
   - Si no hay usuarios, debe mostrar "No hay usuarios creados"

3. **Password Recovery**:
   - Click en "¿Olvidaste tu contraseña?"
   - Ingresar email de un usuario existente
   - Revisar consola del servidor - debe mostrar el reset link
   - Copiar link y probar reset de contraseña

## Próximos Pasos (Fase 2 - Opcional)

Ver `plans/2026-02-22_21-30-00_fix-critical-bugs/plan.md` sección "Appendix: Post-Fix Analysis" para mejoras recomendadas.

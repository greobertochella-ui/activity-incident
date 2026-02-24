# Gmail SMTP Setup para Password Recovery

## Problema
Los correos de recuperación de contraseña no llegan porque Gmail requiere "App Passwords" en lugar de tu contraseña normal.

## Solución Rápida

### Paso 1: Generar App Password en Gmail
1. Ve a https://myaccount.google.com/apppasswords
2. Selecciona "Mail" como app
3. Selecciona "Other" como dispositivo → escribe "Tracker App"
4. Haz clic en "Generate"
5. Gmail te mostrará una contraseña de 16 caracteres (ej: `abcd efgh ijkl mnop`)

### Paso 2: Actualizar archivo .env
Abre el archivo `.env` y actualiza estas líneas:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com          # ← TU EMAIL REAL
SMTP_PASS=abcd efgh ijkl mnop         # ← LA APP PASSWORD (con espacios está OK)
```

### Paso 3: Reiniciar la aplicación
```bash
./start.sh
```

Deberías ver:
```
✅ SMTP configurado correctamente
```

## Verificación
1. Ve a la pantalla de login
2. Haz clic en "¿Olvidaste tu contraseña?"
3. Ingresa un email de un usuario existente
4. Revisa la bandeja de entrada (y spam)

## Fallback Mode
Si no configuras SMTP, la app funciona igual pero los enlaces se imprimen en la consola del servidor. Cópialos manualmente y envíalos al usuario.

## Troubleshooting

### "Username and Password not accepted"
- Verifica que sea App Password, no tu contraseña normal
- Asegúrate de que 2FA esté activado en tu cuenta de Gmail

### "SMTP connect() failed"
- Verifica que `SMTP_PORT=587` (no 465)
- Revisa tu firewall/antivirus

### Email no llega
- Revisa la carpeta de spam
- Verifica que el email del usuario en la base de datos sea correcto
- Revisa la consola del servidor para ver logs de envío

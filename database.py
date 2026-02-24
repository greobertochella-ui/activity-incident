import aiosqlite
import os

DB_PATH = os.environ.get("DB_PATH", "./tracker.db")


async def get_db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.executescript("""
            PRAGMA journal_mode=WAL;

            CREATE TABLE IF NOT EXISTS negocios (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre      TEXT    NOT NULL UNIQUE,
                sector      TEXT,
                telefono    TEXT,
                email       TEXT,
                direccion   TEXT,
                notas       TEXT,
                creado_en   TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS comerciales (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre          TEXT    NOT NULL,
                apellido        TEXT,
                email           TEXT,
                telefono        TEXT,
                zona            TEXT,
                activo          INTEGER DEFAULT 1,
                username        TEXT    UNIQUE NOT NULL DEFAULT '',
                password_hash   TEXT    NOT NULL DEFAULT '',
                rol             TEXT    NOT NULL DEFAULT 'comercial' CHECK(rol IN ('administrador','jefe','jefe_grupo','comercial')),
                subgrupo        TEXT    CHECK(subgrupo IN ('A','B') OR subgrupo IS NULL),
                creado_en       TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS incidencias (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id      INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
                titulo          TEXT    NOT NULL,
                descripcion     TEXT,
                prioridad       TEXT    DEFAULT 'media' CHECK(prioridad IN ('baja','media','alta','critica')),
                estado          TEXT    DEFAULT 'abierta' CHECK(estado IN ('abierta','en_progreso','resuelta','cerrada')),
                categoria       TEXT,
                asignado_a      TEXT,
                fecha_limite    TEXT,
                resolucion      TEXT,
                creado_en       TEXT    DEFAULT (datetime('now','localtime')),
                actualizado_en  TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS actividades (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                comercial_id    INTEGER NOT NULL REFERENCES comerciales(id) ON DELETE CASCADE,
                negocio_id      INTEGER REFERENCES negocios(id) ON DELETE SET NULL,
                tipo            TEXT    NOT NULL CHECK(tipo IN ('visita','llamada','email','reunion','demo','propuesta','cierre','otro')),
                titulo          TEXT    NOT NULL,
                descripcion     TEXT,
                resultado       TEXT,
                estado          TEXT    DEFAULT 'pendiente' CHECK(estado IN ('pendiente','completada','cancelada')),
                fecha_actividad TEXT    NOT NULL,
                duracion_min    INTEGER DEFAULT 0,
                creado_en       TEXT    DEFAULT (datetime('now','localtime')),
                actualizado_en  TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS comentarios (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                incidencia_id   INTEGER NOT NULL REFERENCES incidencias(id) ON DELETE CASCADE,
                autor           TEXT    NOT NULL DEFAULT 'Sistema',
                contenido       TEXT    NOT NULL,
                creado_en       TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS sesiones (
                session_id      TEXT    PRIMARY KEY,
                comercial_id    INTEGER NOT NULL REFERENCES comerciales(id) ON DELETE CASCADE,
                created_at      TEXT    DEFAULT (datetime('now','localtime')),
                expires_at      TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS password_resets (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                comercial_id    INTEGER NOT NULL REFERENCES comerciales(id) ON DELETE CASCADE,
                token           TEXT    NOT NULL UNIQUE,
                expires_at      TEXT    NOT NULL,
                used            INTEGER DEFAULT 0,
                created_at      TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_sesiones_expires ON sesiones(expires_at);
            CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
            CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);

            CREATE TRIGGER IF NOT EXISTS trg_incidencias_upd
            AFTER UPDATE ON incidencias
            BEGIN
                UPDATE incidencias SET actualizado_en = datetime('now','localtime') WHERE id = NEW.id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_actividades_upd
            AFTER UPDATE ON actividades
            BEGIN
                UPDATE actividades SET actualizado_en = datetime('now','localtime') WHERE id = NEW.id;
            END;
        """)
        await db.commit()

        # Seed data de muestra si las tablas están vacías
        row = await db.execute("SELECT COUNT(*) FROM negocios")
        count = (await row.fetchone())[0]
        if count == 0:
            await db.executescript("""
                INSERT INTO negocios (nombre, sector, telefono, email, direccion) VALUES
                ('Supermercados García', 'Retail', '612345678', 'garcia@ejemplo.es', 'Calle Mayor 12, Madrid'),
                ('Talleres Martínez', 'Automoción', '623456789', 'taller@ejemplo.es', 'Avda. Industria 45, Valencia'),
                ('Clínica Bienestar', 'Salud', '634567890', 'clinica@ejemplo.es', 'C/ Salud 8, Barcelona'),
                ('Restaurante El Olivo', 'Hostelería', '645678901', 'olivo@ejemplo.es', 'Plaza España 3, Sevilla'),
                ('Constructora Vega', 'Construcción', '656789012', 'vega@ejemplo.es', 'Polígono Norte 78, Bilbao');

                -- Password hashes: Admin2026!, Jefe2026!, JefeA2026!, JefeB2026!, Carlos2026!, Maria2026!, Ana2026!, Javier2026!
                INSERT INTO comerciales (nombre, apellido, email, telefono, zona, username, password_hash, rol, subgrupo) VALUES
                ('Admin', 'Sistema', 'admin@tracker.es', '600000000', NULL, 'admin', '$2b$12$fxMXOMjmQZChFclG.HJfhORQO1rTIWDiTdEHKb/iJjYnpPH4hQ.zG', 'administrador', NULL),
                ('Jefe', 'General', 'jefe@tracker.es', '600000001', NULL, 'jefe_general', '$2b$12$64MbKy63b80TOAIPzBq7G.08O1YQvQM/7o0lhMU8fwr2fboV2kU7m', 'jefe', NULL),
                ('Jefe', 'Subgrupo A', 'jefe.a@tracker.es', '600000002', 'Norte', 'jefe_a', '$2b$12$xYllDPZmLSMMYNvbNPBkquWima0ZyCVCNBQzLnoNWuzg.0CY8QVvi', 'jefe_grupo', 'A'),
                ('Jefe', 'Subgrupo B', 'jefe.b@tracker.es', '600000003', 'Sur', 'jefe_b', '$2b$12$6dpAUtXig.IlrAMTddVy/e6PhtkC2VHet8OMXb.7RsQ.KUhhEThqe', 'jefe_grupo', 'B'),
                ('Carlos', 'Ruiz', 'carlos@comercial.es', '611111111', 'Norte', 'carlos_ruiz', '$2b$12$TCBectvo1rNCux3xDSi8.et/YZn6k8xHstreBEgZhCPG79HZJ0tUu', 'comercial', 'A'),
                ('María', 'López', 'maria@comercial.es', '622222222', 'Sur', 'maria_lopez', '$2b$12$NBHQw5pN2hRtOmhHrYQOOusfIMRc7yRGEA/RBjQa7RCW6My1fqtje', 'comercial', 'A'),
                ('Ana', 'Gómez', 'ana@comercial.es', '644444444', 'Oeste', 'ana_gomez', '$2b$12$VZgeSaxMRj.ZsSM./k7whOlNzEyMplDSizvyN1TgRrOdG0FZXfQwu', 'comercial', 'B'),
                ('Javier', 'Pérez', 'javier@comercial.es', '633333333', 'Este', 'javier_perez', '$2b$12$7OGIb88sTtg6VE2IWss/Iek52ojd27693d.XZXLxbW2TdbxqDBITa', 'comercial', 'B');

                INSERT INTO incidencias (negocio_id, titulo, descripcion, prioridad, estado, categoria) VALUES
                (1, 'Fallo en facturación', 'El sistema no genera facturas correctamente desde el último update', 'alta', 'en_progreso', 'Facturación'),
                (1, 'Solicitud de descuento especial', 'Cliente pide revisión de tarifas por volumen', 'media', 'abierta', 'Comercial'),
                (2, 'Garantía de equipo defectuoso', 'Compresor instalado presenta ruidos anómalos', 'critica', 'abierta', 'Garantía'),
                (3, 'Acceso a portal web', 'No pueden acceder al portal de pacientes', 'alta', 'resuelta', 'IT'),
                (4, 'Retraso en entrega', 'Pedido de menaje con 2 semanas de retraso', 'media', 'cerrada', 'Logística'),
                (5, 'Presupuesto pendiente', 'Esperando aprobación de presupuesto de obra', 'baja', 'abierta', 'Comercial');

                INSERT INTO comentarios (incidencia_id, autor, contenido) VALUES
                (1, 'Carlos Ruiz', 'Se ha revisado el sistema de facturación. Parece ser un bug en la versión 3.2.'),
                (1, 'María López', 'El proveedor confirma que hay un parche disponible. Pendiente de aplicar.'),
                (2, 'Ana Gómez', 'El cliente solicita revisión para el próximo trimestre.'),
                (3, 'Javier Pérez', 'Garantía en vigor. Contactando con el fabricante.'),
                (4, 'Carlos Ruiz', 'Acceso restaurado. Error en certificado SSL caducado.');

                -- comercial_id mapping: 5=Carlos(A), 6=María(A), 7=Ana(B), 8=Javier(B)
                INSERT INTO actividades (comercial_id, negocio_id, tipo, titulo, descripcion, resultado, estado, fecha_actividad, duracion_min) VALUES
                (5, 1, 'visita', 'Visita presentación catálogo', 'Presentación del nuevo catálogo 2025', 'Interesados en línea premium', 'completada', '2026-02-10', 60),
                (5, 2, 'llamada', 'Llamada seguimiento presupuesto', 'Revisión del presupuesto enviado la semana pasada', 'Pendiente revisión interna', 'completada', '2026-02-12', 20),
                (6, 3, 'reunion', 'Reunión renovación contrato', 'Negociación condiciones para renovación anual', 'Acuerdo en principio', 'completada', '2026-02-14', 90),
                (6, 4, 'demo', 'Demo sistema de gestión', 'Demostración del nuevo módulo de reservas', 'Muy positiva', 'completada', '2026-02-15', 45),
                (8, 5, 'propuesta', 'Envío propuesta técnica', 'Propuesta detallada para proyecto de construcción', 'Enviada y confirmada', 'completada', '2026-02-18', 30),
                (7, 1, 'email', 'Email promoción especial', 'Envío de oferta por campaña de primavera', 'Respuesta positiva esperada', 'pendiente', '2026-02-22', 15),
                (8, 2, 'visita', 'Visita instalaciones nuevas', 'Ver nuevo local para ampliar servicio', 'Pendiente', 'pendiente', '2026-02-25', 120);
            """)
            await db.commit()

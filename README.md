# 📻 LuxorStereo — Hilo musical y radio corporativa

Aplicación web completa para gestionar la música de fondo y los spots
publicitarios de una cadena de supermercados, con **Supabase** (PostgreSQL +
Auth + Storage + Realtime) y **Next.js 15 (App Router) + TypeScript + Tailwind CSS**.

---

## 1. Módulos

| Ruta | Qué hace |
|---|---|
| `/login` | Acceso del equipo de operaciones (Supabase Auth). |
| `/admin` | **Panel central**: estado en línea/offline de sucursales, «ahora suena» en vivo, historial y **alertas urgentes** a una o todas las tiendas. |
| `/admin/branches` | Alta/edición/baja de sucursales (ciudad, zona horaria, activa) y copia del enlace del reproductor. |
| `/admin/media` | Subida de MP3/WAV a Supabase Storage (`audio`), duración automática, edición de metadatos y tipo (música / spot). |
| `/admin/playlists` | Crear playlists, añadir pistas del catálogo y ordenarlas. |
| `/admin/schedule` | Asignar playlists a cada sucursal con reglas: franja horaria, spot cada N canciones, spot cada M minutos y orden aleatorio. |
| `/branch?key=…` | **Reproductor de sucursal**: pantalla ligera para tablet/PC/Raspberry Pi, reproducción continua, caché local y reconexión automática. |

---

## 2. Puesta en marcha

### 2.1 Proyecto Supabase

1. Crea el proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql)
   (tablas + RLS + RPCs + bucket `audio` + publicación Realtime).
3. **Authentication → Users → Add user** → crea el usuario del panel
   (correo + contraseña). *No hay registro público a propósito*: el panel es
   un límite de confianza y sólo debe entrar personal autorizado.
4. **Project Settings → API** → copia `Project URL` y `anon public` key.

### 2.2 Variables de entorno

```powershell
Copy-Item .env.local.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 2.3 Ejecutar

```powershell
npm install
npm run dev        # http://localhost:3000
npm run build      # build de producción (compila + valida tipos)
```

### 2.4 Flujo típico

1. Entra a `/admin` con el usuario creado.
2. **Medios** → sube la música (tanda «Música») y los spots (tanda «Spot / promoción»).
3. **Playlists** → crea *Matutina suave*, *Tarde rítmica*… y añade pistas.
4. **Sucursales** → crea la tienda y pulsa **Copiar enlace**.
5. **Programación** → asigna playlists con sus franjas y reglas de spots →
   **Aplicar en la sucursal**.
6. Abre el enlace copiado en el dispositivo de la tienda y pulsa
   **▶ Comenzar** (política de autoplay: el primer gesto lo hace un humano).
7. **Panel** → envía alertas y vigila «en línea / suena ahora».

---

## 3. Estructura del proyecto

```
LuxorStereo/
├─ supabase/
│  └─ schema.sql                 # Esquema SQL completo (ejecutar en Supabase)
├─ src/
│  ├─ middleware.ts              # Refresco de sesión + protección de /admin
│  ├─ app/
│  │  ├─ layout.tsx  globals.css  page.tsx
│  │  ├─ login/page.tsx          # Acceso al panel
│  │  ├─ branch/page.tsx         # /branch?key=<branch_key>
│  │  └─ admin/
│  │     ├─ layout.tsx           # Guard de autenticación + navegación
│  │     ├─ page.tsx             # Dashboard (estado, ahora suena, historial)
│  │     ├─ branches/page.tsx    # Sucursales
│  │     ├─ media/page.tsx       # Librería de medios (Storage)
│  │     ├─ playlists/page.tsx   # Playlists y orden
│  │     └─ schedule/page.tsx    # Programación por sucursal
│  ├─ components/
│  │  ├─ ui.tsx                  # Primitivas visuales compartidas
│  │  ├─ player/
│  │  │  ├─ BranchPlayer.tsx     # Interfaz del reproductor de tienda
│  │  │  └─ useBranchPlayer.ts   # Motor de audio, caché y reconexión
│  │  └─ admin/
│  │     ├─ AdminNav.tsx         # Navegación + cierre de sesión
│  │     └─ AlertPanel.tsx       # Control en vivo (alertas)
│  └─ lib/
│     ├─ types.ts                # Tipos de dominio (filas y payloads)
│     ├─ schedule.ts             # Reglas de programación (funciones puras)
│     ├─ realtime.ts             # Broadcast a los reproductores
│     └─ supabase/
│        ├─ client.ts            # Cliente de navegador (singleton)
│        └─ server.ts            # Cliente para Server Components
├─ .env.local.example
├─ package.json  tsconfig.json  next.config.ts  postcss.config.mjs
```

---

## 4. Base de datos y seguridad (RLS)

| Tabla | Contenido |
|---|---|
| `branches` | Sucursales: `name`, `city`, `timezone`, `active`, `last_ping`, `branch_key` (secreto del reproductor). |
| `tracks` | Medios: `title`, `artist`, `duration`, `file_url`, `storage_path`, `type` (`music`/`commercial`). |
| `playlists` / `playlist_tracks` | Playlists y su orden (`position`). |
| `branch_playlists` | Asignación playlist ↔ sucursal + `schedule_rules` (JSONB). |
| `station_logs` | Auditoría de reproducciones (alimenta el dashboard vía Realtime). |

**Políticas RLS**

- `authenticated` (panel de administración) → acceso total a las seis tablas
  y escritura en el bucket `audio`.
- `anon` (reproductores de tienda) → **sin acceso directo a ninguna tabla**.
  Sólo puede llamar a tres funciones `SECURITY DEFINER` que validan el
  `branch_key` en cada invocación:
  - `get_branch_broadcast(branch_key)` → configuración completa de emisión.
  - `branch_ping(branch_key)` → latido para el indicador en línea/offline.
  - `log_play(branch_key, track_id)` → registro de reproducción.
- Lectura del bucket `audio` pública (los MP3 se descargan sin auth);
  subida/borrado sólo autenticados.
- Los canales Realtime usan `branch:<branch_key>`: hace falta conocer la
  sucursal para escucharla.

`schedule_rules` (JSONB):

```json
{
  "window": { "from": "06:00", "to": "14:00" },
  "commercialEveryNTracks": 3,
  "commercialEveryMinutes": 15,
  "shuffle": false
}
```

---

## 5. Robustez del reproductor

- **Caché local**: cada pista se descarga a un blob y se sirve desde un
  `objectURL` (mantiene ~8 pistas calientes y precarga la siguiente). Si se
  cae internet, lo ya cargado sigue sonando.
- **Reconexión**: backoff exponencial (1 s → 30 s) para configuración y audio,
  listeners `online`/`offline` y latido cada 15 s; si la descarga falla, el
  `<audio>` hace streaming directo de la URL pública como último recurso.
- **Estados visibles**: `Conectando · Sincronizando · Reproduciendo · En pausa
  · Sin conexión · Error`, más el indicador Realtime y la hora local.
- **Franjas horarias**: el motor reevalúa la hora local en cada salto de tema,
  así que cambia de playlist automáticamente al cruzar la franja.
- **Spots**: se insertan al llegar al límite de canciones o minutos; rotan por
  los comerciales de la propia playlist o, si no tiene, por la librería global.
- **Alertas**: broadcast en tiempo real → pausa la música, reproduce el audio
  opcional, muestra el mensaje y reanuda solo.
- **Autoplay**: los navegadores exigen un gesto inicial; se detecta
  (`NotAllowedError`) y se muestra un botón de inicio.

---

## 6. Notas y solución de problemas

- **Sin audio hasta pulsar Iniciar**: es la política de autoplay; en kiosco
  basta con un toque al abrir la pantalla (o usar el flag de autoplay del
  navegador en el dispositivo).
- **La sucursal no aparece «en línea»**: el reproductor debe estar abierto;
  el latido se envía cada 15 s y el dashboard considera «en línea» (< 60 s).
- **Los cambios no llegan**: usa **Aplicar en la sucursal** en Programación
  (broadcast `reload`); el reproductor además refresca la config cada minuto.
- **Subidas grandes**: el bucket limita a 100 MB por archivo
  (ajustable en `schema.sql`).
- **Migraciones**: `schema.sql` está pensado para ejecutarse una vez en un
  proyecto nuevo (`create policy` no admite `IF NOT EXISTS`).

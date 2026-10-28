-- =============================================================================
--  LuxorStereo · Hilo musical y radio corporativa
--  Esquema inicial para Supabase (PostgreSQL + RLS + Storage + Realtime)
--  Ejecutar una sola vez en:  Supabase Dashboard -> SQL Editor -> New query
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. TABLAS
-- -----------------------------------------------------------------------------

-- Sucursales físicas de la cadena. `branch_key` es el secreto que usa el
-- reproductor de tienda (sin login) para autenticarse mediante RPC.
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  timezone    text not null default 'UTC',       -- IANA, ej. "America/Mexico_City"
  active      boolean not null default true,
  last_ping   timestamptz,
  branch_key  uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

-- Librería de medios. Los archivos viven en el bucket Storage "audio".
create table if not exists public.tracks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  artist     text,
  duration   integer not null default 0 check (duration >= 0),  -- segundos
  file_url   text not null,                        -- URL pública en Storage
  storage_path text,                               -- ruta en el bucket (para borrar)
  type       text not null default 'music' check (type in ('music', 'commercial')),
  created_at timestamptz not null default now()
);

create table if not exists public.playlists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.playlist_tracks (
  id          uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  track_id    uuid not null references public.tracks (id) on delete cascade,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (playlist_id, track_id)
);

create index if not exists playlist_tracks_order_idx
  on public.playlist_tracks (playlist_id, position);

-- Asignación de una playlist a una sucursal + reglas de reproducción.
-- schedule_rules (JSONB):
-- {
--   "window": { "from": "06:00", "to": "14:00" },   // opcional, hora local de la sucursal
--   "commercialEveryNTracks": 3,                    // un spot cada N canciones (null = off)
--   "commercialEveryMinutes": 15,                   // un spot cada M minutos   (null = off)
--   "shuffle": true                                 // mezclar el orden de la playlist
-- }
create table if not exists public.branch_playlists (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches (id) on delete cascade,
  playlist_id    uuid not null references public.playlists (id) on delete cascade,
  schedule_rules jsonb not null default '{}'::jsonb,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists branch_playlists_branch_idx
  on public.branch_playlists (branch_id);

-- Registro de lo que sonó en cada sucursal (auditoría + "ahora suena").
create table if not exists public.station_logs (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches (id) on delete cascade,
  track_id   uuid references public.tracks (id) on delete set null,
  played_at  timestamptz not null default now()
);

create index if not exists station_logs_branch_idx
  on public.station_logs (branch_id, played_at desc);

-- -----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
--    · authenticated (admins del panel) -> acceso total.
--    · anon (reproductores de tienda)   -> SIN acceso directo a tablas;
--      sólo a través de las funciones SECURITY DEFINER de la sección 3,
--      que validan el branch_key en cada llamada.
-- -----------------------------------------------------------------------------

alter table public.branches        enable row level security;
alter table public.tracks          enable row level security;
alter table public.playlists       enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.branch_playlists enable row level security;
alter table public.station_logs    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['branches','tracks','playlists','playlist_tracks','branch_playlists','station_logs']
  loop
    execute format(
      'drop policy if exists "admin full access" on public.%I', t);
    execute format(
      'create policy "admin full access" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Sin política para "anon": RLS deniega cualquier lectura/escritura directa.

-- Índice de auditoría: los logs sólo se borran con la sucursal (cascade).
-- (Se mantiene el permiso de escritura únicamente vía RPC.)

-- -----------------------------------------------------------------------------
-- 3. RPCs DEL REPRODUCTOR (SECURITY DEFINER, validan branch_key)
-- -----------------------------------------------------------------------------

-- Devuelve la configuración completa de emisión de una sucursal.
create or replace function public.get_branch_broadcast(p_branch_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch      public.branches%rowtype;
  v_assignments jsonb := '[]'::jsonb;
  v_commercials jsonb := '[]'::jsonb;
  v_row         record;
  v_tracks      jsonb;
begin
  select * into v_branch
    from public.branches
   where branch_key = p_branch_key
     and active
   for no key update;

  if not found then
    raise exception 'invalid_branch_key';
  end if;

  -- Una asignación por playlist activa, con sus pistas ordenadas.
  for v_row in
    select bp.id, bp.playlist_id, bp.schedule_rules, p.name as playlist_name
      from public.branch_playlists bp
      join public.playlists p on p.id = bp.playlist_id
     where bp.branch_id = v_branch.id
       and bp.active
     order by bp.created_at
  loop
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id',       t.id,
                 'title',    t.title,
                 'artist',   t.artist,
                 'duration', t.duration,
                 'file_url', t.file_url,
                 'type',     t.type,
                 'position', pt.position
               )
               order by pt.position
             ), '[]'::jsonb)
      into v_tracks
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
     where pt.playlist_id = v_row.playlist_id;

    v_assignments := v_assignments || jsonb_build_array(
      jsonb_build_object(
        'id',             v_row.id,
        'playlist_id',    v_row.playlist_id,
        'playlist_name',  v_row.playlist_name,
        'schedule_rules', v_row.schedule_rules,
        'tracks',         v_tracks
      )
    );
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'title', t.title, 'artist', t.artist,
        'duration', t.duration, 'file_url', t.file_url, 'type', t.type
      )
      order by t.created_at
    ), '[]'::jsonb)
  into v_commercials
  from public.tracks t
  where t.type = 'commercial';

  return jsonb_build_object(
    'branch', jsonb_build_object(
      'id', v_branch.id, 'name', v_branch.name, 'city', v_branch.city,
      'timezone', v_branch.timezone, 'active', v_branch.active
    ),
    'assignments', v_assignments,
    'commercials', v_commercials,
    'server_time', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;

-- Latido del reproductor: alimenta el indicador en línea/offline del dashboard.
create or replace function public.branch_ping(p_branch_key uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.branches
     set last_ping = now()
   where branch_key = p_branch_key
     and active;
end;
$$;

-- Registrar una reproducción (auditoría + feed "ahora suena" en tiempo real).
create or replace function public.log_play(p_branch_key uuid, p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_branch_id uuid;
begin
  select id into v_branch_id
    from public.branches
   where branch_key = p_branch_key
     and active;

  if v_branch_id is null then
    raise exception 'invalid_branch_key';
  end if;

  insert into public.station_logs (branch_id, track_id)
  values (v_branch_id, p_track_id);
end;
$$;

-- Sólo el cliente (anon/authenticated) debe invocar estas funciones.
revoke all on function public.get_branch_broadcast(uuid) from public;
revoke all on function public.branch_ping(uuid)         from public;
revoke all on function public.log_play(uuid, uuid)      from public;
grant execute on function public.get_branch_broadcast(uuid) to anon, authenticated;
grant execute on function public.branch_ping(uuid)         to anon, authenticated;
grant execute on function public.log_play(uuid, uuid)      to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. STORAGE: bucket público de audio
--    Lectura pública (el reproductor baja los MP3/WAV sin auth);
--    escritura sólo para administradores autenticados.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', true, 104857600,
        array['audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/aac','audio/ogg','audio/flac'])
on conflict (id) do nothing;

do $$
declare p text;
begin
  foreach p in array array['audio public read','audio admin insert','audio admin update','audio admin delete']
  loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;

create policy "audio public read" on storage.objects
  for select using (bucket_id = 'audio');

create policy "audio admin insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'audio');

create policy "audio admin update" on storage.objects
  for update to authenticated using (bucket_id = 'audio');

create policy "audio admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'audio');

-- -----------------------------------------------------------------------------
-- 5. REALTIME: feed de reproducciones y estado de sucursales en el dashboard
-- -----------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.station_logs;
exception when duplicate_object then null; when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.branches;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 6. DATOS DE EJEMPLO (opcional, borrar después)
-- -----------------------------------------------------------------------------
-- insert into public.tracks (title, artist, duration, file_url, type)
-- values ('Ambient Morning', 'Librería interna', 180,
--         'https://<ref>.supabase.co/storage/v1/object/public/audio/ambient.mp3', 'music');

-- =============================================================================
--  LuxorStereo · Apariencia del reproductor de sucursal
--  Ejecutar una sola vez en:  Supabase Dashboard -> SQL Editor -> New query
--
--  1. station_settings: ajustes globales (clave/valor) del reproductor.
--     · Solo el panel (authenticated) los lee/escribe por RLS.
--     · El reproductor de sucursal los recibe por RPC (get_branch_broadcast).
--  2. Bucket público "images" para la imagen de fondo del reproductor.
--  3. get_branch_broadcast(): ahora incluye "settings".
-- =============================================================================

create table if not exists public.station_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.station_settings enable row level security;

drop policy if exists "admin full access" on public.station_settings;
create policy "admin full access" on public.station_settings
  for all to authenticated using (true) with check (true);

-- Sin política para "anon": RLS deniega la lectura directa; el reproductor
-- sólo recibe los ajustes a través de la RPC SECURITY DEFINER.

-- -----------------------------------------------------------------------------
--  Bucket de imágenes (fondo del reproductor): lectura pública,
--  escritura sólo para administradores autenticados.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do nothing;

do $$
declare p text;
begin
  foreach p in array array['images public read','images admin insert','images admin update','images admin delete']
  loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;

create policy "images public read" on storage.objects
  for select using (bucket_id = 'images');

create policy "images admin insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'images');

create policy "images admin update" on storage.objects
  for update to authenticated using (bucket_id = 'images');

create policy "images admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'images');

-- -----------------------------------------------------------------------------
--  get_branch_broadcast(): se añade el objeto "settings" con los ajustes
--  globales vigentes (p. ej. player_background = imagen de fondo).
-- -----------------------------------------------------------------------------

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
    'settings', coalesce(
      (select jsonb_object_agg(key, value)
         from public.station_settings
        where value is not null),
      '{}'::jsonb),
    'assignments', v_assignments,
    'commercials', v_commercials,
    'server_time', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;

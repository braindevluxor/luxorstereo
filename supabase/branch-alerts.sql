-- =============================================================================
--  LuxorStereo · Alertas con respaldo REST (entrega sin websocket)
--  Ejecutar una sola vez en:  Supabase Dashboard -> SQL Editor -> New query
--
--  El reproductor recibe las alertas por websocket Realtime (instantáneo).
--  Si el navegador/proxy de la sucursal bloquea el websocket, la alerta queda
--  guardada en esta tabla y el reproductor la recoge por REST a los pocos
--  segundos: la alerta siempre llega, con la latencia que sea necesaria.
-- =============================================================================

create table if not exists public.branch_alerts (
  id uuid primary key default gen_random_uuid(),
  branch_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists branch_alerts_lookup_idx
  on public.branch_alerts (branch_key, created_at desc);

alter table public.branch_alerts enable row level security;
-- Sin policies: la tabla no se lee ni se escribe desde PostgREST;
-- el acceso es exclusivamente por las funciones de abajo.

-- Publica una alerta para una sucursal (sólo administradores autenticados).
create or replace function public.push_branch_alert(p_branch_key text, p_payload jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Requiere sesión de administrador' using errcode = '42501';
  end if;

  insert into public.branch_alerts (branch_key, payload)
  values (p_branch_key, p_payload);

  -- Las alertas sólo viven 10 minutos: si nadie las leyó, caducan.
  delete from public.branch_alerts
  where branch_key = p_branch_key
    and created_at < now() - interval '10 minutes';

  return (select a.created_at
            from public.branch_alerts a
           where a.branch_key = p_branch_key
           order by a.created_at desc
           limit 1);
end;
$$;

-- Últimas alertas de una sucursal. Quien conoce el branch_key puede leerlas:
-- es el mismo modelo de seguridad que get_branch_broadcast y branch_ping.
create or replace function public.get_branch_alerts(p_branch_key text)
returns setof public.branch_alerts
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.branch_key, a.payload, a.created_at
    from public.branch_alerts a
   where a.branch_key = p_branch_key
   order by a.created_at desc
   limit 5;
$$;

-- Autorización explícita de la función de escritura: sólo sesión de admin.
revoke execute on function public.push_branch_alert(text, jsonb) from public, anon;
grant execute on function public.push_branch_alert(text, jsonb) to authenticated;

-- Reparación de NULLs en auth.users (causa del 500 "Database error querying schema")
-- Ejecutar en el SQL Editor de Supabase. Idempotente: puede repetirse sin riesgo.
-- Cada columna se repara en su propia subtransacción: si una no puede (p. ej.
-- por restricción UNIQUE como phone), se salta y sigue con la siguiente.

do $$
declare
  r   record;
  n   int;
begin
  raise notice 'Usuarios en auth.users: %', (select count(*) from auth.users);

  for r in
    select column_name
      from information_schema.columns
     where table_schema = 'auth'
       and table_name = 'users'
       and data_type in ('text', 'character varying')
     order by ordinal_position
  loop
    execute format('select count(*) from auth.users where %I is null', r.column_name) into n;

    if n = 0 then
      continue;
    end if;

    begin
      execute format('update auth.users set %I = '''' where %I is null', r.column_name, r.column_name);
      raise notice 'REPARADO   %   (% fila(s) NULL -> texto vacío)', r.column_name, n;
    exception when others then
      raise notice 'SALTADO    %   (% fila(s) NULL): %', r.column_name, n, sqlerrm;
    end;
  end loop;

  raise notice 'Proceso terminado.';
end $$;

-- Verificación: cómo quedaron los usuarios
select email,
       case when phone is null then '(null)' else coalesce(nullif(phone,''),'(vacío)') end as phone,
       email_confirmed_at is not null as confirmado,
       created_at
  from auth.users
 order by created_at;

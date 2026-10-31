-- =============================================================================
--  Alta del usuario administrador del panel (LuxorStereo)
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query
--
--  ⚠️ EDITA el correo y la contraseña ANTES de ejecutar (líneas v_email / v_password)
--     y no subas este archivo a git con credenciales reales.
--
--  Alternativa sin SQL: Supabase Dashboard -> Authentication -> Users -> Add user.
-- =============================================================================

do $$
declare
  v_email     text := 'samir@luxor.com';        -- ← editar
  v_password  text := '12556182';   -- ← editar (mínimo 8 caracteres)
  v_user_id   uuid := gen_random_uuid();
  v_schema    text;
  v_encrypted text;
begin
  if v_password = 'CambiaEstaClave123!' then
    raise exception 'Cambia la contraseña por defecto antes de ejecutar este script';
  end if;

  -- pgcrypto puede estar en un esquema distinto: localizamos crypt()/gen_salt()
  select n.nspname into v_schema
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'crypt'
   limit 1;

  if v_schema is null then
    raise exception 'No se encontró pgcrypto (crypt). Ejecuta primero supabase/schema.sql';
  end if;

  execute format(
    'select %I.crypt(%L, %I.gen_salt(''bf'', 10))',
    v_schema, v_password, v_schema
  ) into v_encrypted;

  -- 1) Usuario en Supabase Auth (ya confirmado: entra sin verificar correo)
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, v_encrypted, now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

  -- 2) Identidad "email" (tolerante a versiones de GoTrue sin provider_id)
  begin
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  exception when undefined_column then
    insert into auth.identities (
      id, user_id, identity_data, provider, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now()
    );
  end;

  raise notice 'Usuario creado: % (id %)', v_email, v_user_id;
end $$;

-- Verificación
select email, email_confirmed_at, created_at
  from auth.users
 order by created_at desc
 limit 5;

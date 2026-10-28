-- =============================================================================
--  Alta (o actualización) del usuario administrador del panel (LuxorStereo)
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query
--
--  · Si NO editas nada: se genera una contraseña aleatoria de 16 caracteres
--    y aparece en el resultado del último SELECT (y en el NOTICE).
--  · Si quieres TU contraseña: ponla en v_password (mínimo 8 caracteres).
--  · Si el correo YA existe en Auth: con v_reset_existing := true se le asigna
--    la contraseña nueva (idempotente, puedes reejecutar el archivo cuanto quieras).
--    Con false, aborta con un mensaje claro en vez de error 23505.
-- =============================================================================

do $$
declare
  v_email          text := 'admin@luxor.mx';   -- ← correo editable (opcional)
  v_password       text := null;               -- ← contraseña propia (null = automática)
  v_reset_existing boolean := true;            -- ← true: resetea la clave si ya existe
  v_user_id        uuid;
  v_existing       boolean := false;
  v_schema         text;
  v_encrypted      text;
  v_alphabet       text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
begin
  -- 0) Usuario existente
  select id into v_user_id
    from auth.users
   where lower(email) = lower(v_email)
   limit 1;

  if v_user_id is not null then
    if not v_reset_existing then
      raise exception 'Ya existe el usuario %: bórralo en Authentication -> Users, usa otro correo o pon v_reset_existing := true', v_email;
    end if;
    v_existing := true;
  end if;

  -- 1) Contraseña
  if v_password is null then
    select string_agg(
             substr(v_alphabet,
                    1 + floor(random() * length(v_alphabet))::int,
                    1), '')
      into v_password
      from generate_series(1, 16);
  elsif length(v_password) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres';
  end if;

  -- 2) pgcrypto puede estar en otro esquema: localizamos crypt()/gen_salt()
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

  -- 3) Crear o actualizar el usuario (Supabase Auth)
  if v_existing then
    update auth.users
       set encrypted_password  = v_encrypted,
           email_confirmed_at  = now(),
           raw_app_meta_data   = '{"provider":"email","providers":["email"]}'::jsonb,
           phone_change        = coalesce(phone_change, ''),
           phone_change_token  = coalesce(phone_change_token, ''),
           email_change        = coalesce(email_change, ''),
           email_change_token_new   = coalesce(email_change_token_new, ''),
           email_change_token_current = coalesce(email_change_token_current, ''),
           confirmation_token  = coalesce(confirmation_token, ''),
           recovery_token      = coalesce(recovery_token, ''),
           reauthentication_token = coalesce(reauthentication_token, ''),
           updated_at          = now()
     where id = v_user_id;
    raise notice 'LuxorStereo -> usuario existente ACTUALIZADO: %', v_email;
  else
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      phone, phone_change, phone_change_token,
      email_change, email_change_token_new, email_change_token_current,
      confirmation_token, recovery_token, reauthentication_token,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, v_encrypted, now(),
      '{"provider":"email","providers":["email"]}', '{}',
      null, '', '',              -- phone (sin teléfono) y tokens en ''
      '', '', '',                -- email_change y sus tokens
      '', '', '',                -- confirmation / recovery / reauthentication
      now(), now()
    );
    raise notice 'LuxorStereo -> usuario CREADO: %', v_email;
  end if;

  -- 4) Identidad "email" sólo si falta (tolerante a versiones sin provider_id)
  if not exists (
       select 1 from auth.identities where user_id = v_user_id and provider = 'email'
     ) then
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
  end if;

  -- 5) Credenciales visibles en la consulta final (temporal a esta sesión)
  create temporary table if not exists _admin_credentials (
    email    text,
    password text,
    aviso    text
  );
  delete from _admin_credentials;
  insert into _admin_credentials values (
    v_email, v_password,
    'Guarda esta contraseña ahora: no se vuelve a mostrar (sólo su hash está en la BD).'
  );

  raise notice 'LuxorStereo -> contraseña: %', v_password;
end $$;

-- ↓ ESTA consulta devuelve las credenciales: ejecuta TODO el archivo
select email, password, aviso from _admin_credentials;

-- Verificación rápida de todos los usuarios del panel
-- select email, email_confirmed_at, created_at from auth.users order by created_at;

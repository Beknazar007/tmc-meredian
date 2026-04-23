-- Run this in Supabase SQL Editor after schema.sql
-- Creates default users with legacy usernames and same passwords:
-- admin/admin123, sklad1/1234, sklad2/1234

create extension if not exists pgcrypto;

insert into public.tmc_warehouses (id, name, responsible_ids)
values
  ('w1', 'Главный склад', '["u2"]'::jsonb),
  ('w2', 'Склад №2', '["u3"]'::jsonb)
on conflict (id) do update
set
  name = excluded.name,
  responsible_ids = excluded.responsible_ids;

do $$
declare
  rec record;
  uid uuid;
begin
  for rec in
    select *
    from (values
      ('u1', 'Администратор', 'admin', 'admin@tmc.local', 'admin123', 'admin', null::text),
      ('u2', 'Иванов А.А.', 'sklad1', 'sklad1@tmc.local', '1234', 'user', 'w1'),
      ('u3', 'Петров Б.Б.', 'sklad2', 'sklad2@tmc.local', '1234', 'user', 'w2')
    ) as t(app_id, full_name, app_login, auth_email, plain_password, app_role, wh_id)
  loop
    select id into uid
    from auth.users
    where email = rec.auth_email;

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change_token_current,
        reauthentication_token,
        phone_change_token,
        phone_change,
        email_change,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin
      ) values (
        '00000000-0000-0000-0000-000000000000',
        uid,
        'authenticated',
        'authenticated',
        rec.auth_email,
        crypt(rec.plain_password, gen_salt('bf')),
        now(),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        now(),
        now(),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('name', rec.full_name),
        false
      );
    else
      update auth.users
      set
        encrypted_password = crypt(rec.plain_password, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        confirmation_token = coalesce(confirmation_token, ''),
        recovery_token = coalesce(recovery_token, ''),
        email_change_token_new = coalesce(email_change_token_new, ''),
        email_change_token_current = coalesce(email_change_token_current, ''),
        reauthentication_token = coalesce(reauthentication_token, ''),
        phone_change_token = coalesce(phone_change_token, ''),
        phone_change = coalesce(phone_change, ''),
        email_change = coalesce(email_change, ''),
        updated_at = now()
      where id = uid;
    end if;

    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      created_at,
      updated_at,
      last_sign_in_at
    )
    values (
      gen_random_uuid(),
      uid,
      jsonb_build_object('sub', uid::text, 'email', rec.auth_email),
      'email',
      rec.auth_email,
      now(),
      now(),
      now()
    )
    on conflict (provider, provider_id) do update
    set
      user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

    insert into public.tmc_users (id, auth_user_id, name, login, role, warehouse_id)
    values (rec.app_id, uid, rec.full_name, rec.app_login, rec.app_role, rec.wh_id)
    on conflict (id) do update
    set
      auth_user_id = excluded.auth_user_id,
      name = excluded.name,
      login = excluded.login,
      role = excluded.role,
      warehouse_id = excluded.warehouse_id,
      updated_at = now();
  end loop;
end
$$;

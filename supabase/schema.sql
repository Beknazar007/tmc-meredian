create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.tmc_users (
  id text primary key,
  auth_user_id uuid unique references auth.users (id),
  name text not null,
  login text not null unique,
  password text,
  role text not null default 'user' check (role in ('admin', 'user')),
  warehouse_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tmc_warehouses (
  id text primary key,
  name text not null,
  responsible_ids jsonb not null default '[]'::jsonb,
  responsible_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tmc_assets (
  id text primary key,
  name text not null,
  category text,
  supplier text,
  purchase_date date,
  price numeric check (price is null or price >= 0),
  responsible_id text,
  notes text,
  photo text,
  unit text,
  qty numeric check (qty is null or qty >= 0),
  min_qty numeric not null default 0 check (min_qty >= 0),
  initial_qty numeric check (initial_qty is null or initial_qty >= 0),
  warehouse_id text,
  status text not null default 'На складе' check (status in ('На складе', 'Закупка', 'В пути', 'У пользователя', 'На списание', 'Списан')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb,
  pending_woqty numeric check (pending_woqty is null or pending_woqty >= 0)
);

create table if not exists public.tmc_transfers (
  id text primary key,
  no text unique,
  asset_id text,
  asset_name text,
  from_wh_id text,
  from_wh_name text,
  to_wh_id text,
  to_wh_name text,
  from_responsible_id text,
  from_responsible_name text,
  to_responsible_id text,
  to_responsible_name text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  created_by text,
  qty numeric check (qty is null or qty > 0),
  unit text,
  confirmed_at timestamptz,
  confirmed_by text,
  reject_reason text
);

-- For existing deployments: make sure the reject_reason column is present.
alter table public.tmc_transfers
  add column if not exists reject_reason text;

create table if not exists public.tmc_categories (
  id text primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Procurement requests (v9: «Закупки / заявки на ТМЦ»).
create table if not exists public.tmc_purchase_requests (
  id text primary key,
  name text not null,
  category text,
  qty numeric,
  unit text,
  warehouse_id text,
  notes text,
  urgency text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'purchased')),
  created_by text not null,
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  approve_note text,
  purchased_at timestamptz,
  purchased_by text,
  purchased_name text,
  purchased_qty numeric,
  purchased_unit text,
  purchased_price numeric,
  purchased_supplier text,
  purchased_asset_id text,
  is_analog boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Optional link: ТМЦ created when fulfilling an approved request.
alter table public.tmc_assets
  add column if not exists from_request_id text;

drop trigger if exists trg_tmc_purchase_requests_updated_at on public.tmc_purchase_requests;
create trigger trg_tmc_purchase_requests_updated_at
  before update on public.tmc_purchase_requests
  for each row execute function public.set_updated_at();

-- Keep a stable baseline of categories in DB.
insert into public.tmc_categories (id, name)
values
  ('cat-Стройматериалы', 'Стройматериалы'),
  ('cat-Инструменты', 'Инструменты'),
  ('cat-Запчасти', 'Запчасти'),
  ('cat-ГСМ', 'ГСМ'),
  ('cat-Электрика', 'Электрика'),
  ('cat-Сантехника', 'Сантехника'),
  ('cat-Спецодежда / СИЗ', 'Спецодежда / СИЗ'),
  ('cat-Техника / Оборудование', 'Техника / Оборудование'),
  ('cat-Расходники', 'Расходники'),
  ('cat-Прочее', 'Прочее')
on conflict (id) do nothing;

create or replace function public.tmc_prevent_last_category_delete()
returns trigger
language plpgsql
as $$
declare
  asset_count int;
begin
  -- Block deletion if any asset still references this category by name
  -- (tmc_assets.category stores the category name, not its id).
  select count(*) into asset_count
  from public.tmc_assets
  where category = old.name;
  if asset_count > 0 then
    raise exception 'Нельзя удалить категорию «%»: в ней числится % ТМЦ. Переназначьте их перед удалением.',
      old.name, asset_count;
  end if;

  if (select count(*) from public.tmc_categories) <= 1 then
    raise exception 'Нельзя удалить последнюю категорию';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_tmc_prevent_last_category_delete on public.tmc_categories;
create trigger trg_tmc_prevent_last_category_delete
before delete on public.tmc_categories
for each row execute function public.tmc_prevent_last_category_delete();

create table if not exists public.tmc_sessions (
  id text primary key,
  is_active boolean not null default false,
  payload jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tmc_warehouse_responsibles (
  warehouse_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (warehouse_id, user_id)
);

create table if not exists public.tmc_asset_movements (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null,
  transfer_id text,
  movement_type text not null check (movement_type in ('inbound', 'outbound', 'transfer_pending', 'transfer_confirmed', 'transfer_rejected', 'writeoff_request', 'writeoff_approved', 'writeoff_rejected')),
  qty numeric,
  unit text,
  warehouse_id text,
  responsible_id text,
  actor_name text,
  notes text,
  event_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tmc_users_warehouse_fk') then
    alter table public.tmc_users
      add constraint tmc_users_warehouse_fk
      foreign key (warehouse_id) references public.tmc_warehouses(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_assets_warehouse_fk') then
    alter table public.tmc_assets
      add constraint tmc_assets_warehouse_fk
      foreign key (warehouse_id) references public.tmc_warehouses(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_assets_responsible_fk') then
    alter table public.tmc_assets
      add constraint tmc_assets_responsible_fk
      foreign key (responsible_id) references public.tmc_users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_transfers_asset_fk') then
    alter table public.tmc_transfers
      add constraint tmc_transfers_asset_fk
      foreign key (asset_id) references public.tmc_assets(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_transfers_from_wh_fk') then
    alter table public.tmc_transfers
      add constraint tmc_transfers_from_wh_fk
      foreign key (from_wh_id) references public.tmc_warehouses(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_transfers_to_wh_fk') then
    alter table public.tmc_transfers
      add constraint tmc_transfers_to_wh_fk
      foreign key (to_wh_id) references public.tmc_warehouses(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_transfers_from_resp_fk') then
    alter table public.tmc_transfers
      add constraint tmc_transfers_from_resp_fk
      foreign key (from_responsible_id) references public.tmc_users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_transfers_to_resp_fk') then
    alter table public.tmc_transfers
      add constraint tmc_transfers_to_resp_fk
      foreign key (to_responsible_id) references public.tmc_users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_warehouse_responsibles_warehouse_fk') then
    alter table public.tmc_warehouse_responsibles
      add constraint tmc_warehouse_responsibles_warehouse_fk
      foreign key (warehouse_id) references public.tmc_warehouses(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_warehouse_responsibles_user_fk') then
    alter table public.tmc_warehouse_responsibles
      add constraint tmc_warehouse_responsibles_user_fk
      foreign key (user_id) references public.tmc_users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_asset_movements_asset_fk') then
    alter table public.tmc_asset_movements
      add constraint tmc_asset_movements_asset_fk
      foreign key (asset_id) references public.tmc_assets(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_asset_movements_transfer_fk') then
    alter table public.tmc_asset_movements
      add constraint tmc_asset_movements_transfer_fk
      foreign key (transfer_id) references public.tmc_transfers(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_asset_movements_warehouse_fk') then
    alter table public.tmc_asset_movements
      add constraint tmc_asset_movements_warehouse_fk
      foreign key (warehouse_id) references public.tmc_warehouses(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tmc_asset_movements_responsible_fk') then
    alter table public.tmc_asset_movements
      add constraint tmc_asset_movements_responsible_fk
      foreign key (responsible_id) references public.tmc_users(id) on delete set null;
  end if;
end;
$$;

create index if not exists idx_tmc_assets_warehouse_id on public.tmc_assets(warehouse_id);
create index if not exists idx_tmc_assets_responsible_id on public.tmc_assets(responsible_id);
create index if not exists idx_tmc_assets_status on public.tmc_assets(status);
create index if not exists idx_tmc_transfers_asset_id on public.tmc_transfers(asset_id);
create index if not exists idx_tmc_transfers_status on public.tmc_transfers(status);
create index if not exists idx_tmc_transfers_created_at on public.tmc_transfers(created_at desc);
create index if not exists idx_tmc_asset_movements_asset_id on public.tmc_asset_movements(asset_id);
create index if not exists idx_tmc_asset_movements_event_at on public.tmc_asset_movements(event_at desc);

drop trigger if exists trg_tmc_users_updated_at on public.tmc_users;
create trigger trg_tmc_users_updated_at before update on public.tmc_users
for each row execute function public.set_updated_at();

drop trigger if exists trg_tmc_warehouses_updated_at on public.tmc_warehouses;
create trigger trg_tmc_warehouses_updated_at before update on public.tmc_warehouses
for each row execute function public.set_updated_at();

drop trigger if exists trg_tmc_assets_updated_at on public.tmc_assets;
create trigger trg_tmc_assets_updated_at before update on public.tmc_assets
for each row execute function public.set_updated_at();

create or replace function public.sync_warehouse_responsibles()
returns trigger
language plpgsql
as $$
begin
  delete from public.tmc_warehouse_responsibles where warehouse_id = new.id;
  -- Only sync ids that still exist in tmc_users; stale ids (e.g. from a
  -- concurrent user deletion or an out-of-date client payload) are skipped
  -- so the save doesn't fail with a FK violation.
  insert into public.tmc_warehouse_responsibles (warehouse_id, user_id)
  select new.id, v.value::text
  from jsonb_array_elements_text(coalesce(new.responsible_ids, '[]'::jsonb)) as v
  where exists (select 1 from public.tmc_users u where u.id = v.value::text);
  return new;
end;
$$;

drop trigger if exists trg_sync_warehouse_responsibles on public.tmc_warehouses;
create trigger trg_sync_warehouse_responsibles
after insert or update of responsible_ids on public.tmc_warehouses
for each row execute function public.sync_warehouse_responsibles();

-- Before a user is deleted: (1) block deletion if they're still
-- responsible for a pending transfer (incoming or outgoing), otherwise
-- the transfer would become unworkable; (2) strip their id from every
-- warehouse's responsible_ids jsonb array so no stale reference can
-- break later saves.
create or replace function public.prune_user_from_warehouses()
returns trigger
language plpgsql
as $$
declare
  pending_count int;
  display_name text;
begin
  display_name := coalesce(old.name, old.id);
  select count(*) into pending_count
  from public.tmc_transfers
  where status = 'pending'
    and (from_responsible_id = old.id or to_responsible_id = old.id);
  if pending_count > 0 then
    raise exception 'Нельзя удалить пользователя «%»: на нём % активных передач. Сначала отклоните или переназначьте их.',
      display_name, pending_count;
  end if;

  update public.tmc_warehouses
  set responsible_ids = coalesce(
    (
      select jsonb_agg(v.value)
      from jsonb_array_elements_text(coalesce(responsible_ids, '[]'::jsonb)) as v
      where v.value::text <> old.id
    ),
    '[]'::jsonb
  )
  where responsible_ids is not null
    and responsible_ids ? old.id;
  return old;
end;
$$;

drop trigger if exists trg_prune_user_from_warehouses on public.tmc_users;
create trigger trg_prune_user_from_warehouses
before delete on public.tmc_users
for each row execute function public.prune_user_from_warehouses();

-- Block warehouse deletion while it still holds inventory or has active
-- transfers. Without this guard, cascading FK set-null would leave
-- orphaned assets invisible in the UI and broken pending transfers.
create or replace function public.tmc_guard_warehouse_delete()
returns trigger
language plpgsql
as $$
declare
  asset_count int;
  transfer_count int;
  display_name text;
begin
  display_name := coalesce(old.name, old.id);
  select count(*) into asset_count
  from public.tmc_assets
  where warehouse_id = old.id;
  if asset_count > 0 then
    raise exception 'Нельзя удалить склад «%»: на нём числится % ТМЦ. Переместите или спишите их перед удалением.',
      display_name, asset_count;
  end if;
  select count(*) into transfer_count
  from public.tmc_transfers
  where status = 'pending'
    and (from_wh_id = old.id or to_wh_id = old.id);
  if transfer_count > 0 then
    raise exception 'Нельзя удалить склад «%»: есть % активных передач (ожидают подтверждения).',
      display_name, transfer_count;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_tmc_guard_warehouse_delete on public.tmc_warehouses;
create trigger trg_tmc_guard_warehouse_delete
before delete on public.tmc_warehouses
for each row execute function public.tmc_guard_warehouse_delete();

-- Block asset deletion while any pending transfer references it.
-- tmc_confirm_transfer deletes "zombie" source rows only when safe
-- (no other pending transfer for that asset), so this guard does not
-- block the normal transfer lifecycle.
create or replace function public.tmc_guard_asset_delete()
returns trigger
language plpgsql
as $$
declare
  pending_count int;
begin
  select count(*) into pending_count
  from public.tmc_transfers
  where asset_id = old.id and status = 'pending';
  if pending_count > 0 then
    raise exception 'Нельзя удалить ТМЦ «%»: есть % активных передач по этой позиции.',
      coalesce(old.name, old.id), pending_count;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_tmc_guard_asset_delete on public.tmc_assets;
create trigger trg_tmc_guard_asset_delete
before delete on public.tmc_assets
for each row execute function public.tmc_guard_asset_delete();

insert into public.tmc_warehouse_responsibles (warehouse_id, user_id)
select w.id, v.value::text
from public.tmc_warehouses w,
jsonb_array_elements_text(coalesce(w.responsible_ids, '[]'::jsonb)) as v
where exists (select 1 from public.tmc_users u where u.id = v.value::text)
on conflict do nothing;

alter table public.tmc_users enable row level security;
alter table public.tmc_warehouses enable row level security;
alter table public.tmc_assets enable row level security;
alter table public.tmc_transfers enable row level security;
alter table public.tmc_categories enable row level security;
alter table public.tmc_sessions enable row level security;
alter table public.tmc_warehouse_responsibles enable row level security;
alter table public.tmc_asset_movements enable row level security;
alter table public.tmc_purchase_requests enable row level security;

drop policy if exists tmc_users_select_policy on public.tmc_users;
create policy tmc_users_select_policy on public.tmc_users
for select using (auth.role() in ('authenticated', 'anon'));

drop policy if exists tmc_users_write_policy on public.tmc_users;
create policy tmc_users_write_policy on public.tmc_users
for all using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

drop policy if exists tmc_warehouses_rw_policy on public.tmc_warehouses;
create policy tmc_warehouses_rw_policy on public.tmc_warehouses
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() = 'authenticated');

drop policy if exists tmc_assets_rw_policy on public.tmc_assets;
create policy tmc_assets_rw_policy on public.tmc_assets
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() = 'authenticated');

drop policy if exists tmc_transfers_rw_policy on public.tmc_transfers;
create policy tmc_transfers_rw_policy on public.tmc_transfers
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() = 'authenticated');

drop policy if exists tmc_categories_rw_policy on public.tmc_categories;
create policy tmc_categories_rw_policy on public.tmc_categories
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() = 'authenticated');

drop policy if exists tmc_sessions_rw_policy on public.tmc_sessions;
create policy tmc_sessions_rw_policy on public.tmc_sessions
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() in ('authenticated', 'anon'));

drop policy if exists tmc_warehouse_responsibles_rw_policy on public.tmc_warehouse_responsibles;
create policy tmc_warehouse_responsibles_rw_policy on public.tmc_warehouse_responsibles
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() = 'authenticated');

drop policy if exists tmc_asset_movements_rw_policy on public.tmc_asset_movements;
create policy tmc_asset_movements_rw_policy on public.tmc_asset_movements
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() = 'authenticated');

drop policy if exists tmc_purchase_requests_rw_policy on public.tmc_purchase_requests;
create policy tmc_purchase_requests_rw_policy on public.tmc_purchase_requests
for all using (auth.role() in ('authenticated', 'anon'))
with check (auth.role() = 'authenticated');

-- Explicit API grants for Supabase roles.
grant usage on schema public to anon, authenticated;

grant select on table
  public.tmc_users,
  public.tmc_warehouses,
  public.tmc_assets,
  public.tmc_transfers,
  public.tmc_categories,
  public.tmc_sessions,
  public.tmc_warehouse_responsibles,
  public.tmc_asset_movements,
  public.tmc_purchase_requests
to anon;

grant select, insert, update, delete on table
  public.tmc_users,
  public.tmc_warehouses,
  public.tmc_assets,
  public.tmc_transfers,
  public.tmc_categories,
  public.tmc_sessions,
  public.tmc_warehouse_responsibles,
  public.tmc_asset_movements,
  public.tmc_purchase_requests
to authenticated;

-- One atomic update: set which warehouses a user is responsible for (admin only).
-- Avoids client-side diff bugs when several warehouses are updated at once.
create or replace function public.tmc_set_user_warehouse_access(
  p_user_id text,
  p_warehouse_ids text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  wid text;
begin
  if auth.uid() is null then
    raise exception 'Требуется вход в систему';
  end if;

  select u.role into caller_role
  from public.tmc_users u
  where u.auth_user_id = auth.uid()
  limit 1;

  if caller_role is null or caller_role <> 'admin' then
    raise exception 'Назначать склады может только администратор';
  end if;

  if not exists (select 1 from public.tmc_users where id = p_user_id) then
    raise exception 'Пользователь не найден';
  end if;

  if p_warehouse_ids is not null and coalesce(array_length(p_warehouse_ids, 1), 0) > 0 then
    update public.tmc_users
    set warehouse_id = p_warehouse_ids[1]
    where id = p_user_id;
  else
    update public.tmc_users
    set warehouse_id = null
    where id = p_user_id;
  end if;

  update public.tmc_warehouses w
  set responsible_ids = coalesce((
    select jsonb_agg(v.value)
    from jsonb_array_elements_text(coalesce(w.responsible_ids, '[]'::jsonb)) v
    where v.value::text is distinct from p_user_id
  ), '[]'::jsonb);

  if p_warehouse_ids is not null and coalesce(array_length(p_warehouse_ids, 1), 0) > 0 then
    foreach wid in array p_warehouse_ids
    loop
      if exists (select 1 from public.tmc_warehouses where id = wid) then
        update public.tmc_warehouses
        set responsible_ids = coalesce(responsible_ids, '[]'::jsonb) || jsonb_build_array(p_user_id)
        where id = wid
          and not exists (
            select 1
            from jsonb_array_elements_text(coalesce(responsible_ids, '[]'::jsonb)) e
            where e.value = p_user_id
          );
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.tmc_append_asset_movement(
  p_asset_id text,
  p_transfer_id text,
  p_movement_type text,
  p_qty numeric,
  p_unit text,
  p_warehouse_id text,
  p_responsible_id text,
  p_actor_name text,
  p_notes text
)
returns void
language sql
as $$
  insert into public.tmc_asset_movements (
    asset_id,
    transfer_id,
    movement_type,
    qty,
    unit,
    warehouse_id,
    responsible_id,
    actor_name,
    notes
  ) values (
    p_asset_id,
    p_transfer_id,
    p_movement_type,
    p_qty,
    p_unit,
    p_warehouse_id,
    p_responsible_id,
    p_actor_name,
    p_notes
  );
$$;

-- ISO-8601 UTC timestamp matching the frontend's new Date().toISOString().
create or replace function public.tmc_iso_now()
returns text
language sql
as $$
  select to_char((now() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

create or replace function public.tmc_request_transfer(
  p_transfer_id text,
  p_transfer_no text,
  p_asset_id text,
  p_asset_name text,
  p_from_wh_id text,
  p_from_wh_name text,
  p_to_wh_id text,
  p_to_wh_name text,
  p_from_responsible_id text,
  p_from_responsible_name text,
  p_to_responsible_id text,
  p_to_responsible_name text,
  p_qty numeric,
  p_unit text,
  p_notes text,
  p_actor text
)
returns void
language plpgsql
as $$
declare
  src public.tmc_assets%rowtype;
begin
  select * into src from public.tmc_assets where id = p_asset_id for update;
  if src.id is null then
    raise exception 'Source asset not found: %', p_asset_id;
  end if;

  insert into public.tmc_transfers (
    id, no, asset_id, asset_name,
    from_wh_id, from_wh_name, to_wh_id, to_wh_name,
    from_responsible_id, from_responsible_name,
    to_responsible_id, to_responsible_name,
    qty, unit, notes, status, created_at, created_by
  ) values (
    p_transfer_id, p_transfer_no, p_asset_id, p_asset_name,
    p_from_wh_id, p_from_wh_name, p_to_wh_id, p_to_wh_name,
    p_from_responsible_id, p_from_responsible_name,
    p_to_responsible_id, p_to_responsible_name,
    p_qty, p_unit, p_notes, 'pending', now(), p_actor
  );

  if p_qty is not null then
    if coalesce(src.qty, 0) < p_qty then
      raise exception 'Недостаточно количества на складе (есть %, нужно %)', coalesce(src.qty, 0), p_qty;
    end if;
    update public.tmc_assets
    set qty = coalesce(qty, 0) - p_qty,
        updated_at = now(),
        history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'date', public.tmc_iso_now(),
            'action', 'Отправлено (' || p_qty::text || ' ' || coalesce(p_unit, 'шт') || ')',
            'warehouseId', src.warehouse_id,
            'responsibleId', src.responsible_id,
            'qty', p_qty,
            'status', 'В пути',
            'by', p_actor,
            'notes', p_notes
          )
        )
    where id = p_asset_id;
  else
    update public.tmc_assets
    set status = 'В пути',
        updated_at = now(),
        history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'date', public.tmc_iso_now(),
            'action', 'Отправлено на ' || coalesce(p_to_wh_name, 'склад'),
            'warehouseId', src.warehouse_id,
            'responsibleId', src.responsible_id,
            'status', 'В пути',
            'by', p_actor,
            'notes', p_notes
          )
        )
    where id = p_asset_id;
  end if;

  perform public.tmc_append_asset_movement(
    p_asset_id, p_transfer_id, 'transfer_pending',
    p_qty, p_unit, p_to_wh_id, p_to_responsible_id, p_actor, p_notes
  );
end;
$$;

create or replace function public.tmc_confirm_transfer(
  p_transfer_id text,
  p_actor text
)
returns void
language plpgsql
as $$
declare
  tr public.tmc_transfers%rowtype;
  src public.tmc_assets%rowtype;
  existing public.tmc_assets%rowtype;
  new_asset_id text;
  target_asset_id text;
  caller public.tmc_users%rowtype;
begin
  select * into tr from public.tmc_transfers where id = p_transfer_id for update;
  if tr.id is null then
    raise exception 'Transfer not found: %', p_transfer_id;
  end if;
  if tr.status <> 'pending' then
    raise exception 'Передача % уже обработана (статус: %)', p_transfer_id, tr.status;
  end if;

  if auth.uid() is not null then
    select * into caller from public.tmc_users where auth_user_id = auth.uid() limit 1;
    if caller.id is null or caller.id <> tr.to_responsible_id then
      raise exception 'Подтвердить передачу может только назначенный получатель. Администратор только наблюдает.';
    end if;
  end if;

  select * into src from public.tmc_assets where id = tr.asset_id for update;
  if src.id is null then
    raise exception 'Source asset missing for transfer %', p_transfer_id;
  end if;

  update public.tmc_transfers
  set status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = p_actor
  where id = p_transfer_id;

  if tr.qty is not null then
    -- Quantity-based: add qty to an existing same-name asset at destination
    -- warehouse, or move/clone the asset row to the destination. If the
    -- source quantity is now 0 (full transfer), we do NOT keep a zombie row
    -- at the source: either the source row is moved to the destination
    -- (preserving its full history), or it is deleted after merging into
    -- an existing destination asset.
    select * into existing from public.tmc_assets
    where warehouse_id = tr.to_wh_id
      and name = src.name
      and id <> src.id
    limit 1;

    if existing.id is not null then
      update public.tmc_assets
      set qty = coalesce(qty, 0) + tr.qty,
          responsible_id = coalesce(tr.to_responsible_id, responsible_id),
          updated_at = now(),
          history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'date', public.tmc_iso_now(),
              'action', 'Получено (' || tr.qty::text || ' ' || coalesce(tr.unit, 'шт') || ')',
              'warehouseId', tr.to_wh_id,
              'responsibleId', coalesce(tr.to_responsible_id, existing.responsible_id),
              'qty', tr.qty,
              'status', 'На складе',
              'by', p_actor,
              'notes', tr.notes
            )
          )
      where id = existing.id;

      target_asset_id := existing.id;

      -- If the source was fully transferred AND no other pending transfer
      -- still references this source asset, remove its empty zombie row
      -- so the asset only exists at the destination. If another pending
      -- transfer exists, leave the zero-qty row; it will be cleaned up
      -- when that transfer is resolved.
      if coalesce(src.qty, 0) = 0
         and not exists (
           select 1 from public.tmc_transfers
           where asset_id = src.id
             and status = 'pending'
             and id <> tr.id
         ) then
        delete from public.tmc_assets where id = src.id;
      end if;
    else
      if coalesce(src.qty, 0) = 0 then
        -- Full transfer with no existing destination row: MOVE the source
        -- asset itself to the destination warehouse so history stays with
        -- the asset and nothing lingers at the source.
        update public.tmc_assets
        set warehouse_id = tr.to_wh_id,
            responsible_id = coalesce(tr.to_responsible_id, responsible_id),
            qty = tr.qty,
            status = 'На складе',
            updated_at = now(),
            history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'date', public.tmc_iso_now(),
                'action', 'Получено (' || tr.qty::text || ' ' || coalesce(tr.unit, 'шт') || ')',
                'warehouseId', tr.to_wh_id,
                'responsibleId', coalesce(tr.to_responsible_id, src.responsible_id),
                'qty', tr.qty,
                'status', 'На складе',
                'by', p_actor,
                'notes', tr.notes
              )
            )
        where id = src.id;
        target_asset_id := src.id;
      else
        new_asset_id := 'TMC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        insert into public.tmc_assets (
          id, name, category, supplier, purchase_date, price,
          responsible_id, notes, photo, unit, qty, min_qty, initial_qty,
          warehouse_id, status, history, pending_woqty
        ) values (
          new_asset_id, src.name, src.category, src.supplier, src.purchase_date, src.price,
          coalesce(tr.to_responsible_id, src.responsible_id), src.notes, src.photo, src.unit,
          tr.qty, src.min_qty, tr.qty,
          tr.to_wh_id, 'На складе',
          jsonb_build_array(
            jsonb_build_object(
              'date', public.tmc_iso_now(),
              'action', 'Получено (' || tr.qty::text || ' ' || coalesce(tr.unit, 'шт') || ')',
              'warehouseId', tr.to_wh_id,
              'responsibleId', tr.to_responsible_id,
              'qty', tr.qty,
              'status', 'На складе',
              'by', p_actor,
              'notes', tr.notes
            )
          ),
          null
        );
        target_asset_id := new_asset_id;
      end if;
    end if;
  else
    -- Single-unit: actually move the asset to the target warehouse.
    update public.tmc_assets
    set warehouse_id = tr.to_wh_id,
        responsible_id = coalesce(tr.to_responsible_id, responsible_id),
        status = 'На складе',
        updated_at = now(),
        history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'date', public.tmc_iso_now(),
            'action', 'Получено на ' || coalesce(tr.to_wh_name, 'склад'),
            'warehouseId', tr.to_wh_id,
            'responsibleId', coalesce(tr.to_responsible_id, src.responsible_id),
            'status', 'На складе',
            'by', p_actor,
            'notes', tr.notes
          )
        )
    where id = tr.asset_id;
    target_asset_id := tr.asset_id;
  end if;

  -- Log the movement against the asset that now represents the transferred
  -- items (destination-side), not the possibly-deleted source row.
  perform public.tmc_append_asset_movement(
    target_asset_id, tr.id, 'transfer_confirmed',
    tr.qty, tr.unit, tr.to_wh_id, tr.to_responsible_id, p_actor, tr.notes
  );
end;
$$;

-- Signature changed (added p_reason): drop the old two-arg version first.
drop function if exists public.tmc_reject_transfer(text, text);

create or replace function public.tmc_reject_transfer(
  p_transfer_id text,
  p_actor text,
  p_reason text
)
returns void
language plpgsql
as $$
declare
  tr public.tmc_transfers%rowtype;
  src public.tmc_assets%rowtype;
  reason_text text;
  caller public.tmc_users%rowtype;
begin
  reason_text := nullif(btrim(coalesce(p_reason, '')), '');
  if reason_text is null then
    raise exception 'Необходимо указать причину отклонения';
  end if;

  select * into tr from public.tmc_transfers where id = p_transfer_id for update;
  if tr.id is null then
    raise exception 'Transfer not found: %', p_transfer_id;
  end if;
  if tr.status <> 'pending' then
    raise exception 'Передача % уже обработана (статус: %)', p_transfer_id, tr.status;
  end if;

  if auth.uid() is not null then
    select * into caller from public.tmc_users where auth_user_id = auth.uid() limit 1;
    if caller.id is null or caller.id <> tr.to_responsible_id then
      raise exception 'Отклонить передачу может только назначенный получатель. Администратор только наблюдает.';
    end if;
  end if;

  select * into src from public.tmc_assets where id = tr.asset_id for update;

  update public.tmc_transfers
  set status = 'rejected',
      confirmed_at = now(),
      confirmed_by = p_actor,
      reject_reason = reason_text
  where id = p_transfer_id;

  if src.id is not null then
    if tr.qty is not null then
      update public.tmc_assets
      set qty = coalesce(qty, 0) + tr.qty,
          updated_at = now(),
          history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'date', public.tmc_iso_now(),
              'action', 'Отклонено (+ ' || tr.qty::text || ' ' || coalesce(tr.unit, 'шт') || ')',
              'warehouseId', src.warehouse_id,
              'responsibleId', src.responsible_id,
              'qty', tr.qty,
              'status', 'На складе',
              'by', p_actor,
              'notes', 'Причина: ' || reason_text
            )
          )
      where id = tr.asset_id;
    else
      update public.tmc_assets
      set status = 'На складе',
          updated_at = now(),
          history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'date', public.tmc_iso_now(),
              'action', 'Отклонено (возврат на ' || coalesce(tr.from_wh_name, 'склад') || ')',
              'warehouseId', src.warehouse_id,
              'responsibleId', src.responsible_id,
              'status', 'На складе',
              'by', p_actor,
              'notes', 'Причина: ' || reason_text
            )
          )
      where id = tr.asset_id;
    end if;
  end if;

  perform public.tmc_append_asset_movement(
    tr.asset_id, tr.id, 'transfer_rejected',
    tr.qty, tr.unit, tr.from_wh_id, tr.from_responsible_id, p_actor, reason_text
  );
end;
$$;

create or replace function public.tmc_request_writeoff(
  p_asset_id text,
  p_qty numeric,
  p_notes text,
  p_actor text
)
returns void
language plpgsql
as $$
declare
  a public.tmc_assets%rowtype;
begin
  select * into a from public.tmc_assets where id = p_asset_id for update;
  if a.id is null then
    raise exception 'Asset not found: %', p_asset_id;
  end if;
  if p_qty is not null and a.qty is not null and (p_qty <= 0 or p_qty > a.qty) then
    raise exception 'Invalid writeoff quantity';
  end if;

  update public.tmc_assets
  set status = 'На списание',
      pending_woqty = coalesce(p_qty, a.qty),
      updated_at = now(),
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'date', public.tmc_iso_now(),
          'action',
            case
              when p_qty is not null then
                'Запрос на списание (' || p_qty::text || ' ' || coalesce(a.unit, 'шт') || ')'
              else 'Запрос на списание'
            end,
          'warehouseId', a.warehouse_id,
          'responsibleId', a.responsible_id,
          'qty', coalesce(p_qty, a.qty),
          'status', 'На списание',
          'by', p_actor,
          'notes', p_notes
        )
      )
  where id = p_asset_id;

  perform public.tmc_append_asset_movement(
    p_asset_id,
    null,
    'writeoff_request',
    coalesce(p_qty, a.qty),
    a.unit,
    a.warehouse_id,
    a.responsible_id,
    p_actor,
    p_notes
  );
end;
$$;

create or replace function public.tmc_approve_writeoff(
  p_asset_id text,
  p_qty numeric,
  p_notes text,
  p_actor text
)
returns void
language plpgsql
as $$
declare
  a public.tmc_assets%rowtype;
  write_qty numeric;
  next_qty numeric;
begin
  select * into a from public.tmc_assets where id = p_asset_id for update;
  if a.id is null then
    raise exception 'Asset not found: %', p_asset_id;
  end if;

  write_qty := coalesce(p_qty, a.pending_woqty, a.qty, 0);
  if a.qty is not null and (write_qty <= 0 or write_qty > a.qty) then
    raise exception 'Invalid writeoff quantity';
  end if;

  next_qty := case when a.qty is null then null else greatest(a.qty - write_qty, 0) end;

  update public.tmc_assets
  set qty = next_qty,
      pending_woqty = null,
      status = case when next_qty is null or next_qty <= 0 then 'Списан' else 'На складе' end,
      updated_at = now(),
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'date', public.tmc_iso_now(),
          'action',
            case
              when a.qty is not null then
                'Списано (' || write_qty::text || ' ' || coalesce(a.unit, 'шт') || ')'
              else 'Списано'
            end,
          'warehouseId', a.warehouse_id,
          'responsibleId', a.responsible_id,
          'qty', write_qty,
          'status', case when next_qty is null or next_qty <= 0 then 'Списан' else 'На складе' end,
          'by', p_actor,
          'notes', p_notes
        )
      )
  where id = p_asset_id;

  perform public.tmc_append_asset_movement(
    p_asset_id,
    null,
    'writeoff_approved',
    write_qty,
    a.unit,
    a.warehouse_id,
    a.responsible_id,
    p_actor,
    p_notes
  );
end;
$$;

create or replace function public.tmc_reject_writeoff(
  p_asset_id text,
  p_actor text
)
returns void
language plpgsql
as $$
declare
  a public.tmc_assets%rowtype;
begin
  select * into a from public.tmc_assets where id = p_asset_id for update;
  if a.id is null then
    raise exception 'Asset not found: %', p_asset_id;
  end if;

  update public.tmc_assets
  set status = 'На складе',
      pending_woqty = null,
      updated_at = now(),
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'date', public.tmc_iso_now(),
          'action', 'Отклонено списание',
          'warehouseId', a.warehouse_id,
          'responsibleId', a.responsible_id,
          'status', 'На складе',
          'by', p_actor,
          'notes', 'Отклонено администратором'
        )
      )
  where id = p_asset_id;

  perform public.tmc_append_asset_movement(
    p_asset_id,
    null,
    'writeoff_rejected',
    a.pending_woqty,
    a.unit,
    a.warehouse_id,
    a.responsible_id,
    p_actor,
    'Отклонено администратором'
  );
end;
$$;

grant execute on function public.tmc_request_transfer(
  text, text, text, text, text, text, text, text, text, text, text, text, numeric, text, text, text
) to authenticated;

grant execute on function public.tmc_confirm_transfer(text, text) to authenticated;
grant execute on function public.tmc_reject_transfer(text, text, text) to authenticated;
grant execute on function public.tmc_request_writeoff(text, numeric, text, text) to authenticated;
grant execute on function public.tmc_approve_writeoff(text, numeric, text, text) to authenticated;
grant execute on function public.tmc_reject_writeoff(text, text) to authenticated;
grant execute on function public.tmc_set_user_warehouse_access(text, text[]) to authenticated;

-- Enable Supabase Realtime for core tables so clients get instant updates.
do $$
declare
  tbl text;
  tables text[] := array[
    'tmc_users',
    'tmc_warehouses',
    'tmc_assets',
    'tmc_transfers',
    'tmc_categories',
    'tmc_purchase_requests'
  ];
begin
  foreach tbl in array tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception
      when duplicate_object then null;
      when others then
        raise notice 'Could not add % to supabase_realtime: %', tbl, sqlerrm;
    end;
  end loop;
end;
$$;

-- Storage setup for asset photos.
insert into storage.buckets (id, name, public)
values ('asset-photos', 'asset-photos', true)
on conflict (id) do update
set public = excluded.public;

do $$
begin
  -- `storage.objects` is owned by a managed role on some Supabase setups.
  -- Skip RLS enablement when the current role is not the owner.
  begin
    alter table storage.objects enable row level security;
  exception
    when insufficient_privilege then
      raise notice 'Skipping RLS enable on storage.objects: current role is not table owner.';
  end;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'asset_photos_public_read'
  ) then
    create policy asset_photos_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'asset-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'asset_photos_auth_insert'
  ) then
    create policy asset_photos_auth_insert
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'asset-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'asset_photos_auth_update'
  ) then
    create policy asset_photos_auth_update
      on storage.objects
      for update
      to authenticated
      using (bucket_id = 'asset-photos')
      with check (bucket_id = 'asset-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'asset_photos_auth_delete'
  ) then
    create policy asset_photos_auth_delete
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'asset-photos');
  end if;
end;
$$;

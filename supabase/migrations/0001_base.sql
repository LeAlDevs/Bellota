-- 0001_base.sql — Organización, locales, perfiles, roles, permisos y RLS.
-- Append-only e idempotente. Correr en el SQL Editor de Supabase, en orden.
--
-- Nunca editar una migración ya entregada: si algo cambia, va una nueva.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Tablas núcleo
-- ─────────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- Los locales. El stock vive acá (no hay depósito aparte). Un depósito central
-- futuro entra como un store más con has_pos = false.
create table if not exists public.stores (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  email           text,
  has_pos         boolean not null default true,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.role_permissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id         uuid not null references public.roles(id) on delete cascade,
  module          text not null,
  can_view        boolean not null default false,
  can_edit        boolean not null default false,
  unique (role_id, module)
);

-- store_id: el local del usuario. VE los dos, OPERA el punto de venta del suyo.
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  role_id         uuid references public.roles(id) on delete set null,
  store_id        uuid references public.stores(id) on delete set null,
  full_name       text,
  email           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table public.profiles
  add column if not exists store_id uuid references public.stores(id) on delete set null;

-- ─────────────────────────────────────────────────────────────
-- Funciones de contexto
-- SECURITY DEFINER para que NO recursen contra profiles por RLS.
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and r.name = 'Administrador'
  );
$$;

/* El local del usuario actual, para gatear la operación del punto de venta. */
create or replace function public.current_store_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select store_id from public.profiles where id = auth.uid();
$$;

/* Devuelve { modulo: { view, edit } } para el usuario actual. */
create or replace function public.get_my_permissions()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(rp.module, jsonb_build_object('view', rp.can_view, 'edit', rp.can_edit)),
    '{}'::jsonb
  )
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid();
$$;

-- Bootstrap: cada usuario nuevo de Auth crea su profile en la (única) org.
-- El PRIMER usuario queda como Administrador; el resto entra sin rol y sin
-- local, y el layout le muestra "tu cuenta todavía no tiene rol".
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_org   uuid;
  v_role  uuid;
  v_first boolean;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  select count(*) = 0 into v_first from public.profiles;

  if v_first then
    select id into v_role from public.roles
      where organization_id = v_org and name = 'Administrador' limit 1;
  end if;

  insert into public.profiles (id, organization_id, role_id, email, full_name)
  values (new.id, v_org, v_role, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- RLS — toda tabla de negocio se filtra por organización
-- ─────────────────────────────────────────────────────────────
alter table public.organizations    enable row level security;
alter table public.stores           enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles         enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select
  using (id = public.current_org_id());

drop policy if exists stores_all on public.stores;
create policy stores_all on public.stores for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists roles_all on public.roles;
create policy roles_all on public.roles for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists role_permissions_all on public.role_permissions;
create policy role_permissions_all on public.role_permissions for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- profiles: ver los de mi org; editar solo el propio.
-- Cambiar el rol o el local de OTRO usuario se hace con la service-role key,
-- DESPUÉS del guard de permisos: con el cliente normal falla en silencio.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (organization_id = public.current_org_id());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Semilla
-- ─────────────────────────────────────────────────────────────
insert into public.organizations (name) values ('Distribuidora Ibérico')
  on conflict (name) do nothing;

insert into public.stores (organization_id, name, email, has_pos)
select o.id, s.name, s.email, true
from public.organizations o
cross join (values
  ('Ramos',    'ibericoramos@distribuidoraiberico.com.ar'),
  ('Mosconi',  'ibericomosconi@distribuidoraiberico.com.ar')
) as s(name, email)
where o.name = 'Distribuidora Ibérico'
  on conflict (organization_id, name) do update set email = excluded.email;

insert into public.roles (organization_id, name)
select o.id, r.name
from public.organizations o
cross join (values ('Administrador'), ('Encargado'), ('Cajero')) as r(name)
where o.name = 'Distribuidora Ibérico'
  on conflict (organization_id, name) do nothing;

-- Administrador: todo.
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, true, true
from public.roles r
cross join (values
  ('inicio'), ('pos'), ('caja'), ('ventas'), ('devoluciones'),
  ('stock'), ('compras'), ('produccion'), ('gastos'),
  ('productos'), ('precios'), ('reportes'), ('configuracion')
) as m(module)
where r.name = 'Administrador'
  on conflict (role_id, module)
  do update set can_view = excluded.can_view, can_edit = excluded.can_edit;

-- Encargado: opera todo el local, pero no toca la configuración del sistema.
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, true, m.edit
from public.roles r
cross join (values
  ('inicio', true), ('pos', true), ('caja', true), ('ventas', true),
  ('devoluciones', true), ('stock', true), ('compras', true),
  ('produccion', true), ('gastos', true), ('productos', true),
  ('precios', true), ('reportes', true), ('configuracion', false)
) as m(module, edit)
where r.name = 'Encargado'
  on conflict (role_id, module)
  do update set can_view = excluded.can_view, can_edit = excluded.can_edit;

-- Cajero: el mostrador y su caja. Consulta stock y precios, no los edita.
-- No ve gastos, compras, producción ni reportes: son plata y costo.
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, m.view, m.edit
from public.roles r
cross join (values
  ('inicio', true, false), ('pos', true, true), ('caja', true, true),
  ('ventas', true, false), ('devoluciones', false, false),
  ('stock', true, false), ('compras', false, false),
  ('produccion', false, false), ('gastos', false, false),
  ('productos', true, false), ('precios', false, false),
  ('reportes', false, false), ('configuracion', false, false)
) as m(module, view, edit)
where r.name = 'Cajero'
  on conflict (role_id, module)
  do update set can_view = excluded.can_view, can_edit = excluded.can_edit;

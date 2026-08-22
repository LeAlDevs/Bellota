-- 0002_reparar_alta_usuario.sql
--
-- Problema que arregla: el alta de perfil dependía SOLO del trigger sobre
-- auth.users, que actúa hacia adelante. Un usuario creado en el panel de
-- Supabase ANTES de correr 0001 queda en auth.users sin fila en profiles, y el
-- sistema le dice "tu cuenta todavía no tiene rol" para siempre, sin que haya
-- forma de arreglarlo desde la UI (porque para entrar a Configuración hace
-- falta ya tener rol).
--
-- Esta migración:
--   1. Vuelve a dejar el trigger en su lugar (por si 0001 se corrió a pedazos).
--   2. Rellena el perfil de todo usuario de Auth que no lo tenga.
--   3. Si NADIE es Administrador, se lo asigna al usuario más viejo.
--
-- Es idempotente: correrla de nuevo no cambia nada.

-- ─────────────────────────────────────────────────────────────
-- 1. Trigger de alta, más tolerante
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid;
  v_role uuid;
begin
  select id into v_org from public.organizations order by created_at limit 1;

  -- Administrador para el primero que llega. La pregunta correcta no es
  -- "¿es el primer perfil?" sino "¿ya hay alguien que pueda administrar?":
  -- si no lo hay, el sistema queda sin nadie que asigne roles.
  if not exists (
    select 1 from public.profiles p
    join public.roles r on r.id = p.role_id
    where r.name = 'Administrador'
  ) then
    select id into v_role from public.roles
      where organization_id = v_org and name = 'Administrador' limit 1;
  end if;

  insert into public.profiles (id, organization_id, role_id, email, full_name)
  values (new.id, v_org, v_role, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do update
    set organization_id = coalesce(public.profiles.organization_id, excluded.organization_id),
        email           = coalesce(public.profiles.email, excluded.email),
        full_name       = coalesce(public.profiles.full_name, excluded.full_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 2. Rellenar los perfiles que faltan
-- ─────────────────────────────────────────────────────────────
insert into public.profiles (id, organization_id, email, full_name)
select
  u.id,
  (select o.id from public.organizations o order by o.created_at limit 1),
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Un perfil que quedó sin organización (usuario creado antes que la org)
-- también hay que reengancharlo.
update public.profiles
set organization_id = (select o.id from public.organizations o order by o.created_at limit 1)
where organization_id is null;

-- ─────────────────────────────────────────────────────────────
-- 3. Garantizar que haya un Administrador
-- ─────────────────────────────────────────────────────────────
update public.profiles p
set role_id = (
  select r.id from public.roles r
  where r.name = 'Administrador'
    and r.organization_id = p.organization_id
  limit 1
)
where p.id = (
  -- el usuario de Auth más viejo
  select u.id from auth.users u
  join public.profiles pp on pp.id = u.id
  order by u.created_at
  limit 1
)
and not exists (
  select 1 from public.profiles p2
  join public.roles r2 on r2.id = p2.role_id
  where r2.name = 'Administrador'
);

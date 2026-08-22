-- 0003_productos.sql — Catálogo: categorías, productos, PLU, precios.
-- Incluye la plomería de stock (tablas + adjust_stock) porque la importación
-- inicial carga existencias; la UI de stock llega en la fase 2.
--
-- Append-only e idempotente.

-- ─────────────────────────────────────────────────────────────
-- Helper de permisos: la TERCERA capa de seguridad.
-- Las funciones de negocio la llaman antes de escribir nada.
-- ─────────────────────────────────────────────────────────────
create or replace function public.can_edit_module(p_module text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid() and rp.module = p_module and rp.can_edit
  );
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Categorías
-- ─────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- ─────────────────────────────────────────────────────────────
-- Productos
--
-- unit_type es la columna que gobierna todo el sistema: define si se pesa o se
-- cuenta, cómo se muestra la cantidad, qué imprime la balanza y cómo se cobra.
--
-- plu es el código corto de las balanzas. Único, estable y NUNCA reutilizado:
-- si se recicla, una etiqueta vieja escanea el producto equivocado.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  category_id     uuid references public.categories(id) on delete set null,
  unit_type       text not null default 'kg' check (unit_type in ('kg', 'unidad')),
  plu             integer not null,
  barcode         text,
  sku             text,
  kind            text not null default 'simple'
                    check (kind in ('simple', 'elaborado', 'combo')),
  price           numeric(12,2) not null default 0 check (price >= 0),
  cost            numeric(12,2) not null default 0 check (cost >= 0),
  track_expiry    boolean not null default false,
  shelf_life_days integer check (shelf_life_days is null or shelf_life_days > 0),
  min_stock       numeric(12,3) not null default 0 check (min_stock >= 0),
  is_active       boolean not null default true,
  -- Dormida: monotributo, no se discrimina IVA. Seguro por si algún día pasan
  -- a Responsable Inscripto. Sin UI.
  tax_rate        numeric(5,2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, plu)
);

create index if not exists products_org_active_idx on public.products (organization_id, is_active);
create index if not exists products_name_idx on public.products (organization_id, lower(name));
create index if not exists products_barcode_idx on public.products (organization_id, barcode) where barcode is not null;
create index if not exists products_category_idx on public.products (category_id);

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- Historial de precios: quién cambió qué y cuándo.
create table if not exists public.price_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  old_price       numeric(12,2),
  new_price       numeric(12,2) not null,
  reason          text,
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists price_history_product_idx on public.price_history (product_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- PLU: contador propio, para que un producto dado de baja no libere su número.
-- El update con returning toma el lock de la fila: dos altas simultáneas no
-- pueden sacar el mismo PLU.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.plu_counter (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_plu        integer not null default 999
);

insert into public.plu_counter (organization_id, last_plu)
select id, 999 from public.organizations
  on conflict (organization_id) do nothing;

create or replace function public.next_plu()
returns integer
language sql volatile security definer set search_path = public
as $$
  update public.plu_counter c
  set last_plu = greatest(
        c.last_plu,
        coalesce((select max(p.plu) from public.products p
                  where p.organization_id = c.organization_id), 0)
      ) + 1
  where c.organization_id = public.current_org_id()
  returning c.last_plu;
$$;

-- ─────────────────────────────────────────────────────────────
-- Stock (plomería; la UI llega en la fase 2)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.stock (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  qty             numeric(12,3) not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (store_id, product_id)
);

create index if not exists stock_product_idx on public.stock (product_id);

create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  delta           numeric(12,3) not null,
  reason          text not null check (reason in (
                    'alta_inicial', 'compra', 'venta', 'devolucion', 'ajuste',
                    'merma', 'vencimiento', 'transferencia_salida',
                    'transferencia_entrada', 'produccion_consumo',
                    'produccion_alta', 'despiece_consumo', 'despiece_alta',
                    'anulacion_venta')),
  ref_type        text,
  ref_id          uuid,
  unit_cost       numeric(12,2),
  note            text,
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);
create index if not exists stock_movements_store_idx
  on public.stock_movements (store_id, created_at desc);

/*
 * La ÚNICA puerta de entrada al stock. Ningún camino escribe la tabla directo:
 * las policies de `stock` y `stock_movements` son de solo lectura, así que ni
 * siquiera alguien que llame a la API a mano puede saltearse esto.
 *
 * El stock PUEDE quedar negativo a propósito: en el mostrador la mercadería ya
 * está en la mano del cliente, y bloquear la venta por un descuadre de carga
 * sería peor que registrar el negativo y que alguien lo audite después.
 */
create or replace function public.adjust_stock(
  p_store_id   uuid,
  p_product_id uuid,
  p_delta      numeric,
  p_reason     text,
  p_ref_type   text default null,
  p_ref_id     uuid default null,
  p_unit_cost  numeric default null,
  p_note       text default null
)
returns numeric
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_qty numeric(12,3);
begin
  if v_org is null then
    raise exception 'Sin organización: la sesión no tiene perfil.';
  end if;

  if not exists (select 1 from public.stores s
                 where s.id = p_store_id and s.organization_id = v_org) then
    raise exception 'El local no pertenece a esta organización.';
  end if;

  if not exists (select 1 from public.products p
                 where p.id = p_product_id and p.organization_id = v_org) then
    raise exception 'El producto no pertenece a esta organización.';
  end if;

  insert into public.stock (organization_id, store_id, product_id, qty)
  values (v_org, p_store_id, p_product_id, p_delta)
  on conflict (store_id, product_id)
    do update set qty = stock.qty + excluded.qty, updated_at = now()
  returning stock.qty into v_qty;

  insert into public.stock_movements (
    organization_id, store_id, product_id, delta, reason,
    ref_type, ref_id, unit_cost, note, user_id
  ) values (
    v_org, p_store_id, p_product_id, p_delta, p_reason,
    p_ref_type, p_ref_id, p_unit_cost, p_note, auth.uid()
  );

  return v_qty;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Alta y edición de productos
--
-- Van por función y no por INSERT/UPDATE directo por dos motivos:
--   1. El PLU se asigna solo y de forma atómica.
--   2. La policy de products es de SOLO LECTURA, así que el permiso de
--      edición se valida acá adentro y no se puede saltear llamando a la API.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_product(
  p_name            text,
  p_unit_type       text,
  p_price           numeric,
  p_category_id     uuid    default null,
  p_kind            text    default 'simple',
  p_cost            numeric default 0,
  p_min_stock       numeric default 0,
  p_track_expiry    boolean default false,
  p_shelf_life_days integer default null,
  p_barcode         text    default null,
  p_sku             text    default null,
  p_description     text    default null,
  p_plu             integer default null
)
returns public.products
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row public.products;
  v_plu integer;
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para dar de alta productos.';
  end if;

  v_plu := coalesce(p_plu, public.next_plu());

  insert into public.products (
    organization_id, name, description, category_id, unit_type, plu, kind,
    price, cost, min_stock, track_expiry, shelf_life_days, barcode, sku
  ) values (
    v_org, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    p_category_id, p_unit_type, v_plu, p_kind,
    p_price, coalesce(p_cost, 0), coalesce(p_min_stock, 0),
    coalesce(p_track_expiry, false), p_shelf_life_days,
    nullif(btrim(coalesce(p_barcode, '')), ''),
    nullif(btrim(coalesce(p_sku, '')), '')
  )
  returning * into v_row;

  insert into public.price_history (organization_id, product_id, old_price, new_price, reason, user_id)
  values (v_org, v_row.id, null, v_row.price, 'alta', auth.uid());

  return v_row;
end;
$$;

create or replace function public.update_product(
  p_id              uuid,
  p_name            text,
  p_unit_type       text,
  p_price           numeric,
  p_category_id     uuid    default null,
  p_kind            text    default 'simple',
  p_min_stock       numeric default 0,
  p_track_expiry    boolean default false,
  p_shelf_life_days integer default null,
  p_barcode         text    default null,
  p_sku             text    default null,
  p_description     text    default null,
  p_is_active       boolean default true,
  p_price_reason    text    default null
)
returns public.products
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  v_old_price numeric(12,2);
  v_row       public.products;
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para editar productos.';
  end if;

  select price into v_old_price from public.products
   where id = p_id and organization_id = v_org;

  if not found then
    raise exception 'Ese producto no existe.';
  end if;

  -- El costo NO se toca acá: es promedio ponderado y lo recalcula la recepción
  -- de compra. El PLU tampoco: es estable de por vida.
  update public.products set
    name            = btrim(p_name),
    description     = nullif(btrim(coalesce(p_description, '')), ''),
    category_id     = p_category_id,
    unit_type       = p_unit_type,
    kind            = p_kind,
    price           = p_price,
    min_stock       = coalesce(p_min_stock, 0),
    track_expiry    = coalesce(p_track_expiry, false),
    shelf_life_days = p_shelf_life_days,
    barcode         = nullif(btrim(coalesce(p_barcode, '')), ''),
    sku             = nullif(btrim(coalesce(p_sku, '')), ''),
    is_active       = coalesce(p_is_active, true)
  where id = p_id and organization_id = v_org
  returning * into v_row;

  if v_old_price is distinct from v_row.price then
    insert into public.price_history (organization_id, product_id, old_price, new_price, reason, user_id)
    values (v_org, v_row.id, v_old_price, v_row.price, p_price_reason, auth.uid());
  end if;

  return v_row;
end;
$$;

-- Categorías: mismo criterio, la policy es de solo lectura.
create or replace function public.upsert_category(p_id uuid, p_name text)
returns public.categories
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row public.categories;
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para editar categorías.';
  end if;

  if p_id is null then
    insert into public.categories (organization_id, name)
    values (v_org, btrim(p_name))
    returning * into v_row;
  else
    update public.categories set name = btrim(p_name)
    where id = p_id and organization_id = v_org
    returning * into v_row;

    if not found then
      raise exception 'Esa categoría no existe.';
    end if;
  end if;

  return v_row;
end;
$$;

/* Borrar una categoría deja sus productos sin categoría, no los borra. */
create or replace function public.delete_category(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para borrar categorías.';
  end if;

  delete from public.categories
   where id = p_id and organization_id = public.current_org_id();
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.categories      enable row level security;
alter table public.products        enable row level security;
alter table public.price_history   enable row level security;
alter table public.plu_counter     enable row level security;
alter table public.stock           enable row level security;
alter table public.stock_movements enable row level security;

-- Solo lectura: toda escritura pasa por las funciones de arriba.
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select
  using (organization_id = public.current_org_id());

drop policy if exists products_select on public.products;
create policy products_select on public.products for select
  using (organization_id = public.current_org_id());

drop policy if exists price_history_select on public.price_history;
create policy price_history_select on public.price_history for select
  using (organization_id = public.current_org_id());

drop policy if exists stock_select on public.stock;
create policy stock_select on public.stock for select
  using (organization_id = public.current_org_id());

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select
  using (organization_id = public.current_org_id());

-- plu_counter: RLS sin ninguna policy. Nadie lo lee ni lo escribe salvo
-- next_plu(), que es SECURITY DEFINER.

-- ─────────────────────────────────────────────────────────────
-- Semilla de categorías
-- ─────────────────────────────────────────────────────────────
insert into public.categories (organization_id, name)
select o.id, c.name
from public.organizations o
cross join (values
  ('Fiambres'), ('Quesos'), ('Elaborados'), ('Envasados'), ('Bebidas'), ('Otros')
) as c(name)
where o.name = 'Distribuidora Ibérico'
  on conflict (organization_id, name) do nothing;

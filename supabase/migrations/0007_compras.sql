-- 0007_compras.sql — Proveedores, recepción por peso real y costo promedio ponderado.
--
-- El documento que mueve stock y costo es la RECEPCIÓN, no el pedido: se piden
-- 10 kg y llegan 9,8. Lo que manda es lo que llegó y lo que pesó la balanza.

-- ─────────────────────────────────────────────────────────────
-- Proveedores
-- ─────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  cuit            text,
  phone           text,
  email           text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create unique index if not exists suppliers_name_uidx
  on public.suppliers (organization_id, lower(name));

-- ─────────────────────────────────────────────────────────────
-- Compras
--
-- Sin local en la cabecera: el destino va por línea. Llegan 20 kg de jamón y se
-- reparten 12 a Ramos y 8 a Mosconi, en la misma factura.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.purchases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id),
  received_on     date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  has_invoice     boolean not null default false,
  invoice_number  text,
  payment_terms   text not null default 'contado'
                    check (payment_terms in ('contado', 'cuenta_corriente')),
  total           numeric(14,2) not null default 0,
  note            text,
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists purchases_fecha_idx
  on public.purchases (organization_id, received_on desc);
create index if not exists purchases_supplier_idx
  on public.purchases (supplier_id, received_on desc);

create table if not exists public.purchase_items (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.purchases(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  qty_ordered  numeric(12,3),
  qty_received numeric(12,3) not null check (qty_received > 0),
  unit_cost    numeric(12,2) not null check (unit_cost >= 0),
  subtotal     numeric(14,2) not null
);

create index if not exists purchase_items_purchase_idx
  on public.purchase_items (purchase_id);
create index if not exists purchase_items_product_idx
  on public.purchase_items (product_id);

-- El reparto entre locales, por línea.
create table if not exists public.purchase_item_allocations (
  id               uuid primary key default gen_random_uuid(),
  purchase_item_id uuid not null references public.purchase_items(id) on delete cascade,
  store_id         uuid not null references public.stores(id),
  qty              numeric(12,3) not null check (qty > 0)
);

create index if not exists purchase_allocations_item_idx
  on public.purchase_item_allocations (purchase_item_id);

-- ─────────────────────────────────────────────────────────────
-- Cuenta corriente de proveedores
--
-- El dueño no vende fiado, pero a él SÍ le fían. La compra a cuenta corriente
-- suma deuda; el pago la baja (el pago llega en la fase de Pagos y gastos).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.supplier_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  kind            text not null check (kind in ('compra', 'pago', 'ajuste')),
  /* Positivo = aumenta la deuda con el proveedor. Negativo = la baja. */
  amount          numeric(14,2) not null,
  ref_type        text,
  ref_id          uuid,
  note            text,
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists supplier_movements_supplier_idx
  on public.supplier_movements (supplier_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- Alta y edición de proveedores
-- ─────────────────────────────────────────────────────────────
create or replace function public.upsert_supplier(
  p_id    uuid,
  p_name  text,
  p_cuit  text default null,
  p_phone text default null,
  p_email text default null,
  p_notes text default null,
  p_active boolean default true
)
returns public.suppliers
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row public.suppliers;
begin
  if not public.can_edit_module('compras') then
    raise exception 'No tenés permiso para editar proveedores.';
  end if;

  if p_id is null then
    insert into public.suppliers (organization_id, name, cuit, phone, email, notes, active)
    values (v_org, btrim(p_name),
            nullif(btrim(coalesce(p_cuit, '')), ''),
            nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_email, '')), ''),
            nullif(btrim(coalesce(p_notes, '')), ''),
            coalesce(p_active, true))
    returning * into v_row;
  else
    update public.suppliers set
      name   = btrim(p_name),
      cuit   = nullif(btrim(coalesce(p_cuit, '')), ''),
      phone  = nullif(btrim(coalesce(p_phone, '')), ''),
      email  = nullif(btrim(coalesce(p_email, '')), ''),
      notes  = nullif(btrim(coalesce(p_notes, '')), ''),
      active = coalesce(p_active, true)
    where id = p_id and organization_id = v_org
    returning * into v_row;

    if not found then
      raise exception 'Ese proveedor no existe.';
    end if;
  end if;

  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Recepción de compra: el corazón de la fase
-- ─────────────────────────────────────────────────────────────
/*
 * Recibe una compra entera en una transacción: guarda el documento, mete el
 * stock en cada local según el reparto, recalcula el costo promedio ponderado
 * y, si es a cuenta corriente, carga la deuda con el proveedor.
 *
 * Forma de p_items:
 *   [{ product_id, qty_ordered, qty_received, unit_cost,
 *      allocations: { "<store_id>": qty, ... } }, ...]
 *
 * Reglas que se validan acá adentro, no en la pantalla:
 *   - el reparto entre locales tiene que sumar exactamente lo recibido;
 *   - lo recibido tiene que ser mayor que cero.
 *
 * Sobre el promedio ponderado:
 *
 *   costo_nuevo = (stock_previo × costo_actual + recibido × costo_compra)
 *                 ÷ (stock_previo + recibido)
 *
 * El stock previo se lee ANTES de meter la mercadería nueva; si se leyera
 * después, el costo viejo se ponderaría con la cantidad nueva y el resultado
 * sería el costo de compra disfrazado de promedio.
 *
 * Y se toma `greatest(stock_previo, 0)`: si el stock estaba negativo (se vendió
 * más de lo que decía el sistema), ponderar con un negativo puede dar un costo
 * absurdo o hasta negativo. Con stock negativo, el costo de la compra nueva es
 * la mejor información que hay.
 */
create or replace function public.receive_purchase(
  p_supplier_id    uuid,
  p_received_on    date,
  p_has_invoice    boolean,
  p_invoice_number text,
  p_payment_terms  text,
  p_note           text,
  p_items          jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org        uuid := public.current_org_id();
  v_purchase   uuid;
  r            jsonb;
  v_item       uuid;
  v_product    uuid;
  v_name       text;
  v_recibido   numeric(12,3);
  v_pedido     numeric(12,3);
  v_costo      numeric(12,2);
  v_subtotal   numeric(14,2);
  v_total      numeric(14,2) := 0;
  v_store_key  text;
  v_store_val  text;
  v_asignado   numeric(12,3);
  v_stock_prev numeric(12,3);
  v_costo_ant  numeric(12,2);
  v_costo_new  numeric(12,2);
  v_lineas     integer := 0;
begin
  if not public.can_edit_module('compras') then
    raise exception 'No tenés permiso para registrar compras.';
  end if;

  if not exists (select 1 from public.suppliers
                 where id = p_supplier_id and organization_id = v_org) then
    raise exception 'Ese proveedor no existe.';
  end if;

  insert into public.purchases (
    organization_id, supplier_id, received_on, has_invoice, invoice_number,
    payment_terms, note, user_id
  ) values (
    v_org, p_supplier_id,
    coalesce(p_received_on, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
    coalesce(p_has_invoice, false),
    nullif(btrim(coalesce(p_invoice_number, '')), ''),
    coalesce(p_payment_terms, 'contado'),
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_purchase;

  for r in select value from jsonb_array_elements(p_items)
  loop
    v_product  := (r->>'product_id')::uuid;
    v_recibido := (r->>'qty_received')::numeric;
    v_pedido   := nullif(r->>'qty_ordered', '')::numeric;
    v_costo    := (r->>'unit_cost')::numeric;

    select p.name into v_name from public.products p
     where p.id = v_product and p.organization_id = v_org;
    if not found then
      raise exception 'Un producto de la compra no existe.';
    end if;

    if v_recibido is null or v_recibido <= 0 then
      raise exception 'La cantidad recibida de % tiene que ser mayor que cero.', v_name;
    end if;
    if v_costo is null or v_costo < 0 then
      raise exception 'El costo de % no es válido.', v_name;
    end if;

    -- El reparto tiene que cerrar con lo recibido, antes de tocar nada.
    v_asignado := 0;
    for v_store_key, v_store_val in
      select key, value from jsonb_each_text(coalesce(r->'allocations', '{}'::jsonb))
    loop
      if coalesce(btrim(v_store_val), '') <> '' then
        v_asignado := v_asignado + v_store_val::numeric;
      end if;
    end loop;

    if v_asignado <> v_recibido then
      raise exception
        'El reparto de % no cierra: llegaron % y estás repartiendo %.',
        v_name, v_recibido, v_asignado;
    end if;

    v_subtotal := round(v_recibido * v_costo, 2);
    v_total := v_total + v_subtotal;

    insert into public.purchase_items (
      purchase_id, product_id, qty_ordered, qty_received, unit_cost, subtotal
    ) values (
      v_purchase, v_product, v_pedido, v_recibido, v_costo, v_subtotal
    )
    returning id into v_item;

    -- Promedio ponderado: el stock previo se lee ANTES de sumar lo nuevo.
    select coalesce(sum(s.qty), 0) into v_stock_prev
      from public.stock s where s.product_id = v_product;

    select p.cost into v_costo_ant from public.products p where p.id = v_product;

    v_stock_prev := greatest(coalesce(v_stock_prev, 0), 0);

    if v_stock_prev + v_recibido > 0 then
      v_costo_new := round(
        (v_stock_prev * coalesce(v_costo_ant, 0) + v_recibido * v_costo)
        / (v_stock_prev + v_recibido), 2);
      update public.products set cost = v_costo_new where id = v_product;
    end if;

    -- Y ahora sí entra la mercadería, en cada local según su asignación.
    for v_store_key, v_store_val in
      select key, value from jsonb_each_text(coalesce(r->'allocations', '{}'::jsonb))
    loop
      if coalesce(btrim(v_store_val), '') <> '' and v_store_val::numeric > 0 then
        insert into public.purchase_item_allocations (purchase_item_id, store_id, qty)
        values (v_item, v_store_key::uuid, v_store_val::numeric);

        perform public.adjust_stock(
          v_store_key::uuid, v_product, v_store_val::numeric,
          'compra', 'purchase', v_purchase, v_costo
        );
      end if;
    end loop;

    v_lineas := v_lineas + 1;
  end loop;

  if v_lineas = 0 then
    raise exception 'La compra no tiene ninguna línea.';
  end if;

  update public.purchases set total = v_total where id = v_purchase;

  if coalesce(p_payment_terms, 'contado') = 'cuenta_corriente' then
    insert into public.supplier_movements (
      organization_id, supplier_id, kind, amount, ref_type, ref_id, note, user_id
    ) values (
      v_org, p_supplier_id, 'compra', v_total, 'purchase', v_purchase,
      'Compra a cuenta corriente', auth.uid()
    );
  end if;

  return v_purchase;
end;
$$;

/* Saldo con cada proveedor: positivo = le debemos. */
create or replace function public.supplier_balances()
returns table (supplier_id uuid, balance numeric)
language sql stable security definer set search_path = public
as $$
  select m.supplier_id, sum(m.amount)::numeric
    from public.supplier_movements m
   where m.organization_id = public.current_org_id()
   group by m.supplier_id;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.suppliers                 enable row level security;
alter table public.purchases                 enable row level security;
alter table public.purchase_items            enable row level security;
alter table public.purchase_item_allocations enable row level security;
alter table public.supplier_movements        enable row level security;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select
  using (organization_id = public.current_org_id());

drop policy if exists purchases_select on public.purchases;
create policy purchases_select on public.purchases for select
  using (organization_id = public.current_org_id());

drop policy if exists purchase_items_select on public.purchase_items;
create policy purchase_items_select on public.purchase_items for select
  using (exists (
    select 1 from public.purchases p
     where p.id = purchase_items.purchase_id
       and p.organization_id = public.current_org_id()
  ));

drop policy if exists purchase_allocations_select on public.purchase_item_allocations;
create policy purchase_allocations_select on public.purchase_item_allocations for select
  using (exists (
    select 1 from public.purchase_items i
      join public.purchases p on p.id = i.purchase_id
     where i.id = purchase_item_allocations.purchase_item_id
       and p.organization_id = public.current_org_id()
  ));

drop policy if exists supplier_movements_select on public.supplier_movements;
create policy supplier_movements_select on public.supplier_movements for select
  using (organization_id = public.current_org_id());

-- ─────────────────────────────────────────────────────────────
-- Permiso nuevo: 'compras' ya estaba declarado en 0001 para los tres roles.
-- Nada que agregar acá.
-- ─────────────────────────────────────────────────────────────

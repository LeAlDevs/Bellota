-- 0009_costo_manual_y_lotes.sql
--
-- Dos cambios pedidos por el dueño el 07/09/2026:
--
--   1. EL COSTO ES MANUAL. Deja de recalcularse solo con cada compra. El
--      sistema avisa cuando la factura trae un costo distinto al cargado, pero
--      no lo pisa: la decisión de cambiarlo es del dueño.
--
--   2. EL VENCIMIENTO VIVE EN EL LOTE, no en el producto. "Cuatro unidades, dos
--      que vencen en tres días y dos en una semana" son dos lotes del mismo
--      producto. Los días de vida útil del producto quedan solo como sugerencia
--      para prellenar la fecha cuando entra la mercadería.

-- ─────────────────────────────────────────────────────────────
-- 1. El costo vuelve a ser del dueño
-- ─────────────────────────────────────────────────────────────
/*
 * update_product ahora recibe el costo. Antes lo dejaba explícitamente afuera
 * porque lo manejaba el promedio ponderado; ahora es al revés.
 *
 * El riesgo de esto es real y conviene dejarlo escrito: si nadie actualiza el
 * costo, el margen miente y nadie se entera. Por eso la recepción de compra
 * compara y avisa, y el listado de productos marca los que quedaron
 * desactualizados. La cuenta la hace `product_cost_drift()`, más abajo.
 *
 * El DROP de abajo es obligatorio, por la misma razón que en 0006: agregar
 * p_cost cambia la firma, y `create or replace` con firma distinta NO
 * reemplaza — crea una sobrecarga. Con las dos vivas, cualquier llamada de 15
 * argumentos queda ambigua y el alta de productos se rompe entera.
 */
drop function if exists public.update_product(
  uuid, text, text, numeric, uuid, text, numeric, boolean, integer,
  text, text, text, boolean, text, integer
);

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
  p_price_reason    text    default null,
  p_plu             integer default null,
  p_cost            numeric default null
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

  update public.products set
    name            = btrim(p_name),
    description     = nullif(btrim(coalesce(p_description, '')), ''),
    category_id     = p_category_id,
    unit_type       = p_unit_type,
    kind            = p_kind,
    price           = p_price,
    plu             = p_plu,
    /* Si no viene costo, se deja el que estaba: así un llamador que solo quiere
       cambiar el nombre no lo pone en cero sin querer. */
    cost            = coalesce(p_cost, cost),
    min_stock       = coalesce(p_min_stock, 0),
    track_expiry    = coalesce(p_track_expiry, false),
    shelf_life_days = p_shelf_life_days,
    barcode         = nullif(btrim(coalesce(p_barcode, '')), ''),
    sku             = nullif(btrim(coalesce(p_sku, '')), ''),
    is_active       = coalesce(p_is_active, true)
  where id = p_id and organization_id = v_org
  returning * into v_row;

  update public.plu_counter c
     set last_plu = greatest(c.last_plu, coalesce(v_row.plu, 0))
   where c.organization_id = v_org;

  if v_old_price is distinct from v_row.price then
    insert into public.price_history (organization_id, product_id, old_price, new_price, reason, user_id)
    values (v_org, v_row.id, v_old_price, v_row.price, p_price_reason, auth.uid());
  end if;

  return v_row;
end;
$$;

/*
 * Cuánto se despegó el costo cargado del último costo de compra. Es lo que
 * reemplaza al recálculo automático: en vez de pisar el número, lo muestra.
 */
create or replace function public.product_cost_drift()
returns table (
  product_id   uuid,
  cost         numeric,
  last_cost    numeric,
  last_bought  date,
  drift_pct    numeric
)
language sql stable security definer set search_path = public
as $$
  with ultima as (
    select distinct on (i.product_id)
           i.product_id, i.unit_cost, p.received_on
      from public.purchase_items i
      join public.purchases p on p.id = i.purchase_id
     where p.organization_id = public.current_org_id()
     order by i.product_id, p.received_on desc, p.created_at desc
  )
  select pr.id, pr.cost, u.unit_cost, u.received_on,
         case when pr.cost > 0
              then round((u.unit_cost - pr.cost) / pr.cost * 100, 1)
              else null end
    from public.products pr
    join ultima u on u.product_id = pr.id
   where pr.organization_id = public.current_org_id()
     and pr.is_active
     and u.unit_cost is distinct from pr.cost;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. Lotes: acá vive el vencimiento
-- ─────────────────────────────────────────────────────────────
create table if not exists public.stock_lots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  /* La fecha es lo único que importa de verdad; el código es para el papel. */
  expires_on      date not null,
  code            text,
  qty_initial     numeric(12,3) not null check (qty_initial > 0),
  qty_remaining   numeric(12,3) not null check (qty_remaining >= 0),
  unit_cost       numeric(12,2),
  source          text not null default 'compra'
                    check (source in ('compra','produccion','alta_inicial','transferencia')),
  ref_type        text,
  ref_id          uuid,
  created_at      timestamptz not null default now()
);

create index if not exists stock_lots_vencimiento_idx
  on public.stock_lots (organization_id, expires_on)
  where qty_remaining > 0;
create index if not exists stock_lots_producto_idx
  on public.stock_lots (store_id, product_id, expires_on)
  where qty_remaining > 0;

/*
 * Descuenta de los lotes que vencen primero.
 *
 * El cajero NUNCA elige lote: con una fila esperando es inusable. El sistema lo
 * hace solo, del más viejo al más nuevo, y por eso lo que queda en cada lote se
 * mantiene honesto sin sumarle trabajo al mostrador.
 *
 * Si no alcanza (el stock puede quedar negativo), descuenta lo que hay y sigue:
 * los lotes son para avisar de vencimientos, no para llevar el stock. El stock
 * maestro sigue siendo la tabla `stock`.
 */
create or replace function public.deplete_lots(
  p_store_id   uuid,
  p_product_id uuid,
  p_qty        numeric
)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_falta numeric(12,3) := p_qty;
  r       record;
  v_toma  numeric(12,3);
begin
  if v_falta is null or v_falta <= 0 then return; end if;

  for r in
    select id, qty_remaining from public.stock_lots
     where store_id = p_store_id and product_id = p_product_id and qty_remaining > 0
     order by expires_on, created_at
  loop
    exit when v_falta <= 0;
    v_toma := least(r.qty_remaining, v_falta);
    update public.stock_lots set qty_remaining = qty_remaining - v_toma where id = r.id;
    v_falta := v_falta - v_toma;
  end loop;
end;
$$;

/*
 * adjust_stock, tercera versión: cuando sale mercadería de un producto que
 * lleva vencimiento, descuenta también de los lotes.
 *
 * Como cambia la firma (suma p_lot_id), va el drop por firma exacta: un
 * `create or replace` con firma distinta crea una sobrecarga y deja todas las
 * llamadas ambiguas.
 */
drop function if exists public.adjust_stock(uuid, uuid, numeric, text, text, uuid, numeric, text, text);

create or replace function public.adjust_stock(
  p_store_id   uuid,
  p_product_id uuid,
  p_delta      numeric,
  p_reason     text,
  p_ref_type   text default null,
  p_ref_id     uuid default null,
  p_unit_cost  numeric default null,
  p_note       text default null,
  p_motive     text default null,
  /* Cuando la salida es de un lote puntual (dar de baja lo vencido). */
  p_lot_id     uuid default null
)
returns numeric
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_qty    numeric(12,3);
  v_cost   numeric(12,2);
  v_expira boolean;
begin
  if v_org is null then
    raise exception 'Sin organización: la sesión no tiene perfil.';
  end if;

  if not exists (select 1 from public.stores s
                 where s.id = p_store_id and s.organization_id = v_org) then
    raise exception 'El local no pertenece a esta organización.';
  end if;

  select cost, track_expiry into v_cost, v_expira from public.products
   where id = p_product_id and organization_id = v_org;

  if not found then
    raise exception 'El producto no pertenece a esta organización.';
  end if;

  if p_reason = 'merma' and p_motive is null then
    raise exception 'Una merma necesita un motivo.';
  end if;

  insert into public.stock (organization_id, store_id, product_id, qty)
  values (v_org, p_store_id, p_product_id, p_delta)
  on conflict (store_id, product_id)
    do update set qty = stock.qty + excluded.qty, updated_at = now()
  returning stock.qty into v_qty;

  insert into public.stock_movements (
    organization_id, store_id, product_id, delta, reason,
    ref_type, ref_id, unit_cost, note, motive, user_id
  ) values (
    v_org, p_store_id, p_product_id, p_delta, p_reason,
    p_ref_type, p_ref_id, coalesce(p_unit_cost, v_cost), p_note, p_motive,
    auth.uid()
  );

  if v_expira and p_delta < 0 then
    if p_lot_id is not null then
      update public.stock_lots
         set qty_remaining = greatest(qty_remaining + p_delta, 0)
       where id = p_lot_id;
    else
      perform public.deplete_lots(p_store_id, p_product_id, -p_delta);
    end if;
  end if;

  return v_qty;
end;
$$;

/* Dar de baja un lote vencido: sale como merma con motivo `vencido`. */
create or replace function public.write_off_lot(p_lot_id uuid, p_note text default null)
returns numeric
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_lot public.stock_lots;
begin
  if not public.can_edit_module('stock') then
    raise exception 'No tenés permiso para dar de baja mercadería.';
  end if;

  select * into v_lot from public.stock_lots
   where id = p_lot_id and organization_id = public.current_org_id();
  if not found then
    raise exception 'Ese lote no existe.';
  end if;
  if v_lot.qty_remaining <= 0 then
    raise exception 'Ese lote ya está en cero.';
  end if;

  return public.adjust_stock(
    v_lot.store_id, v_lot.product_id, -v_lot.qty_remaining, 'merma',
    'lote', v_lot.id, v_lot.unit_cost,
    coalesce(p_note, 'Lote vencido el ' || to_char(v_lot.expires_on, 'DD/MM/YYYY')),
    'vencido', v_lot.id
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. La recepción: ya no toca el costo, pero sí crea el lote
-- ─────────────────────────────────────────────────────────────
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
  v_expira     boolean;
  v_vence      date;
  v_recibido   numeric(12,3);
  v_pedido     numeric(12,3);
  v_costo      numeric(12,2);
  v_subtotal   numeric(14,2);
  v_total      numeric(14,2) := 0;
  v_store_key  text;
  v_store_val  text;
  v_asignado   numeric(12,3);
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
    v_vence    := nullif(r->>'expires_on', '')::date;

    select p.name, p.track_expiry into v_name, v_expira
      from public.products p
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
    if v_expira and v_vence is null then
      raise exception '% lleva control de vencimiento: falta la fecha de vencimiento.', v_name;
    end if;

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

    /* NO se toca products.cost. El costo lo pone el dueño a mano; acá solo
       queda registrado a cuánto se compró, y la pantalla avisa si difiere. */

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

        /* Un lote por local: la misma compra puede vencer en dos góndolas. */
        if v_expira then
          insert into public.stock_lots (
            organization_id, store_id, product_id, expires_on, code,
            qty_initial, qty_remaining, unit_cost, source, ref_type, ref_id
          ) values (
            v_org, v_store_key::uuid, v_product, v_vence,
            nullif(btrim(coalesce(r->>'lot_code', '')), ''),
            v_store_val::numeric, v_store_val::numeric, v_costo,
            'compra', 'purchase', v_purchase
          );
        end if;
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

-- ─────────────────────────────────────────────────────────────
-- 4. La transferencia se lleva el vencimiento
-- ─────────────────────────────────────────────────────────────
/*
 * Si un producto vence, mandarlo al otro local sin su fecha lo vuelve
 * invisible para el aviso de vencimientos. Por eso la transferencia toma los
 * lotes del origen —los que vencen primero— y los recrea en el destino con la
 * misma fecha.
 */
create or replace function public.create_transfer(
  p_from_store uuid,
  p_to_store   uuid,
  p_items      jsonb,
  p_note       text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  v_transfer  uuid;
  r           jsonb;
  v_product   uuid;
  v_qty       numeric(12,3);
  v_available numeric(12,3);
  v_name      text;
  v_cost      numeric(12,2);
  v_expira    boolean;
  v_count     integer := 0;
  v_falta     numeric(12,3);
  v_toma      numeric(12,3);
  lote        record;
begin
  if not public.can_edit_module('stock') then
    raise exception 'No tenés permiso para transferir mercadería.';
  end if;
  if p_from_store = p_to_store then
    raise exception 'El origen y el destino son el mismo local.';
  end if;
  if not exists (select 1 from public.stores where id = p_from_store and organization_id = v_org)
     or not exists (select 1 from public.stores where id = p_to_store and organization_id = v_org) then
    raise exception 'Alguno de los locales no pertenece a esta organización.';
  end if;

  insert into public.transfers (organization_id, from_store_id, to_store_id, note, user_id)
  values (v_org, p_from_store, p_to_store, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_transfer;

  for r in select value from jsonb_array_elements(p_items)
  loop
    v_product := (r->>'product_id')::uuid;
    v_qty     := (r->>'qty')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Hay una línea con cantidad cero o negativa.';
    end if;

    select p.name, p.cost, p.track_expiry into v_name, v_cost, v_expira
      from public.products p
     where p.id = v_product and p.organization_id = v_org;
    if not found then
      raise exception 'Un producto de la lista no existe.';
    end if;

    select coalesce(qty, 0) into v_available from public.stock
     where store_id = p_from_store and product_id = v_product;
    v_available := coalesce(v_available, 0);

    if v_available < v_qty then
      raise exception 'No alcanza el stock de % en el origen: hay % y querés mandar %.',
        v_name, v_available, v_qty;
    end if;

    insert into public.transfer_items (transfer_id, product_id, qty, unit_cost)
    values (v_transfer, v_product, v_qty, v_cost);

    /* Los lotes viajan con su fecha. Se resuelve ANTES de descontar, porque
       adjust_stock ya descuenta los lotes del origen por su cuenta. */
    if v_expira then
      v_falta := v_qty;
      for lote in
        select id, expires_on, code, qty_remaining, unit_cost
          from public.stock_lots
         where store_id = p_from_store and product_id = v_product and qty_remaining > 0
         order by expires_on, created_at
      loop
        exit when v_falta <= 0;
        v_toma := least(lote.qty_remaining, v_falta);
        insert into public.stock_lots (
          organization_id, store_id, product_id, expires_on, code,
          qty_initial, qty_remaining, unit_cost, source, ref_type, ref_id
        ) values (
          v_org, p_to_store, v_product, lote.expires_on, lote.code,
          v_toma, v_toma, lote.unit_cost, 'transferencia', 'transfer', v_transfer
        );
        v_falta := v_falta - v_toma;
      end loop;
    end if;

    perform public.adjust_stock(p_from_store, v_product, -v_qty,
      'transferencia_salida', 'transfer', v_transfer, v_cost);
    perform public.adjust_stock(p_to_store, v_product, v_qty,
      'transferencia_entrada', 'transfer', v_transfer, v_cost);

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'La transferencia no tiene ninguna línea.';
  end if;

  return v_transfer;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.stock_lots enable row level security;

drop policy if exists stock_lots_select on public.stock_lots;
create policy stock_lots_select on public.stock_lots for select
  using (organization_id = public.current_org_id());

-- 0006_stock.sql — Ajustes, merma con motivo y transferencias entre locales.
--
-- Las tablas de stock y adjust_stock ya vienen de 0003 (las necesitaba la
-- importación). Acá va lo que falta para que el módulo Stock funcione entero.

-- ─────────────────────────────────────────────────────────────
-- Motivo de la merma
--
-- "Se perdieron 14 kg" no sirve para decidir nada. "Se perdieron 14 kg, el 62%
-- por vencimiento" dice si el problema es el proveedor, la heladera o el
-- mostrador. Por eso el motivo es obligatorio cuando la salida es merma.
-- ─────────────────────────────────────────────────────────────
alter table public.stock_movements
  add column if not exists motive text;

alter table public.stock_movements
  drop constraint if exists stock_movements_motive_check;

alter table public.stock_movements
  add constraint stock_movements_motive_check check (
    motive is null or motive in (
      'vencido', 'roto', 'mal_estado', 'degustacion', 'error_de_carga', 'robo'
    )
  );

/*
 * adjust_stock, segunda versión.
 *
 * Cambia una sola cosa importante: si el llamador no pasa el costo, lo toma
 * del producto. Antes cada llamador tenía que acordarse, y el que se olvidaba
 * dejaba un movimiento sin costo — con eso el reporte de merma puede decir
 * cuántos kilos se perdieron, pero no cuánta plata, que es la pregunta real.
 *
 * OJO con el DROP de abajo: `create or replace function` NO reemplaza cuando
 * cambia la firma, crea una SOBRECARGA. Como esta versión agrega el parámetro
 * p_motive, sin el drop quedarían dos adjust_stock conviviendo y toda llamada
 * de 8 argumentos se volvería ambigua ("function is not unique"), rompiendo
 * ventas, compras e importación de golpe. Hay que tirar la vieja por firma
 * exacta.
 */
drop function if exists public.adjust_stock(uuid, uuid, numeric, text, text, uuid, numeric, text);

create or replace function public.adjust_stock(
  p_store_id   uuid,
  p_product_id uuid,
  p_delta      numeric,
  p_reason     text,
  p_ref_type   text default null,
  p_ref_id     uuid default null,
  p_unit_cost  numeric default null,
  p_note       text default null,
  p_motive     text default null
)
returns numeric
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  v_qty  numeric(12,3);
  v_cost numeric(12,2);
begin
  if v_org is null then
    raise exception 'Sin organización: la sesión no tiene perfil.';
  end if;

  if not exists (select 1 from public.stores s
                 where s.id = p_store_id and s.organization_id = v_org) then
    raise exception 'El local no pertenece a esta organización.';
  end if;

  select cost into v_cost from public.products
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

  return v_qty;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Ajuste manual y merma, desde la pantalla
-- ─────────────────────────────────────────────────────────────
/*
 * Dos formas de tocar el stock a mano, con la misma puerta:
 *
 *   'merma'  → se perdió mercadería. p_qty es CUÁNTO se perdió (positivo) y el
 *              motivo es obligatorio.
 *   'conteo' → se contó la góndola. p_qty es CUÁNTO HAY, y el sistema calcula
 *              la diferencia. Es la forma honesta de ajustar: nadie sabe de
 *              memoria "me sobran 0,4"; sí sabe "hay 12,3".
 */
create or replace function public.register_stock_adjustment(
  p_store_id   uuid,
  p_product_id uuid,
  p_mode       text,
  p_qty        numeric,
  p_motive     text default null,
  p_note       text default null
)
returns numeric
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_current numeric(12,3);
  v_delta   numeric(12,3);
begin
  if not public.can_edit_module('stock') then
    raise exception 'No tenés permiso para ajustar el stock.';
  end if;

  if p_qty is null or p_qty < 0 then
    raise exception 'La cantidad no puede ser negativa.';
  end if;

  select coalesce(qty, 0) into v_current from public.stock
   where store_id = p_store_id and product_id = p_product_id;
  v_current := coalesce(v_current, 0);

  if p_mode = 'merma' then
    if p_motive is null then
      raise exception 'Elegí el motivo de la merma.';
    end if;
    if p_qty = 0 then
      raise exception 'Una merma de cero no se registra.';
    end if;
    return public.adjust_stock(
      p_store_id, p_product_id, -p_qty, 'merma', 'ajuste_manual', null, null,
      p_note, p_motive
    );

  elsif p_mode = 'conteo' then
    v_delta := p_qty - v_current;
    if v_delta = 0 then
      return v_current;   -- lo contado coincide: no se ensucia el historial
    end if;
    return public.adjust_stock(
      p_store_id, p_product_id, v_delta, 'ajuste', 'conteo', null, null,
      coalesce(p_note, 'Ajuste por conteo'), null
    );

  else
    raise exception 'Modo desconocido: %', p_mode;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Transferencias entre locales
-- ─────────────────────────────────────────────────────────────
create table if not exists public.transfers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_store_id   uuid not null references public.stores(id),
  to_store_id     uuid not null references public.stores(id),
  note            text,
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint transfers_distintos_locales check (from_store_id <> to_store_id)
);

create table if not exists public.transfer_items (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  qty         numeric(12,3) not null check (qty > 0),
  unit_cost   numeric(12,2)
);

create index if not exists transfers_created_idx
  on public.transfers (organization_id, created_at desc);
create index if not exists transfer_items_transfer_idx
  on public.transfer_items (transfer_id);

/*
 * Una transferencia es un solo acto: sale de un local y entra en el otro, en la
 * misma transacción. No hay estado "en tránsito".
 *
 * Es una decisión, no un olvido: son dos locales en la misma ciudad y la
 * mercadería la lleva alguien en el auto. Un circuito de despacho y recepción
 * agregaría dos pantallas y un estado más para cubrir un par de horas. Si algún
 * día hay un depósito central o un flete de terceros, ahí sí hace falta.
 *
 * A diferencia de la venta, ACÁ SÍ se bloquea por falta de stock: no se puede
 * mandar lo que no está.
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
  v_count     integer := 0;
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

    select p.name, p.cost into v_name, v_cost
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
-- RLS: lectura por organización; toda escritura pasa por las funciones.
-- ─────────────────────────────────────────────────────────────
alter table public.transfers      enable row level security;
alter table public.transfer_items enable row level security;

drop policy if exists transfers_select on public.transfers;
create policy transfers_select on public.transfers for select
  using (organization_id = public.current_org_id());

drop policy if exists transfer_items_select on public.transfer_items;
create policy transfer_items_select on public.transfer_items for select
  using (exists (
    select 1 from public.transfers t
     where t.id = transfer_items.transfer_id
       and t.organization_id = public.current_org_id()
  ));

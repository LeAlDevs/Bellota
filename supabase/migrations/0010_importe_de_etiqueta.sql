-- 0010_importe_de_etiqueta.sql
--
-- Corrige un error visto en la primera prueba de venta real (07/09/2026):
-- el ticket de la balanza decía $5.400 y el mostrador quería cobrar $5.377,20.
--
-- Por qué pasaba: de la etiqueta sale el IMPORTE, y el peso se reconstruye
-- dividiendo por el precio. Ese peso se redondea a 3 decimales (0,0985 → 0,098)
-- y después la línea se calculaba otra vez como cantidad × precio, con el peso
-- ya redondeado. La diferencia es chica, pero el cliente tiene el papel en la
-- mano: lo que se cobra tiene que ser lo que dice el ticket.
--
-- Desde acá, una línea puede traer su subtotal ya resuelto. La cantidad sigue
-- sirviendo para el stock; la plata la manda la etiqueta.

create or replace function public.create_sale(
  p_store_id    uuid,
  p_items       jsonb,
  p_payments    jsonb,
  p_is_fiscal   boolean default true,
  p_discount    numeric default 0,
  p_channel     text    default 'pos',
  p_scale_check text    default 'sin_balanza',
  p_email       text    default null,
  p_phone       text    default null,
  p_note        text    default null
)
returns public.sales
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  v_session   uuid;
  v_sale      public.sales;
  v_number    bigint;
  v_customer  uuid;
  r           jsonb;
  v_product   uuid;
  v_qty       numeric(12,3);
  v_price     numeric(12,2);
  v_cost      numeric(12,2);
  v_unit      text;
  v_name      text;
  v_subtotal  numeric(14,2) := 0;
  v_linea     numeric(14,2);
  v_base      numeric(14,2);
  v_surcharge numeric(14,2) := 0;
  v_pagado    numeric(14,2) := 0;
  v_method    uuid;
  v_amount    numeric(14,2);
  v_pct       numeric(5,2);
  v_cash      boolean;
  v_rec       numeric(14,2);
  v_lineas    integer := 0;
begin
  if not public.can_edit_module('pos') then
    raise exception 'No tenés permiso para vender.';
  end if;
  if not public.can_operate_store(p_store_id) then
    raise exception 'Solo podés vender en tu local.';
  end if;

  select id into v_session from public.cash_sessions
   where store_id = p_store_id and status = 'abierta';
  if v_session is null then
    raise exception 'No hay un turno de caja abierto en este local. Abrilo antes de vender.';
  end if;

  update public.sale_counter set last_number = last_number + 1
   where organization_id = v_org
  returning last_number into v_number;

  v_customer := public.find_or_create_customer(p_email, p_phone, null);

  insert into public.sales (
    organization_id, store_id, cash_session_id, user_id, number, is_fiscal,
    customer_id, channel, scale_check, note
  ) values (
    v_org, p_store_id, v_session, auth.uid(), v_number, coalesce(p_is_fiscal, true),
    v_customer, coalesce(p_channel, 'pos'), coalesce(p_scale_check, 'sin_balanza'),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning * into v_sale;

  for r in select value from jsonb_array_elements(p_items)
  loop
    v_product := (r->>'product_id')::uuid;
    v_qty     := (r->>'qty')::numeric;
    v_price   := (r->>'unit_price')::numeric;

    select p.name, p.cost, p.unit_type into v_name, v_cost, v_unit
      from public.products p
     where p.id = v_product and p.organization_id = v_org;
    if not found then
      raise exception 'Un producto de la venta no existe.';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'La cantidad de % tiene que ser mayor que cero.', v_name;
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'El precio de % no es válido.', v_name;
    end if;
    if v_unit = 'unidad' and v_qty <> trunc(v_qty) then
      raise exception '% se vende por unidad: no se puede vender %.', v_name, v_qty;
    end if;

    /* Si la línea trae su importe (viene de una etiqueta de balanza), manda
       ese: es el que el cliente leyó en el papel. Si no, se calcula. */
    v_linea := coalesce(
      nullif(r->>'subtotal', '')::numeric,
      round(v_qty * v_price, 2)
    );
    if v_linea < 0 then
      raise exception 'El importe de % no puede ser negativo.', v_name;
    end if;

    v_subtotal := v_subtotal + v_linea;

    insert into public.sale_items (
      sale_id, product_id, qty, unit_price, subtotal, cost_snapshot, source, scale_code
    ) values (
      v_sale.id, v_product, v_qty, v_price, v_linea, coalesce(v_cost, 0),
      coalesce(r->>'source', 'busqueda'),
      nullif(btrim(coalesce(r->>'scale_code', '')), '')
    );

    perform public.adjust_stock(
      p_store_id, v_product, -v_qty, 'venta', 'sale', v_sale.id, v_cost
    );

    v_lineas := v_lineas + 1;
  end loop;

  if v_lineas = 0 then
    raise exception 'La venta no tiene ninguna línea.';
  end if;

  v_base := round(v_subtotal - coalesce(p_discount, 0), 2);
  if v_base < 0 then
    raise exception 'El descuento es mayor que la venta.';
  end if;

  for r in select value from jsonb_array_elements(p_payments)
  loop
    v_method := (r->>'payment_method_id')::uuid;
    v_amount := (r->>'amount')::numeric;

    select pm.surcharge_pct, pm.affects_cash into v_pct, v_cash
      from public.payment_methods pm
     where pm.id = v_method and pm.organization_id = v_org and pm.active;
    if not found then
      raise exception 'Ese medio de pago no existe o está desactivado.';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Hay un pago en cero.';
    end if;

    v_rec := round(v_amount * v_pct / 100, 2);
    v_surcharge := v_surcharge + v_rec;
    v_pagado := v_pagado + v_amount;

    insert into public.sale_payments (
      sale_id, payment_method_id, amount, surcharge, affects_cash
    ) values (v_sale.id, v_method, v_amount, v_rec, v_cash);
  end loop;

  if abs(v_pagado - v_base) > 0.5 then
    raise exception 'Los pagos suman % y la venta es de %.', v_pagado, v_base;
  end if;

  update public.sales set
    subtotal  = v_subtotal,
    discount  = coalesce(p_discount, 0),
    surcharge = v_surcharge,
    total     = v_base + v_surcharge
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

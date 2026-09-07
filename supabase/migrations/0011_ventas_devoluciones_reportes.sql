-- 0011_ventas_devoluciones_reportes.sql — Devoluciones y los primeros reportes.
--
-- Con esto el Panel de ventas queda completo: ver qué se vendió, anular una
-- venta mal cobrada, devolver mercadería, y ver por fin el margen real por
-- producto con datos propios.

-- ─────────────────────────────────────────────────────────────
-- Devoluciones
--
-- Siempre contra una venta: sin la venta no se sabe a qué precio se cobró ni
-- cuál era el costo del momento, y el margen quedaría mal para siempre.
-- Sin cuenta corriente no hay saldo a favor: se devuelve plata del cajón.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.returns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id),
  sale_id         uuid not null references public.sales(id),
  cash_session_id uuid references public.cash_sessions(id),
  total           numeric(14,2) not null default 0,
  reason          text,
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists returns_sale_idx on public.returns (sale_id);
create index if not exists returns_fecha_idx
  on public.returns (organization_id, created_at desc);

create table if not exists public.return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references public.returns(id) on delete cascade,
  sale_item_id  uuid not null references public.sale_items(id),
  product_id    uuid not null references public.products(id),
  qty           numeric(12,3) not null check (qty > 0),
  unit_price    numeric(12,2) not null,
  subtotal      numeric(14,2) not null,
  cost_snapshot numeric(12,2) not null default 0
);

create index if not exists return_items_return_idx on public.return_items (return_id);
create index if not exists return_items_product_idx on public.return_items (product_id);

/* Cuánto se devolvió ya de cada línea de una venta. */
create or replace function public.returned_qty(p_sale_item_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(ri.qty), 0)
    from public.return_items ri
   where ri.sale_item_id = p_sale_item_id;
$$;

/*
 * Devuelve mercadería de una venta: repone el stock, saca la plata del cajón y
 * deja el rastro para que el margen del período se corrija solo.
 *
 * p_items: [{ sale_item_id, qty }, ...]
 *
 * El precio y el costo NO se vuelven a calcular: se copian de la línea de la
 * venta original. Si el precio subió entre la venta y la devolución, al cliente
 * hay que devolverle lo que pagó, no lo que vale hoy.
 */
create or replace function public.create_return(
  p_sale_id uuid,
  p_items   jsonb,
  p_reason  text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_sale     public.sales;
  v_session  uuid;
  v_return   uuid;
  r          jsonb;
  v_item     public.sale_items;
  v_qty      numeric(12,3);
  v_ya       numeric(12,3);
  v_nombre   text;
  v_linea    numeric(14,2);
  v_total    numeric(14,2) := 0;
  v_lineas   integer := 0;
begin
  if not public.can_edit_module('devoluciones') then
    raise exception 'No tenés permiso para registrar devoluciones.';
  end if;

  select * into v_sale from public.sales
   where id = p_sale_id and organization_id = v_org;
  if not found then
    raise exception 'Esa venta no existe.';
  end if;
  if v_sale.status = 'anulada' then
    raise exception 'Esa venta está anulada: no hay nada que devolver.';
  end if;
  if not public.can_operate_store(v_sale.store_id) then
    raise exception 'Solo podés devolver en tu local.';
  end if;

  /* La plata sale del cajón, así que hace falta un turno abierto. */
  select id into v_session from public.cash_sessions
   where store_id = v_sale.store_id and status = 'abierta';
  if v_session is null then
    raise exception 'No hay un turno de caja abierto: la devolución sale del cajón.';
  end if;

  insert into public.returns (
    organization_id, store_id, sale_id, cash_session_id, reason, user_id
  ) values (
    v_org, v_sale.store_id, p_sale_id, v_session,
    nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  )
  returning id into v_return;

  for r in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (r->>'qty')::numeric;

    select * into v_item from public.sale_items
     where id = (r->>'sale_item_id')::uuid and sale_id = p_sale_id;
    if not found then
      raise exception 'Una de las líneas no pertenece a esta venta.';
    end if;

    select name into v_nombre from public.products where id = v_item.product_id;

    if v_qty is null or v_qty <= 0 then
      raise exception 'La cantidad a devolver de % tiene que ser mayor que cero.', v_nombre;
    end if;

    v_ya := public.returned_qty(v_item.id);
    if v_ya + v_qty > v_item.qty + 0.0005 then
      raise exception
        'De % se vendieron % y ya se devolvieron %: no se pueden devolver % más.',
        v_nombre, v_item.qty, v_ya, v_qty;
    end if;

    /* Proporcional al importe cobrado, no cantidad × precio: si la línea vino
       de una etiqueta de balanza, el importe manda sobre la multiplicación. */
    v_linea := round(v_item.subtotal * (v_qty / v_item.qty), 2);
    v_total := v_total + v_linea;

    insert into public.return_items (
      return_id, sale_item_id, product_id, qty, unit_price, subtotal, cost_snapshot
    ) values (
      v_return, v_item.id, v_item.product_id, v_qty,
      v_item.unit_price, v_linea, v_item.cost_snapshot
    );

    perform public.adjust_stock(
      v_sale.store_id, v_item.product_id, v_qty, 'devolucion',
      'return', v_return, v_item.cost_snapshot
    );

    v_lineas := v_lineas + 1;
  end loop;

  if v_lineas = 0 then
    raise exception 'La devolución no tiene ninguna línea.';
  end if;

  update public.returns set total = v_total where id = v_return;

  /* La plata sale del cajón del turno y baja lo esperado en el arqueo. */
  insert into public.cash_movements (
    organization_id, cash_session_id, amount, kind, note, ref_type, ref_id, user_id
  ) values (
    v_org, v_session, -v_total, 'devolucion',
    'Devolución de la venta #' || v_sale.number, 'return', v_return, auth.uid()
  );

  return v_return;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Reportes
--
-- Todos netean las devoluciones: un reporte de margen que no las descuenta
-- miente justo en los productos que más problemas dan.
--
-- El corte por fecha va en hora de Buenos Aires, no en UTC. Si no, una venta
-- de las 21:30 cae en el día siguiente.
-- ─────────────────────────────────────────────────────────────
create or replace function public.report_sales_by_product(
  p_from        date,
  p_to          date,
  p_store       uuid    default null,
  p_only_fiscal boolean default false
)
returns table (
  product_id uuid,
  name       text,
  plu        integer,
  unit_type  text,
  qty        numeric,
  revenue    numeric,
  cost       numeric,
  margin     numeric,
  margin_pct numeric
)
language sql stable security definer set search_path = public
as $$
  with movimientos as (
    select si.product_id, si.qty, si.subtotal, si.qty * si.cost_snapshot as costo
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
     where s.organization_id = public.current_org_id()
       and s.status = 'completada'
       and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date
             between p_from and p_to
       and (p_store is null or s.store_id = p_store)
       and (not p_only_fiscal or s.is_fiscal)
    union all
    select ri.product_id, -ri.qty, -ri.subtotal, -ri.qty * ri.cost_snapshot
      from public.return_items ri
      join public.returns rt on rt.id = ri.return_id
      join public.sales s on s.id = rt.sale_id
     where rt.organization_id = public.current_org_id()
       and (rt.created_at at time zone 'America/Argentina/Buenos_Aires')::date
             between p_from and p_to
       and (p_store is null or rt.store_id = p_store)
       and (not p_only_fiscal or s.is_fiscal)
  )
  select p.id, p.name, p.plu, p.unit_type,
         sum(m.qty)::numeric,
         sum(m.subtotal)::numeric,
         sum(m.costo)::numeric,
         (sum(m.subtotal) - sum(m.costo))::numeric,
         case when sum(m.subtotal) > 0
              then round((sum(m.subtotal) - sum(m.costo)) / sum(m.subtotal) * 100, 1)
              else null end
    from movimientos m
    join public.products p on p.id = m.product_id
   group by p.id, p.name, p.plu, p.unit_type
  having sum(m.qty) <> 0
   order by sum(m.subtotal) desc;
$$;

/* Para dimensionar el mostrador: a qué hora entra la gente. */
create or replace function public.report_sales_by_hour(
  p_from  date,
  p_to    date,
  p_store uuid default null
)
returns table (hora integer, tickets bigint, revenue numeric)
language sql stable security definer set search_path = public
as $$
  select extract(hour from s.created_at at time zone 'America/Argentina/Buenos_Aires')::integer,
         count(*)::bigint,
         sum(s.total)::numeric
    from public.sales s
   where s.organization_id = public.current_org_id()
     and s.status = 'completada'
     and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date
           between p_from and p_to
     and (p_store is null or s.store_id = p_store)
   group by 1
   order by 1;
$$;

/* Resumen del período, para la cabecera del panel. */
create or replace function public.report_sales_summary(
  p_from        date,
  p_to          date,
  p_store       uuid    default null,
  p_only_fiscal boolean default false
)
returns table (
  tickets       bigint,
  revenue       numeric,
  cost          numeric,
  margin        numeric,
  margin_pct    numeric,
  avg_ticket    numeric,
  returned      numeric,
  cancelled     bigint
)
language sql stable security definer set search_path = public
as $$
  with v as (
    select s.id, s.total, s.is_fiscal,
           (select coalesce(sum(si.qty * si.cost_snapshot), 0)
              from public.sale_items si where si.sale_id = s.id) as costo
      from public.sales s
     where s.organization_id = public.current_org_id()
       and s.status = 'completada'
       and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date
             between p_from and p_to
       and (p_store is null or s.store_id = p_store)
       and (not p_only_fiscal or s.is_fiscal)
  ),
  d as (
    select coalesce(sum(rt.total), 0) as total
      from public.returns rt
     where rt.organization_id = public.current_org_id()
       and (rt.created_at at time zone 'America/Argentina/Buenos_Aires')::date
             between p_from and p_to
       and (p_store is null or rt.store_id = p_store)
  ),
  a as (
    select count(*)::bigint as n
      from public.sales s
     where s.organization_id = public.current_org_id()
       and s.status = 'anulada'
       and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date
             between p_from and p_to
       and (p_store is null or s.store_id = p_store)
  )
  select count(v.id)::bigint,
         coalesce(sum(v.total), 0) - d.total,
         coalesce(sum(v.costo), 0),
         coalesce(sum(v.total), 0) - d.total - coalesce(sum(v.costo), 0),
         case when coalesce(sum(v.total), 0) - d.total > 0
              then round((coalesce(sum(v.total), 0) - d.total - coalesce(sum(v.costo), 0))
                         / (coalesce(sum(v.total), 0) - d.total) * 100, 1)
              else null end,
         case when count(v.id) > 0
              then round(coalesce(sum(v.total), 0) / count(v.id), 2)
              else 0 end,
         d.total,
         a.n
    from v, d, a
   group by d.total, a.n;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.returns      enable row level security;
alter table public.return_items enable row level security;

drop policy if exists returns_select on public.returns;
create policy returns_select on public.returns for select
  using (organization_id = public.current_org_id());

drop policy if exists return_items_select on public.return_items;
create policy return_items_select on public.return_items for select
  using (exists (select 1 from public.returns rt
                  where rt.id = return_items.return_id
                    and rt.organization_id = public.current_org_id()));

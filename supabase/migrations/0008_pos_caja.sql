-- 0008_pos_caja.sql — Punto de venta, turno de caja y arqueo.
--
-- El circuito, cerrado con el dueño el 07/09/2026:
--   fraccionable  → balanza → ticket → el cajero lo escanea
--   no fraccionable → EAN de fábrica → el cajero escanea el paquete
--   los dos se juntan acá, en la venta.

-- ─────────────────────────────────────────────────────────────
-- Quién puede operar qué caja
--
-- Todos VEN los dos locales; cada uno OPERA el suyo. El administrador opera
-- los dos. Esto vive en la base y no solo en la pantalla: es la capa que no se
-- puede saltear llamando a la API.
-- ─────────────────────────────────────────────────────────────
create or replace function public.can_operate_store(p_store_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or (public.current_store_id() is not null
          and public.current_store_id() = p_store_id);
$$;

-- ─────────────────────────────────────────────────────────────
-- Medios de pago
-- ─────────────────────────────────────────────────────────────
create table if not exists public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  kind            text not null default 'otro'
                    check (kind in ('efectivo','debito','credito','qr','transferencia','otro')),
  surcharge_pct   numeric(5,2) not null default 0 check (surcharge_pct >= 0),
  /* El efectivo entra al cajón y cuenta en el arqueo. La tarjeta no. */
  affects_cash    boolean not null default false,
  sort_order      integer not null default 0,
  active          boolean not null default true,
  unique (organization_id, name)
);

-- ─────────────────────────────────────────────────────────────
-- Turno de caja
-- ─────────────────────────────────────────────────────────────
create table if not exists public.cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id),
  opened_by       uuid references auth.users(id) on delete set null,
  opened_at       timestamptz not null default now(),
  opening_float   numeric(14,2) not null default 0 check (opening_float >= 0),
  closed_by       uuid references auth.users(id) on delete set null,
  closed_at       timestamptz,
  /* Lo que el cajero contó del cajón al cerrar. */
  declared_cash   numeric(14,2),
  /* Lo que decía el sistema que tenía que haber. */
  expected_cash   numeric(14,2),
  difference      numeric(14,2),
  status          text not null default 'abierta' check (status in ('abierta','cerrada')),
  note            text
);

/* Un solo turno abierto por local a la vez. Sin esto, dos cajeros abren dos
   turnos y ninguna de las dos cajas cierra nunca. */
create unique index if not exists cash_sessions_una_abierta_idx
  on public.cash_sessions (store_id) where status = 'abierta';

create index if not exists cash_sessions_store_idx
  on public.cash_sessions (store_id, opened_at desc);

/* Retiros e ingresos que no son ventas. Los gastos pagados del cajón se
   enganchan acá cuando llegue el módulo de Pagos y gastos: por eso la tabla
   nace ahora, para no tener que reescribir el cierre después. */
create table if not exists public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_session_id uuid not null references public.cash_sessions(id) on delete cascade,
  /* Positivo entra al cajón, negativo sale. */
  amount          numeric(14,2) not null check (amount <> 0),
  kind            text not null check (kind in ('retiro','ingreso','gasto','devolucion')),
  note            text,
  ref_type        text,
  ref_id          uuid,
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists cash_movements_session_idx
  on public.cash_movements (cash_session_id);

-- ─────────────────────────────────────────────────────────────
-- Clientes (livianos: solo para el ticket y el marketing)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  name              text,
  email             text,
  phone             text,
  opt_in_marketing  boolean not null default false,
  created_at        timestamptz not null default now()
);

create unique index if not exists customers_email_uidx
  on public.customers (organization_id, lower(email)) where email is not null;
create unique index if not exists customers_phone_uidx
  on public.customers (organization_id, phone) where phone is not null;

-- ─────────────────────────────────────────────────────────────
-- Ventas
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sale_counter (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number     bigint not null default 0
);

insert into public.sale_counter (organization_id, last_number)
select id, 0 from public.organizations on conflict (organization_id) do nothing;

create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id),
  cash_session_id uuid references public.cash_sessions(id),
  user_id         uuid references auth.users(id) on delete set null,
  number          bigint not null,
  /* Monotributo: no se discrimina IVA. Esto separa blanco de negro, y las dos
     mueven stock y caja. Solo las fiscales van a facturación. */
  is_fiscal       boolean not null default true,
  customer_id     uuid references public.customers(id) on delete set null,
  subtotal        numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0 check (discount >= 0),
  surcharge       numeric(14,2) not null default 0 check (surcharge >= 0),
  total           numeric(14,2) not null default 0,
  status          text not null default 'completada' check (status in ('completada','anulada')),
  channel         text not null default 'pos' check (channel in ('pos','celular')),
  /* Si el ticket de balanza se contrastó contra su código de total. Se avisa
     pero no se bloquea: el papel se arruga y frenar la cola es peor. Queda
     registrado para poder mirarlo si aparece una diferencia de caja. */
  scale_check     text not null default 'sin_balanza'
                    check (scale_check in ('sin_balanza','verificado','sin_verificar')),
  note            text,
  created_at      timestamptz not null default now(),
  cancelled_by    uuid references auth.users(id) on delete set null,
  cancelled_at    timestamptz,
  unique (organization_id, number)
);

create index if not exists sales_store_fecha_idx
  on public.sales (store_id, created_at desc);
create index if not exists sales_session_idx on public.sales (cash_session_id);

create table if not exists public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  qty           numeric(12,3) not null check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  subtotal      numeric(14,2) not null,
  /* El costo del momento. Sin esto, el margen de una venta de marzo cambia
     cuando sube el costo en agosto. */
  cost_snapshot numeric(12,2) not null default 0,
  /* Cómo entró la línea. Sirve para saber si el escaneo está funcionando de
     verdad o si el mostrador terminó cargando todo a mano. */
  source        text not null default 'busqueda'
                  check (source in ('etiqueta','codigo','busqueda','manual')),
  /* El código crudo de la etiqueta, para poder auditar una venta rara. */
  scale_code    text
);

create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

create table if not exists public.sale_payments (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id),
  /* Lo que cubre de la venta, sin el recargo. */
  amount            numeric(14,2) not null check (amount > 0),
  surcharge         numeric(14,2) not null default 0 check (surcharge >= 0),
  affects_cash      boolean not null default false
);

create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);

-- ─────────────────────────────────────────────────────────────
-- Abrir y cerrar el turno
-- ─────────────────────────────────────────────────────────────
create or replace function public.open_cash_session(
  p_store_id uuid,
  p_float    numeric
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_id  uuid;
begin
  if not public.can_edit_module('caja') then
    raise exception 'No tenés permiso para abrir la caja.';
  end if;
  if not public.can_operate_store(p_store_id) then
    raise exception 'Solo podés operar la caja de tu local.';
  end if;
  if exists (select 1 from public.cash_sessions
             where store_id = p_store_id and status = 'abierta') then
    raise exception 'Ya hay un turno abierto en ese local. Cerralo antes de abrir otro.';
  end if;

  insert into public.cash_sessions (organization_id, store_id, opened_by, opening_float)
  values (v_org, p_store_id, auth.uid(), coalesce(p_float, 0))
  returning id into v_id;

  return v_id;
end;
$$;

/*
 * Lo que TIENE que haber en el cajón:
 *
 *   fondo inicial
 * + lo cobrado en efectivo (medios con affects_cash)
 * + ingresos varios
 * − retiros, gastos pagados del cajón y devoluciones en efectivo
 *
 * Las ventas anuladas no cuentan: si se anuló, la plata volvió.
 */
create or replace function public.expected_cash(p_session_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(s.opening_float, 0)
       + coalesce((
           select sum(sp.amount + sp.surcharge)
             from public.sale_payments sp
             join public.sales sa on sa.id = sp.sale_id
            where sa.cash_session_id = p_session_id
              and sa.status = 'completada'
              and sp.affects_cash
         ), 0)
       + coalesce((
           select sum(cm.amount) from public.cash_movements cm
            where cm.cash_session_id = p_session_id
         ), 0)
    from public.cash_sessions s
   where s.id = p_session_id;
$$;

create or replace function public.close_cash_session(
  p_session_id uuid,
  p_declared   numeric,
  p_note       text default null
)
returns public.cash_sessions
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row      public.cash_sessions;
  v_esperado numeric(14,2);
begin
  if not public.can_edit_module('caja') then
    raise exception 'No tenés permiso para cerrar la caja.';
  end if;

  select * into v_row from public.cash_sessions
   where id = p_session_id and organization_id = public.current_org_id();

  if not found then
    raise exception 'Ese turno no existe.';
  end if;
  if v_row.status = 'cerrada' then
    raise exception 'Ese turno ya está cerrado.';
  end if;
  if not public.can_operate_store(v_row.store_id) then
    raise exception 'Solo podés cerrar la caja de tu local.';
  end if;
  if p_declared is null or p_declared < 0 then
    raise exception 'Contá el cajón: el declarado no puede quedar vacío.';
  end if;

  v_esperado := public.expected_cash(p_session_id);

  update public.cash_sessions set
    status        = 'cerrada',
    closed_by     = auth.uid(),
    closed_at     = now(),
    declared_cash = p_declared,
    expected_cash = v_esperado,
    difference    = p_declared - v_esperado,
    note          = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_session_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.register_cash_movement(
  p_session_id uuid,
  p_amount     numeric,
  p_kind       text,
  p_note       text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_store uuid;
  v_id    uuid;
begin
  if not public.can_edit_module('caja') then
    raise exception 'No tenés permiso para mover la caja.';
  end if;

  select store_id into v_store from public.cash_sessions
   where id = p_session_id and status = 'abierta'
     and organization_id = public.current_org_id();

  if not found then
    raise exception 'No hay un turno abierto con ese identificador.';
  end if;
  if not public.can_operate_store(v_store) then
    raise exception 'Solo podés mover la caja de tu local.';
  end if;

  insert into public.cash_movements (
    organization_id, cash_session_id, amount, kind, note, user_id
  ) values (
    public.current_org_id(), p_session_id, p_amount, p_kind,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Cliente liviano
-- ─────────────────────────────────────────────────────────────
create or replace function public.find_or_create_customer(
  p_email text,
  p_phone text,
  p_name  text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_id    uuid;
begin
  if v_email is null and v_phone is null then
    return null;
  end if;

  if v_email is not null then
    select id into v_id from public.customers
     where organization_id = v_org and lower(email) = v_email;
  end if;
  if v_id is null and v_phone is not null then
    select id into v_id from public.customers
     where organization_id = v_org and phone = v_phone;
  end if;

  if v_id is null then
    insert into public.customers (organization_id, name, email, phone)
    values (v_org, nullif(btrim(coalesce(p_name, '')), ''), v_email, v_phone)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- La venta
-- ─────────────────────────────────────────────────────────────
/*
 * Cobra una venta entera en una transacción: numera, descuenta stock, guarda el
 * costo del momento de cada línea y registra los pagos.
 *
 * p_items:    [{ product_id, qty, unit_price, source, scale_code }, ...]
 * p_payments: [{ payment_method_id, amount }, ...]
 *
 * Dos reglas que valen la pena explicar:
 *
 * 1. El stock PUEDE quedar negativo. En el mostrador la mercadería ya está en
 *    la mano del cliente: frenar la venta por un descuadre de carga es peor que
 *    registrar el negativo y que alguien lo audite. Al revés que la
 *    transferencia, donde sí se bloquea.
 *
 * 2. El precio lo manda el llamador, no se lee del producto. El cliente ya vio
 *    un precio en el ticket de la balanza y hay que cobrarle ese. Igual queda
 *    guardado el costo del momento, así el margen es real.
 */
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

  -- ── Líneas ────────────────────────────────────────────────
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
    /* Lo que se cuenta por unidad no se puede vender en fracciones. */
    if v_unit = 'unidad' and v_qty <> trunc(v_qty) then
      raise exception '% se vende por unidad: no se puede vender %.', v_name, v_qty;
    end if;

    v_linea := round(v_qty * v_price, 2);
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

  -- ── Pagos ─────────────────────────────────────────────────
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

  /* Los pagos cubren la venta SIN el recargo: el recargo se suma arriba. Se
     admite medio peso de diferencia por el redondeo de repartir entre medios. */
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

/*
 * Anular repone el stock y deja la venta marcada. No se borra: una venta
 * borrada es una venta que nadie puede auditar.
 */
create or replace function public.cancel_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_sale public.sales;
  r      record;
begin
  if not public.is_admin() then
    raise exception 'Anular una venta está reservado a un administrador.';
  end if;

  select * into v_sale from public.sales
   where id = p_sale_id and organization_id = public.current_org_id();
  if not found then
    raise exception 'Esa venta no existe.';
  end if;
  if v_sale.status = 'anulada' then
    raise exception 'Esa venta ya está anulada.';
  end if;

  for r in select product_id, qty, cost_snapshot from public.sale_items
            where sale_id = p_sale_id
  loop
    perform public.adjust_stock(
      v_sale.store_id, r.product_id, r.qty, 'anulacion_venta',
      'sale', p_sale_id, r.cost_snapshot
    );
  end loop;

  update public.sales set
    status       = 'anulada',
    cancelled_by = auth.uid(),
    cancelled_at = now(),
    note         = coalesce(note || ' · ', '') || coalesce(nullif(btrim(coalesce(p_reason,'')),''), 'Anulada')
  where id = p_sale_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS: lectura por organización, escritura solo por función
-- ─────────────────────────────────────────────────────────────
alter table public.payment_methods enable row level security;
alter table public.cash_sessions   enable row level security;
alter table public.cash_movements  enable row level security;
alter table public.customers       enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.sale_payments   enable row level security;
alter table public.sale_counter    enable row level security;

drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select on public.payment_methods for select
  using (organization_id = public.current_org_id());

drop policy if exists cash_sessions_select on public.cash_sessions;
create policy cash_sessions_select on public.cash_sessions for select
  using (organization_id = public.current_org_id());

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements for select
  using (organization_id = public.current_org_id());

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select
  using (organization_id = public.current_org_id());

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select
  using (organization_id = public.current_org_id());

drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items for select
  using (exists (select 1 from public.sales s
                  where s.id = sale_items.sale_id
                    and s.organization_id = public.current_org_id()));

drop policy if exists sale_payments_select on public.sale_payments;
create policy sale_payments_select on public.sale_payments for select
  using (exists (select 1 from public.sales s
                  where s.id = sale_payments.sale_id
                    and s.organization_id = public.current_org_id()));

-- sale_counter: RLS sin policy. Solo lo toca create_sale, que es definer.

-- ─────────────────────────────────────────────────────────────
-- Semilla de medios de pago
-- ─────────────────────────────────────────────────────────────
insert into public.payment_methods
  (organization_id, name, kind, affects_cash, sort_order)
select o.id, m.name, m.kind, m.cash, m.orden
from public.organizations o
cross join (values
  ('Efectivo',      'efectivo',      true,  1),
  ('Débito',        'debito',        false, 2),
  ('Crédito',       'credito',       false, 3),
  ('QR / Mercado Pago', 'qr',        false, 4),
  ('Transferencia', 'transferencia', false, 5)
) as m(name, kind, cash, orden)
where o.name = 'Distribuidora Ibérico'
  on conflict (organization_id, name) do nothing;

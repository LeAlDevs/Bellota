-- 0012_presentaciones.sql — Un producto, varias formas de venderlo.
--
-- QUÉ DESCUBRIMOS
-- El mismo queso vale distinto según cómo se lo lleven: fraccionado tiene un
-- precio y la horma entera tiene otro, más barato por kilo. No es un descuento
-- por cantidad: 3 kg feteados NO tienen el precio de horma, porque ahí sí hay
-- merma de puntas y trabajo de fetear. Es otra forma de vender la misma
-- mercadería.
--
-- QUÉ ESTABA MAL
-- La cadena era PLU → producto → precio, uno a uno: `products.plu` único y
-- `products.price` una sola columna. El POS hace literalmente eso: lee el PLU
-- de la etiqueta, busca el producto y saca los kilos con importe ÷ price.
-- La horma no rompe el primer eslabón (es el mismo queso, el mismo stock, el
-- mismo costo), rompe el último.
--
-- LO QUE NO SE HIZO, Y POR QUÉ
-- Duplicar el producto ("Sardo" y "Sardo horma") es lo más rápido y es una
-- trampa: dos stocks del mismo queso que habría que transferir a mano cada vez
-- que se abre una horma, dos costos que hay que acordarse de cambiar juntos, y
-- un reporte de margen partido en dos líneas donde ninguna contesta "¿cuánto me
-- deja el sardo?".
--
-- LO QUE SE HIZO
-- El PLU y el precio se MUDAN de `products` a `product_presentations`. Un
-- producto tiene N presentaciones; cada una lleva su PLU y su $/kg. Todas
-- descuentan del mismo stock, con el mismo costo y los mismos lotes.
--
-- El PLU se muda entero a propósito. Si viviera en dos tablas haría falta un
-- trigger en cada una para garantizar que no se repita, y un PLU repetido es
-- exactamente el bug que hace que una etiqueta escanee el producto equivocado.
-- En una sola tabla lo resuelve un unique index y no hay nada que recordar.
--
-- El `barcode` NO se muda: un código de fábrica identifica un envase físico, y
-- un producto fraccionable no tiene envase. Si algún día hay una "caja x12" con
-- su propio EAN, es otra discusión.

-- ─────────────────────────────────────────────────────────────
-- 1. La tabla
-- ─────────────────────────────────────────────────────────────
create table if not exists public.product_presentations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  /* "Fraccionado", "Horma entera", "Media horma". */
  name            text not null,
  /* El PLU que tiene cargado la balanza para ESTE precio. Nullable igual que
     antes: un envasado que no pasa por balanza no tiene PLU. */
  plu             integer,
  price           numeric(12,2) not null default 0 check (price >= 0),
  /* Desde cuánto tiene sentido. Una horma no son 200 g: si entra una etiqueta
     con el PLU de horma por debajo del mínimo, el mostrador avisa. No bloquea:
     frenar la cola por un papel es peor, y queda registrado igual. */
  min_qty         numeric(12,3) check (min_qty is null or min_qty > 0),
  /* La que se usa cuando el producto se agrega por búsqueda o por código de
     fábrica. Siempre hay exactamente una por producto. */
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists product_presentations_product_idx
  on public.product_presentations (product_id);

/* La garantía que justifica mudar el PLU a una sola tabla. */
create unique index if not exists product_presentations_plu_uidx
  on public.product_presentations (organization_id, plu)
  where plu is not null;

/* Exactamente una presentación por defecto por producto. */
create unique index if not exists product_presentations_default_uidx
  on public.product_presentations (product_id)
  where is_default;

drop trigger if exists product_presentations_updated_at on public.product_presentations;
create trigger product_presentations_updated_at
  before update on public.product_presentations
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. Mudanza de los datos que ya están cargados
-- ─────────────────────────────────────────────────────────────
insert into public.product_presentations (
  organization_id, product_id, name, plu, price, is_default, is_active, sort_order
)
select p.organization_id, p.id,
       case when p.unit_type = 'kg' then 'Fraccionado' else 'Unidad' end,
       p.plu, p.price, true, true, 0
  from public.products p
 where not exists (
   select 1 from public.product_presentations pp where pp.product_id = p.id
 );

-- Recién ahora se pueden sacar las columnas viejas: los datos ya están del
-- otro lado.
drop index if exists public.products_plu_uidx;
alter table public.products drop column if exists plu;
alter table public.products drop column if exists price;

-- ─────────────────────────────────────────────────────────────
-- 3. Rastro: qué presentación se cobró y a qué presentación cambió el precio
-- ─────────────────────────────────────────────────────────────
alter table public.sale_items
  add column if not exists presentation_id uuid references public.product_presentations(id);

/* on delete cascade: solo se puede borrar una presentación que nunca se
   vendió, y el historial de precios de algo que nunca se vendió no le sirve a
   nadie. Lo que sí tiene ventas se desactiva, no se borra. */
alter table public.price_history
  add column if not exists presentation_id uuid
    references public.product_presentations(id) on delete cascade;

update public.price_history h
   set presentation_id = pp.id
  from public.product_presentations pp
 where pp.product_id = h.product_id
   and pp.is_default
   and h.presentation_id is null;

-- ─────────────────────────────────────────────────────────────
-- 4. El contador de PLU mira la tabla nueva
-- ─────────────────────────────────────────────────────────────
create or replace function public.next_plu()
returns integer
language sql volatile security definer set search_path = public
as $$
  update public.plu_counter c
  set last_plu = greatest(
        c.last_plu,
        coalesce((select max(pp.plu) from public.product_presentations pp
                  where pp.organization_id = c.organization_id), 0)
      ) + 1
  where c.organization_id = public.current_org_id()
  returning c.last_plu;
$$;

create or replace function public.suggest_plu()
returns integer
language sql stable security definer set search_path = public
as $$
  select greatest(
    coalesce((select c.last_plu from public.plu_counter c
               where c.organization_id = public.current_org_id()), 999),
    coalesce((select max(pp.plu) from public.product_presentations pp
               where pp.organization_id = public.current_org_id()), 0)
  ) + 1;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. Alta y edición de presentaciones
-- ─────────────────────────────────────────────────────────────
/*
 * Crea o edita una presentación. Con p_id null, la crea.
 *
 * La presentación por defecto no se marca acá: se cambia con
 * `set_default_presentation`, que se ocupa de desmarcar la anterior.
 */
create or replace function public.upsert_presentation(
  p_id         uuid,
  p_product_id uuid,
  p_name       text,
  p_price      numeric,
  p_plu        integer default null,
  p_min_qty    numeric default null,
  p_sort_order integer default 0,
  p_is_active  boolean default true,
  p_reason     text    default null
)
returns public.product_presentations
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  v_row       public.product_presentations;
  v_old_price numeric(12,2);
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para editar presentaciones.';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'La presentación necesita un nombre.';
  end if;

  if not exists (
    select 1 from public.products
     where id = p_product_id and organization_id = v_org
  ) then
    raise exception 'Ese producto no existe.';
  end if;

  if p_id is null then
    insert into public.product_presentations (
      organization_id, product_id, name, plu, price, min_qty, sort_order, is_active
    ) values (
      v_org, p_product_id, btrim(p_name), p_plu, coalesce(p_price, 0),
      nullif(p_min_qty, 0), coalesce(p_sort_order, 0), coalesce(p_is_active, true)
    )
    returning * into v_row;

    insert into public.price_history (
      organization_id, product_id, presentation_id, old_price, new_price, reason, user_id
    ) values (v_org, p_product_id, v_row.id, null, v_row.price, coalesce(p_reason, 'alta'), auth.uid());
  else
    select price into v_old_price from public.product_presentations
     where id = p_id and organization_id = v_org;
    if not found then
      raise exception 'Esa presentación no existe.';
    end if;

    update public.product_presentations set
      name       = btrim(p_name),
      plu        = p_plu,
      price      = coalesce(p_price, 0),
      min_qty    = nullif(p_min_qty, 0),
      sort_order = coalesce(p_sort_order, sort_order),
      is_active  = coalesce(p_is_active, true)
    where id = p_id and organization_id = v_org
    returning * into v_row;

    if v_old_price is distinct from v_row.price then
      insert into public.price_history (
        organization_id, product_id, presentation_id, old_price, new_price, reason, user_id
      ) values (v_org, v_row.product_id, v_row.id, v_old_price, v_row.price, p_reason, auth.uid());
    end if;
  end if;

  /* Si el PLU vino a mano y quedó por encima del contador, correrlo, para que
     una sugerencia futura no proponga un número ya usado en las balanzas. */
  update public.plu_counter c
     set last_plu = greatest(c.last_plu, coalesce(v_row.plu, 0))
   where c.organization_id = v_org;

  return v_row;
end;
$$;

/* Mueve la marca de "por defecto", desmarcando la anterior en la misma
   transacción: el unique index no admite dos. */
create or replace function public.set_default_presentation(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_product uuid;
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para editar presentaciones.';
  end if;

  select product_id into v_product from public.product_presentations
   where id = p_id and organization_id = v_org;
  if not found then
    raise exception 'Esa presentación no existe.';
  end if;

  update public.product_presentations
     set is_default = false
   where product_id = v_product and is_default;

  update public.product_presentations
     set is_default = true, is_active = true
   where id = p_id;
end;
$$;

/*
 * Borra una presentación.
 *
 * No se puede borrar la que está por defecto (el producto quedaría sin precio),
 * ni una que ya se vendió: el historial dejaría de poder decir a qué precio se
 * cobró. En ese caso se desactiva, que es lo que en realidad se quiere.
 */
create or replace function public.delete_presentation(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row public.product_presentations;
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para borrar presentaciones.';
  end if;

  select * into v_row from public.product_presentations
   where id = p_id and organization_id = v_org;
  if not found then
    raise exception 'Esa presentación no existe.';
  end if;

  if v_row.is_default then
    raise exception 'No se puede borrar la presentación principal: marcá otra como principal primero.';
  end if;

  if exists (select 1 from public.sale_items where presentation_id = p_id) then
    raise exception 'Esa presentación ya se vendió: desactivala en vez de borrarla, así el historial sigue cerrando.';
  end if;

  delete from public.product_presentations where id = p_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. Alta y edición de productos: el precio y el PLU van a la presentación
--    principal. La firma no cambia, así el resto del sistema sigue llamando
--    igual.
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
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para dar de alta productos.';
  end if;

  insert into public.products (
    organization_id, name, description, category_id, unit_type, kind,
    cost, min_stock, track_expiry, shelf_life_days, barcode, sku
  ) values (
    v_org, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    p_category_id, p_unit_type, p_kind,
    coalesce(p_cost, 0), coalesce(p_min_stock, 0),
    coalesce(p_track_expiry, false), p_shelf_life_days,
    nullif(btrim(coalesce(p_barcode, '')), ''),
    nullif(btrim(coalesce(p_sku, '')), '')
  )
  returning * into v_row;

  insert into public.product_presentations (
    organization_id, product_id, name, plu, price, is_default, sort_order
  ) values (
    v_org, v_row.id,
    case when p_unit_type = 'kg' then 'Fraccionado' else 'Unidad' end,
    p_plu, coalesce(p_price, 0), true, 0
  );

  update public.plu_counter c
     set last_plu = greatest(c.last_plu, coalesce(p_plu, 0))
   where c.organization_id = v_org;

  insert into public.price_history (
    organization_id, product_id, presentation_id, old_price, new_price, reason, user_id
  )
  select v_org, v_row.id, pp.id, null, pp.price, 'alta', auth.uid()
    from public.product_presentations pp
   where pp.product_id = v_row.id and pp.is_default;

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
  p_price_reason    text    default null,
  p_plu             integer default null,
  p_cost            numeric default null
)
returns public.products
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  v_row  public.products;
  v_pres uuid;
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para editar productos.';
  end if;

  update public.products set
    name            = btrim(p_name),
    description     = nullif(btrim(coalesce(p_description, '')), ''),
    category_id     = p_category_id,
    unit_type       = p_unit_type,
    kind            = p_kind,
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

  if not found then
    raise exception 'Ese producto no existe.';
  end if;

  /* El precio y el PLU del formulario son los de la presentación principal.
     Las otras se editan una por una desde la ficha del producto. */
  select id into v_pres from public.product_presentations
   where product_id = p_id and is_default;

  if v_pres is null then
    insert into public.product_presentations (
      organization_id, product_id, name, plu, price, is_default, sort_order
    ) values (
      v_org, p_id,
      case when p_unit_type = 'kg' then 'Fraccionado' else 'Unidad' end,
      p_plu, coalesce(p_price, 0), true, 0
    );
  else
    perform public.upsert_presentation(
      v_pres, p_id,
      (select name from public.product_presentations where id = v_pres),
      p_price, p_plu,
      (select min_qty from public.product_presentations where id = v_pres),
      (select sort_order from public.product_presentations where id = v_pres),
      true, p_price_reason
    );
  end if;

  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. Importación: el precio y el PLU de la planilla son los de la principal
-- ─────────────────────────────────────────────────────────────
create or replace function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org           uuid := public.current_org_id();
  r               jsonb;
  v_id            uuid;
  v_pres          uuid;
  v_es_default    boolean;
  v_cat           uuid;
  v_plu           integer;
  v_barcode       text;
  v_nombre        text;
  v_precio        numeric;
  v_costo         numeric;
  v_old_price     numeric;
  v_creados       integer := 0;
  v_actualizados  integer := 0;
  v_ajustes       integer := 0;
  v_sin_plu       integer := 0;
  v_store_key     text;
  v_store_val     text;
  v_target        numeric;
  v_current       numeric;
  v_delta         numeric;
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para importar productos.';
  end if;

  for r in select value from jsonb_array_elements(p_rows)
  loop
    v_nombre  := btrim(r->>'nombre');
    v_precio  := (r->>'precio')::numeric;
    v_costo   := nullif(r->>'costo', '')::numeric;
    v_plu     := nullif(r->>'plu', '')::integer;
    v_barcode := nullif(btrim(coalesce(r->>'barcode', '')), '');

    v_cat := null;
    if coalesce(btrim(r->>'categoria'), '') <> '' then
      select id into v_cat from public.categories
       where organization_id = v_org and lower(name) = lower(btrim(r->>'categoria'));
      if v_cat is null then
        insert into public.categories (organization_id, name)
        values (v_org, btrim(r->>'categoria'))
        returning id into v_cat;
      end if;
    end if;

    /* Matcheo por orden de confianza. El PLU ahora vive en la presentación,
       así que el primer paso salta de la presentación al producto. */
    v_id   := null;
    v_pres := null;
    if v_plu is not null then
      select pp.id, pp.product_id into v_pres, v_id
        from public.product_presentations pp
       where pp.organization_id = v_org and pp.plu = v_plu;
    end if;
    if v_id is null and v_barcode is not null then
      select id into v_id from public.products
       where organization_id = v_org and barcode = v_barcode;
    end if;
    if v_id is null then
      select id into v_id from public.products
       where organization_id = v_org and lower(name) = lower(v_nombre)
       limit 1;
    end if;

    if v_plu is null then
      v_sin_plu := v_sin_plu + 1;
    end if;

    v_es_default := true;
    if v_pres is not null then
      select is_default into v_es_default from public.product_presentations
       where id = v_pres;
    end if;

    if v_id is null then
      insert into public.products (
        organization_id, name, category_id, unit_type, barcode, sku,
        cost, min_stock, track_expiry, shelf_life_days
      ) values (
        v_org, v_nombre, v_cat, r->>'tipo',
        v_barcode,
        nullif(btrim(coalesce(r->>'sku', '')), ''),
        coalesce(v_costo, 0),
        coalesce(nullif(r->>'minimo', '')::numeric, 0),
        coalesce((r->>'vence')::boolean, false),
        nullif(r->>'vida_util', '')::integer
      )
      returning id into v_id;

      insert into public.product_presentations (
        organization_id, product_id, name, plu, price, is_default, sort_order
      ) values (
        v_org, v_id,
        case when r->>'tipo' = 'kg' then 'Fraccionado' else 'Unidad' end,
        v_plu,                                   -- puede quedar NULL a propósito
        v_precio, true, 0
      )
      returning id into v_pres;

      insert into public.price_history (
        organization_id, product_id, presentation_id, old_price, new_price, reason, user_id
      ) values (v_org, v_id, v_pres, null, v_precio, 'importación', auth.uid());

      v_creados := v_creados + 1;
    elsif v_pres is not null and not v_es_default then
      /* El PLU de la planilla matcheó una presentación ALTERNATIVA (la horma).
         Esa fila describe esa presentación, no el producto: se le toca el
         precio y nada más. Renombrar el producto desde acá lo dejaría llamado
         "Queso Sardo horma". */
      select price into v_old_price from public.product_presentations where id = v_pres;

      update public.product_presentations
         set price = v_precio, name = v_nombre
       where id = v_pres;

      if v_old_price is distinct from v_precio then
        insert into public.price_history (
          organization_id, product_id, presentation_id, old_price, new_price, reason, user_id
        ) values (v_org, v_id, v_pres, v_old_price, v_precio, 'importación', auth.uid());
      end if;

      v_actualizados := v_actualizados + 1;
    else
      update public.products set
        name            = v_nombre,
        category_id     = coalesce(v_cat, category_id),
        unit_type       = r->>'tipo',
        barcode         = coalesce(v_barcode, barcode),
        sku             = coalesce(nullif(btrim(coalesce(r->>'sku', '')), ''), sku),
        min_stock       = coalesce(nullif(r->>'minimo', '')::numeric, min_stock),
        track_expiry    = coalesce((r->>'vence')::boolean, track_expiry),
        shelf_life_days = coalesce(nullif(r->>'vida_util', '')::integer, shelf_life_days)
      where id = v_id;

      if v_costo is not null and not exists (
        select 1 from public.stock_movements m
         where m.product_id = v_id and m.reason = 'compra'
      ) then
        update public.products set cost = v_costo where id = v_id;
      end if;

      /* Match por barcode o por nombre: la fila describe el producto, así que
         va contra su presentación principal. Las alternativas (horma, media
         horma) no se tocan: pisarlas con el precio fraccionado sería peor que
         dejarlas como están. */
      select id, price into v_pres, v_old_price from public.product_presentations
       where product_id = v_id and is_default;

      if v_pres is null then
        insert into public.product_presentations (
          organization_id, product_id, name, plu, price, is_default, sort_order
        ) values (
          v_org, v_id,
          case when r->>'tipo' = 'kg' then 'Fraccionado' else 'Unidad' end,
          v_plu, v_precio, true, 0
        )
        returning id into v_pres;

        insert into public.price_history (
          organization_id, product_id, presentation_id, old_price, new_price, reason, user_id
        ) values (v_org, v_id, v_pres, null, v_precio, 'importación', auth.uid());
      else
        update public.product_presentations set
          price = v_precio,
          plu   = coalesce(v_plu, plu)
        where id = v_pres;

        if v_old_price is distinct from v_precio then
          insert into public.price_history (
            organization_id, product_id, presentation_id, old_price, new_price, reason, user_id
          ) values (v_org, v_id, v_pres, v_old_price, v_precio, 'importación', auth.uid());
        end if;
      end if;

      v_actualizados := v_actualizados + 1;
    end if;

    if r ? 'stock' then
      for v_store_key, v_store_val in
        select key, value from jsonb_each_text(r->'stock')
      loop
        if coalesce(btrim(v_store_val), '') <> '' then
          v_target := v_store_val::numeric;

          select qty into v_current from public.stock
           where store_id = v_store_key::uuid and product_id = v_id;
          v_current := coalesce(v_current, 0);

          v_delta := v_target - v_current;
          if v_delta <> 0 then
            perform public.adjust_stock(
              v_store_key::uuid, v_id, v_delta,
              case when v_current = 0 then 'alta_inicial' else 'ajuste' end,
              'importacion', null, null, 'Importación de catálogo'
            );
            v_ajustes := v_ajustes + 1;
          end if;
        end if;
      end loop;
    end if;
  end loop;

  update public.plu_counter c
     set last_plu = greatest(
           c.last_plu,
           coalesce((select max(pp.plu) from public.product_presentations pp
                      where pp.organization_id = v_org), 0))
   where c.organization_id = v_org;

  return jsonb_build_object(
    'creados', v_creados,
    'actualizados', v_actualizados,
    'ajustes_stock', v_ajustes,
    'sin_plu', v_sin_plu
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. La venta guarda con qué presentación se cobró
--
-- Sin esto, dentro de un mes no hay forma de saber si esos 3 kg salieron a
-- precio de horma o si alguien se equivocó de PLU.
-- ─────────────────────────────────────────────────────────────
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
  v_pres      uuid;
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
    v_pres    := nullif(r->>'presentation_id', '')::uuid;
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

    /* Una presentación que no es de este producto es un error de programación
       del mostrador, no un caso de negocio: se corta antes de tocar el stock. */
    if v_pres is not null and not exists (
      select 1 from public.product_presentations pp
       where pp.id = v_pres and pp.product_id = v_product
    ) then
      raise exception '%: esa presentación no es de ese producto.', v_name;
    end if;

    /* Si no vino, se asume la principal: una venta del celular o un llamador
       viejo queda igualmente auditable. */
    if v_pres is null then
      select id into v_pres from public.product_presentations
       where product_id = v_product and is_default;
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
      sale_id, product_id, presentation_id, qty, unit_price, subtotal,
      cost_snapshot, source, scale_code
    ) values (
      v_sale.id, v_product, v_pres, v_qty, v_price, v_linea, coalesce(v_cost, 0),
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

-- ─────────────────────────────────────────────────────────────
-- 9. El reporte por producto leía products.plu, que ya no existe
--
-- Sigue mostrando UN sardo, sumando todas sus presentaciones: es el que
-- contesta "¿cuánto me deja el sardo?". El PLU que muestra es el de la
-- presentación principal, que es con el que se lo busca en la balanza.
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
  select p.id, p.name,
         (select pp.plu from public.product_presentations pp
           where pp.product_id = p.id and pp.is_default),
         p.unit_type,
         sum(m.qty)::numeric,
         sum(m.subtotal)::numeric,
         sum(m.costo)::numeric,
         (sum(m.subtotal) - sum(m.costo))::numeric,
         case when sum(m.subtotal) > 0
              then round((sum(m.subtotal) - sum(m.costo)) / sum(m.subtotal) * 100, 1)
              else null end
    from movimientos m
    join public.products p on p.id = m.product_id
   group by p.id, p.name, p.unit_type
  having sum(m.qty) <> 0
   order by sum(m.subtotal) desc;
$$;

-- ─────────────────────────────────────────────────────────────
-- 10. Reporte por presentación
--
-- El de producto sigue igual y sigue siendo el que contesta "¿cuánto me deja
-- el sardo?". Este contesta la otra: "¿cuánto se me va en horma?".
-- ─────────────────────────────────────────────────────────────
create or replace function public.report_sales_by_presentation(
  p_from        date,
  p_to          date,
  p_store       uuid    default null,
  p_only_fiscal boolean default false
)
returns table (
  presentation_id uuid,
  product_id      uuid,
  product_name    text,
  presentation    text,
  plu             integer,
  unit_type       text,
  qty             numeric,
  revenue         numeric,
  cost            numeric,
  margin          numeric,
  margin_pct      numeric
)
language sql stable security definer set search_path = public
as $$
  with movimientos as (
    select si.presentation_id, si.product_id, si.qty, si.subtotal,
           si.qty * si.cost_snapshot as costo
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
     where s.organization_id = public.current_org_id()
       and s.status = 'completada'
       and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date
             between p_from and p_to
       and (p_store is null or s.store_id = p_store)
       and (not p_only_fiscal or s.is_fiscal)
    union all
    select si.presentation_id, ri.product_id, -ri.qty, -ri.subtotal,
           -ri.qty * ri.cost_snapshot
      from public.return_items ri
      join public.sale_items si on si.id = ri.sale_item_id
      join public.returns rt on rt.id = ri.return_id
      join public.sales s on s.id = rt.sale_id
     where rt.organization_id = public.current_org_id()
       and (rt.created_at at time zone 'America/Argentina/Buenos_Aires')::date
             between p_from and p_to
       and (p_store is null or rt.store_id = p_store)
       and (not p_only_fiscal or s.is_fiscal)
  )
  select pp.id, p.id, p.name, pp.name, pp.plu, p.unit_type,
         sum(m.qty)::numeric,
         sum(m.subtotal)::numeric,
         sum(m.costo)::numeric,
         (sum(m.subtotal) - sum(m.costo))::numeric,
         case when sum(m.subtotal) > 0
              then round((sum(m.subtotal) - sum(m.costo)) / sum(m.subtotal) * 100, 1)
              else null end
    from movimientos m
    join public.product_presentations pp on pp.id = m.presentation_id
    join public.products p on p.id = pp.product_id
   group by pp.id, p.id, p.name, pp.name, pp.plu, p.unit_type
  having sum(m.qty) <> 0
   order by sum(m.subtotal) desc;
$$;

-- ─────────────────────────────────────────────────────────────
-- 11. RLS: se lee lo de la organización, se escribe por función
-- ─────────────────────────────────────────────────────────────
alter table public.product_presentations enable row level security;

drop policy if exists product_presentations_select on public.product_presentations;
create policy product_presentations_select on public.product_presentations for select
  using (organization_id = public.current_org_id());

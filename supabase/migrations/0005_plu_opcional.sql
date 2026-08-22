-- 0005_plu_opcional.sql — El PLU sale de las balanzas, no de Bellota.
--
-- CORRECCIÓN DE UNA PREMISA EQUIVOCADA (dueño, 2026-08-22):
--   Yo había asumido que las balanzas no tenían catálogo y que Bellota era la
--   fuente de verdad del PLU, asignándolo solo. Es al revés: **cada producto ya
--   tiene su PLU cargado en las balanzas**. Que el ticket diga "Varios" es un
--   problema de cómo lo usan hoy, no de un catálogo vacío.
--
-- Por qué importa: si Bellota inventa un PLU, MIENTE. Le pone el 1000 al jamón,
-- la balanza tiene el 1000 en otra cosa, y la etiqueta escanea el producto
-- equivocado en el mostrador. Un PLU inventado es peor que un PLU vacío.
--
-- Además el PLU es opcional de verdad: los envasados que vienen de fábrica se
-- venden por su código de barras y no pasan nunca por la balanza.
--
-- Esta migración:
--   1. Hace `plu` nullable.
--   2. Cambia el unique por un índice parcial (varios productos sin PLU pueden
--      convivir; dos con el mismo PLU no).
--   3. Hace único el código de barras, que es la otra llave de identificación.
--   4. create_product / update_product reciben el PLU, ya no lo inventan.
--   5. suggest_plu() sugiere un número libre SIN consumirlo, para el caso real
--      de un producto nuevo que después hay que dar de alta en las balanzas.
--   6. import_products deja el PLU vacío cuando la planilla no lo trae, y
--      matchea por PLU, después por código de barras y recién después por nombre.

alter table public.products alter column plu drop not null;

alter table public.products drop constraint if exists products_organization_id_plu_key;

create unique index if not exists products_plu_uidx
  on public.products (organization_id, plu) where plu is not null;

drop index if exists products_barcode_idx;
create unique index if not exists products_barcode_uidx
  on public.products (organization_id, barcode) where barcode is not null;

-- ─────────────────────────────────────────────────────────────
-- Sugerencia de PLU: NO consume el número.
-- Que dos altas simultáneas propongan el mismo es un problema teórico —
-- el índice único lo caza— y es mejor que quemar números al abrir un formulario.
-- ─────────────────────────────────────────────────────────────
create or replace function public.suggest_plu()
returns integer
language sql stable security definer set search_path = public
as $$
  select greatest(
    coalesce((select c.last_plu from public.plu_counter c
               where c.organization_id = public.current_org_id()), 999),
    coalesce((select max(p.plu) from public.products p
               where p.organization_id = public.current_org_id()), 0)
  ) + 1;
$$;

-- ─────────────────────────────────────────────────────────────
-- Alta: el PLU se recibe, no se inventa.
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
    organization_id, name, description, category_id, unit_type, plu, kind,
    price, cost, min_stock, track_expiry, shelf_life_days, barcode, sku
  ) values (
    v_org, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    p_category_id, p_unit_type, p_plu, p_kind,
    p_price, coalesce(p_cost, 0), coalesce(p_min_stock, 0),
    coalesce(p_track_expiry, false), p_shelf_life_days,
    nullif(btrim(coalesce(p_barcode, '')), ''),
    nullif(btrim(coalesce(p_sku, '')), '')
  )
  returning * into v_row;

  -- Si el PLU vino a mano y quedó por encima del contador, correrlo, para que
  -- una sugerencia futura no proponga un número ya usado en las balanzas.
  update public.plu_counter c
     set last_plu = greatest(c.last_plu, coalesce(v_row.plu, 0))
   where c.organization_id = v_org;

  insert into public.price_history (organization_id, product_id, old_price, new_price, reason, user_id)
  values (v_org, v_row.id, null, v_row.price, 'alta', auth.uid());

  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Edición: ahora el PLU SÍ se puede corregir.
-- Antes lo dejaba fijo de por vida, pero eso servía cuando lo inventaba
-- Bellota. Si el número lo tipeó una persona copiándolo de la balanza, tiene
-- que poder arreglar un error de tipeo. La UI avisa lo que implica.
-- ─────────────────────────────────────────────────────────────
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
  p_plu             integer default null
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

  -- El costo sigue sin tocarse acá: es promedio ponderado.
  update public.products set
    name            = btrim(p_name),
    description     = nullif(btrim(coalesce(p_description, '')), ''),
    category_id     = p_category_id,
    unit_type       = p_unit_type,
    kind            = p_kind,
    price           = p_price,
    plu             = p_plu,
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
 * Baja y alta lógica, sin pasar por update_product.
 *
 * update_product pisa el PLU con lo que reciba: es su contrato, "mandame todos
 * los campos". Eso está bien para el formulario, que siempre los manda, pero es
 * una trampa para cualquier otro llamador que quiera cambiar UNA cosa y termine
 * borrando el PLU sin querer. Con las etiquetas ya impresas en la calle, ese
 * error no se nota hasta que un paquete escanea otro producto.
 */
create or replace function public.set_product_active(p_id uuid, p_active boolean)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.can_edit_module('productos') then
    raise exception 'No tenés permiso para editar productos.';
  end if;

  update public.products
     set is_active = p_active
   where id = p_id and organization_id = public.current_org_id();
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Importación: el PLU que trae la planilla es el de la balanza.
-- Si no viene, queda VACÍO. Nunca se inventa.
-- Matcheo: PLU → código de barras → nombre.
-- ─────────────────────────────────────────────────────────────
create or replace function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_org           uuid := public.current_org_id();
  r               jsonb;
  v_id            uuid;
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

    -- Matcheo por orden de confianza.
    v_id := null;
    if v_plu is not null then
      select id into v_id from public.products
       where organization_id = v_org and plu = v_plu;
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

    if v_id is null then
      insert into public.products (
        organization_id, name, category_id, unit_type, plu, barcode, sku,
        price, cost, min_stock, track_expiry, shelf_life_days
      ) values (
        v_org, v_nombre, v_cat, r->>'tipo',
        v_plu,                                   -- puede quedar NULL a propósito
        v_barcode,
        nullif(btrim(coalesce(r->>'sku', '')), ''),
        v_precio, coalesce(v_costo, 0),
        coalesce(nullif(r->>'minimo', '')::numeric, 0),
        coalesce((r->>'vence')::boolean, false),
        nullif(r->>'vida_util', '')::integer
      )
      returning id into v_id;

      insert into public.price_history (organization_id, product_id, old_price, new_price, reason, user_id)
      values (v_org, v_id, null, v_precio, 'importación', auth.uid());

      v_creados := v_creados + 1;
    else
      select price into v_old_price from public.products where id = v_id;

      update public.products set
        name            = v_nombre,
        category_id     = coalesce(v_cat, category_id),
        unit_type       = r->>'tipo',
        price           = v_precio,
        plu             = coalesce(v_plu, plu),
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

      if v_old_price is distinct from v_precio then
        insert into public.price_history (organization_id, product_id, old_price, new_price, reason, user_id)
        values (v_org, v_id, v_old_price, v_precio, 'importación', auth.uid());
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

  -- Correr el contador por encima de todo lo que trajo la planilla.
  update public.plu_counter c
     set last_plu = greatest(
           c.last_plu,
           coalesce((select max(p.plu) from public.products p
                      where p.organization_id = v_org), 0))
   where c.organization_id = v_org;

  return jsonb_build_object(
    'creados', v_creados,
    'actualizados', v_actualizados,
    'ajustes_stock', v_ajustes,
    'sin_plu', v_sin_plu
  );
end;
$$;

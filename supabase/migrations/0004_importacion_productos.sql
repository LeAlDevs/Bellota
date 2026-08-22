-- 0004_importacion_productos.sql — Carga masiva del catálogo desde Excel.
--
-- Idempotente por diseño: correr la misma planilla dos veces NO duplica
-- productos ni suma el stock dos veces. Es la diferencia entre una herramienta
-- que se puede usar con confianza y una que hay que usar conteniendo el aire.
--
-- Matcheo: por PLU si la planilla lo trae; si no, por nombre. Las balanzas hoy
-- no tienen catálogo (todo dice "Varios"), así que el dueño no tiene PLUs para
-- poner en la planilla: se los asigna Bellota y de ahí bajan a las balanzas.

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
  v_nombre        text;
  v_precio        numeric;
  v_costo         numeric;
  v_old_price     numeric;
  v_creados       integer := 0;
  v_actualizados  integer := 0;
  v_ajustes       integer := 0;
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
    v_nombre := btrim(r->>'nombre');
    v_precio := (r->>'precio')::numeric;
    v_costo  := nullif(r->>'costo', '')::numeric;
    v_plu    := nullif(r->>'plu', '')::integer;

    -- Categoría: se crea sola si no existe.
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

    -- ¿Ya existe?
    v_id := null;
    if v_plu is not null then
      select id into v_id from public.products
       where organization_id = v_org and plu = v_plu;
    else
      select id into v_id from public.products
       where organization_id = v_org and lower(name) = lower(v_nombre)
       limit 1;
    end if;

    if v_id is null then
      insert into public.products (
        organization_id, name, category_id, unit_type, plu, price, cost,
        min_stock, track_expiry, shelf_life_days
      ) values (
        v_org, v_nombre, v_cat, r->>'tipo',
        coalesce(v_plu, public.next_plu()),
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
        name         = v_nombre,
        category_id  = coalesce(v_cat, category_id),
        unit_type    = r->>'tipo',
        price        = v_precio,
        min_stock    = coalesce(nullif(r->>'minimo', '')::numeric, min_stock),
        track_expiry = coalesce((r->>'vence')::boolean, track_expiry),
        shelf_life_days = coalesce(nullif(r->>'vida_util', '')::integer, shelf_life_days)
      where id = v_id;

      -- El costo de la planilla solo pisa al del sistema mientras el producto
      -- NUNCA haya recibido una compra. Después manda el promedio ponderado:
      -- una planilla vieja no puede ensuciar un costo real.
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

    -- Stock por local. La planilla dice CUÁNTO HAY, no cuánto sumar: se calcula
    -- la diferencia contra lo que hay hoy. Por eso se puede reimportar sin que
    -- el stock se duplique.
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

  return jsonb_build_object(
    'creados', v_creados,
    'actualizados', v_actualizados,
    'ajustes_stock', v_ajustes
  );
end;
$$;

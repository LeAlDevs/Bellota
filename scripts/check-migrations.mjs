// Corre las migraciones de Bellota contra un Postgres en WASM (PGlite) para
// validar sintaxis y lógica antes de pegarlas en el SQL Editor de Supabase.
// Stubbea el esquema `auth` de Supabase, que acá no existe.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const STUB = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select nullif(current_setting('bellota.uid', true), '')::uuid;
$fn$;
`;

const db = new PGlite();
let fallas = 0;

async function run(label, sql) {
  try {
    await db.exec(sql);
    console.log(`  ok   ${label}`);
  } catch (e) {
    fallas++;
    console.log(`  FALLA ${label}`);
    console.log(`        ${String(e.message).split("\n").join("\n        ")}`);
  }
}

console.log("Preparando stub de auth…");
await run("stub auth", STUB);

const archivos = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

console.log("\nMigraciones:");
for (const f of archivos) {
  let sql = fs.readFileSync(path.join(DIR, f), "utf8");
  // pgcrypto no viene en PGlite; gen_random_uuid() es core desde PG13.
  sql = sql.replace(/create extension if not exists pgcrypto;/g, "");
  await run(f, sql);
}

if (fallas > 0) {
  console.log(`\n${fallas} migración/es con error. No sigo con el humo.`);
  process.exit(1);
}

// ── Prueba de humo: el circuito real de la fase 1 ─────────────────────
console.log("\nPrueba de humo:");

async function paso(label, fn) {
  try {
    const r = await fn();
    console.log(`  ok   ${label}${r ? " -> " + r : ""}`);
  } catch (e) {
    fallas++;
    console.log(`  FALLA ${label}`);
    console.log(`        ${String(e.message).split("\n").join("\n        ")}`);
  }
}

let uid;
await paso("alta de usuario dispara el trigger", async () => {
  const r = await db.query(
    "insert into auth.users (email, raw_user_meta_data) values ('jefe@iberico.test', '{\"full_name\":\"Jefe\"}'::jsonb) returning id"
  );
  uid = r.rows[0].id;
  const p = await db.query(
    "select r.name from public.profiles p join public.roles r on r.id = p.role_id where p.id = $1",
    [uid]
  );
  if (p.rows.length === 0) throw new Error("no se creó el perfil o quedó sin rol");
  return `rol ${p.rows[0].name}`;
});

await paso("segundo usuario NO queda administrador", async () => {
  const r = await db.query(
    "insert into auth.users (email) values ('cajero@iberico.test') returning id"
  );
  const p = await db.query("select role_id from public.profiles where id = $1", [r.rows[0].id]);
  if (p.rows.length === 0) throw new Error("no se creó el perfil");
  if (p.rows[0].role_id !== null) throw new Error("le asignó un rol y no debía");
  return "sin rol, como corresponde";
});

await db.exec(`set bellota.uid = '${uid}'`);

await paso("current_org_id() resuelve", async () => {
  const r = await db.query("select public.current_org_id() as org");
  if (!r.rows[0].org) throw new Error("devolvió null");
  return r.rows[0].org.slice(0, 8);
});

await paso("is_admin() = true", async () => {
  const r = await db.query("select public.is_admin() as a");
  if (r.rows[0].a !== true) throw new Error("devolvió " + r.rows[0].a);
});

await paso("can_edit_module('productos') = true", async () => {
  const r = await db.query("select public.can_edit_module('productos') as a");
  if (r.rows[0].a !== true) throw new Error("devolvió " + r.rows[0].a);
});

let prod1;
await paso("create_product guarda el PLU que viene de la balanza", async () => {
  const r = await db.query(
    "select * from public.create_product('Jamón crudo estacionado', 'kg', 42900, null, 'simple', 28314, 5, false, null, null, null, null, 412)"
  );
  prod1 = r.rows[0];
  if (prod1.plu !== 412) throw new Error("esperaba el 412, guardó " + prod1.plu);
  return `PLU ${prod1.plu}`;
});

await paso("un envasado puede quedar SIN PLU", async () => {
  const r = await db.query(
    "select * from public.create_product('Aceitunas verdes 350 g', 'unidad', 6400, null, 'simple', 4100, 6, false, null, '7791234567890', null, null, null)"
  );
  if (r.rows[0].plu !== null) throw new Error("le puso PLU " + r.rows[0].plu);
  return "plu null, se vende por su EAN";
});

await paso("dos productos con el mismo PLU se rechazan", async () => {
  try {
    await db.query(
      "select * from public.create_product('Otro con el mismo PLU', 'kg', 100, null, 'simple', 0, 0, false, null, null, null, null, 412)"
    );
  } catch {
    return "rechazado, bien";
  }
  throw new Error("dejó repetir el PLU");
});

await paso("pero varios sin PLU conviven sin chocar", async () => {
  await db.query(
    "select * from public.create_product('Gaseosa 500 ml', 'unidad', 2200, null, 'simple', 1400, 12, false, null, '7790001112223', null, null, null)"
  );
  const r = await db.query("select count(*)::int as n from public.products where plu is null");
  if (r.rows[0].n !== 2) throw new Error("esperaba 2 sin PLU, hay " + r.rows[0].n);
  return "2 productos sin PLU";
});

await paso("cada alta dejó su precio en price_history", async () => {
  // Contra la cantidad de productos, no contra un número fijo: así el test no
  // se rompe cada vez que agrego un caso más arriba.
  const r = await db.query(`
    select (select count(*) from public.price_history)::int as historial,
           (select count(*) from public.products)::int as productos
  `);
  const { historial, productos } = r.rows[0];
  if (historial !== productos) {
    throw new Error(`${productos} productos pero ${historial} filas de historial`);
  }
  return `${historial} altas registradas`;
});

await paso("update_product registra el cambio de precio", async () => {
  await db.query(
    "select public.update_product($1, 'Jamón crudo estacionado', 'kg', 45900, null, 'simple', 5, false, null, null, null, null, true, 'aumento del proveedor', 412)",
    [prod1.id]
  );
  const r = await db.query(
    "select old_price, new_price, reason from public.price_history where product_id = $1 order by created_at desc limit 1",
    [prod1.id]
  );
  const h = r.rows[0];
  if (Number(h.old_price) !== 42900 || Number(h.new_price) !== 45900) {
    throw new Error(`quedó ${h.old_price} -> ${h.new_price}`);
  }
  return `${h.old_price} -> ${h.new_price} (${h.reason})`;
});

await paso("update_product NO deja tocar el costo", async () => {
  const r = await db.query("select cost from public.products where id = $1", [prod1.id]);
  if (Number(r.rows[0].cost) !== 28314) throw new Error("el costo cambió: " + r.rows[0].cost);
  return "sigue en 28314";
});

let ramos;
await paso("adjust_stock suma y deja movimiento", async () => {
  const s = await db.query("select id from public.stores where name = 'Ramos'");
  ramos = s.rows[0].id;
  await db.query("select public.adjust_stock($1, $2, 18.4, 'alta_inicial')", [ramos, prod1.id]);
  const q = await db.query(
    "select public.adjust_stock($1, $2, -0.245, 'venta') as qty",
    [ramos, prod1.id]
  );
  const qty = Number(q.rows[0].qty);
  if (Math.abs(qty - 18.155) > 0.0005) throw new Error("qty quedó en " + qty);
  const m = await db.query("select count(*)::int as n from public.stock_movements");
  if (m.rows[0].n !== 2) throw new Error("esperaba 2 movimientos, hay " + m.rows[0].n);
  return `${qty} kg, 2 movimientos`;
});

await paso("el stock admite negativo (mostrador con la mercadería en la mano)", async () => {
  const q = await db.query(
    "select public.adjust_stock($1, $2, -20, 'venta') as qty",
    [ramos, prod1.id]
  );
  if (Number(q.rows[0].qty) >= 0) throw new Error("no quedó negativo");
  return Number(q.rows[0].qty).toFixed(3) + " kg";
});

await paso("adjust_stock rechaza un local de otra organización", async () => {
  try {
    await db.query(
      "select public.adjust_stock('00000000-0000-0000-0000-000000000000'::uuid, $1, 1, 'ajuste')",
      [prod1.id]
    );
  } catch {
    return "rechazado, bien";
  }
  throw new Error("lo dejó pasar");
});

await paso("upsert_category crea y renombra", async () => {
  const c = await db.query("select * from public.upsert_category(null, 'Picadas')");
  const id = c.rows[0].id;
  await db.query("select public.upsert_category($1, 'Picadas y tablas')", [id]);
  const r = await db.query("select name from public.categories where id = $1", [id]);
  return r.rows[0].name;
});

await paso("suggest_plu() propone un numero libre y NO lo consume", async () => {
  const a = await db.query("select public.suggest_plu() as p");
  const b = await db.query("select public.suggest_plu() as p");
  if (a.rows[0].p !== b.rows[0].p) throw new Error("consumió el número entre llamadas");
  const max = await db.query("select max(plu)::int as m from public.products");
  if (a.rows[0].p <= max.rows[0].m) throw new Error("propuso uno ya usado");
  return `propone ${a.rows[0].p}, el máximo usado es ${max.rows[0].m}`;
});

await paso("un PLU dado de baja NO se vuelve a sugerir", async () => {
  // Producto descartable con un PLU alto, para no borrar uno que usan los
  // pasos siguientes.
  const alto = 8800;
  await db.query(
    "select * from public.create_product('Descartable', 'unidad', 1, null, 'simple', 0, 0, false, null, null, null, null, $1)",
    [alto]
  );
  await db.query("delete from public.products where plu = $1", [alto]);
  const r = await db.query("select public.suggest_plu() as p");
  if (r.rows[0].p <= alto) throw new Error(`propuso el ${r.rows[0].p}, reciclando`);
  return `borré el ${alto}, ahora propone ${r.rows[0].p}`;
});

await paso("set_product_active no toca el PLU", async () => {
  await db.query("select public.set_product_active($1, false)", [prod1.id]);
  const r = await db.query("select plu, is_active from public.products where id = $1", [prod1.id]);
  if (r.rows[0].plu !== 412) throw new Error("el PLU quedó en " + r.rows[0].plu);
  if (r.rows[0].is_active !== false) throw new Error("no lo desactivó");
  await db.query("select public.set_product_active($1, true)", [prod1.id]);
  return "de baja y de alta, PLU intacto";
});

// ── Importación de catálogo ───────────────────────────────────────────
let mosconi;
await paso("preparo el segundo local", async () => {
  const r = await db.query("select id from public.stores where name = 'Mosconi'");
  mosconi = r.rows[0].id;
});

const planilla = (stockRamos, stockMosconi) => [
  {
    nombre: "Mortadela con pistacho",
    tipo: "kg",
    precio: 15280,
    costo: 11310,
    categoria: "Fiambres",
    minimo: 4,
    vence: false,
    stock: { [ramos]: String(stockRamos), [mosconi]: String(stockMosconi) },
  },
  {
    nombre: "Picada Ibérico 800 g",
    tipo: "unidad",
    precio: 47000,
    costo: 27730,
    categoria: "Picadas y tablas",
    vence: true,
    vida_util: 4,
    stock: { [ramos]: "14" },
  },
];

await paso("la importación crea productos y categorías nuevas", async () => {
  const r = await db.query("select public.import_products($1::jsonb) as res", [
    JSON.stringify(planilla(5.9, 3.2)),
  ]);
  const res = r.rows[0].res;
  if (res.creados !== 2) throw new Error("esperaba 2 creados, hubo " + res.creados);
  if (res.ajustes_stock !== 3) throw new Error("esperaba 3 ajustes, hubo " + res.ajustes_stock);
  return `${res.creados} creados, ${res.ajustes_stock} ajustes de stock`;
});

await paso("reimportar la MISMA planilla no duplica ni suma stock", async () => {
  const antesProd = await db.query("select count(*)::int as n from public.products");
  const r = await db.query("select public.import_products($1::jsonb) as res", [
    JSON.stringify(planilla(5.9, 3.2)),
  ]);
  const res = r.rows[0].res;
  const despuesProd = await db.query("select count(*)::int as n from public.products");

  if (despuesProd.rows[0].n !== antesProd.rows[0].n) throw new Error("duplicó productos");
  if (res.creados !== 0) throw new Error("creó " + res.creados + " y no debía");
  if (res.ajustes_stock !== 0) throw new Error("tocó el stock " + res.ajustes_stock + " veces");

  const s = await db.query(
    "select qty from public.stock s join public.products p on p.id = s.product_id where p.name = 'Mortadela con pistacho' and s.store_id = $1",
    [ramos]
  );
  if (Number(s.rows[0].qty) !== 5.9) throw new Error("el stock quedó en " + s.rows[0].qty);
  return "0 creados, 0 ajustes, stock sigue en 5,900";
});

await paso("la planilla dice CUÁNTO HAY, no cuánto sumar", async () => {
  await db.query("select public.import_products($1::jsonb)", [
    JSON.stringify(planilla(2.4, 3.2)),
  ]);
  const s = await db.query(
    "select qty from public.stock s join public.products p on p.id = s.product_id where p.name = 'Mortadela con pistacho' and s.store_id = $1",
    [ramos]
  );
  if (Number(s.rows[0].qty) !== 2.4) throw new Error("quedó en " + s.rows[0].qty);
  const m = await db.query(
    "select delta, reason from public.stock_movements order by created_at desc limit 1"
  );
  if (m.rows[0].reason !== "ajuste") throw new Error("el motivo fue " + m.rows[0].reason);
  return `bajó a 2,400 con un movimiento de ${m.rows[0].delta} (ajuste)`;
});

await paso("sin PLU en la planilla, queda SIN PLU (no se inventa)", async () => {
  const r = await db.query(
    "select plu from public.products where name = 'Mortadela con pistacho'"
  );
  if (r.rows[0].plu !== null) throw new Error("inventó el PLU " + r.rows[0].plu);
  return "plu null, como debe ser";
});

await paso("la planilla CON PLU lo guarda tal cual", async () => {
  const fila = [{ nombre: "Salame Milán", tipo: "kg", precio: 19800, plu: "1108", categoria: "Fiambres" }];
  await db.query("select public.import_products($1::jsonb)", [JSON.stringify(fila)]);
  const r = await db.query("select plu from public.products where name = 'Salame Milán'");
  if (r.rows[0].plu !== 1108) throw new Error("guardó " + r.rows[0].plu);
  return "PLU 1108, el de la balanza";
});

await paso("reimportar matchea por PLU aunque cambie el nombre", async () => {
  const fila = [{ nombre: "Salame Milán estacionado", tipo: "kg", precio: 21000, plu: "1108" }];
  const r = await db.query("select public.import_products($1::jsonb) as res", [JSON.stringify(fila)]);
  if (r.rows[0].res.creados !== 0) throw new Error("creó uno nuevo en vez de actualizar");
  const p = await db.query("select name from public.products where plu = 1108");
  return `actualizó el existente -> "${p.rows[0].name}"`;
});

await paso("un envasado matchea por codigo de barras", async () => {
  const fila = [{ nombre: "Aceitunas verdes 350 g x12", tipo: "unidad", precio: 6900, barcode: "7791234567890" }];
  const r = await db.query("select public.import_products($1::jsonb) as res", [JSON.stringify(fila)]);
  if (r.rows[0].res.creados !== 0) throw new Error("duplicó el producto en vez de matchear por EAN");
  return "matcheó por EAN, no duplicó";
});

await paso("la planilla NO pisa un costo que ya viene de una compra", async () => {
  const p = await db.query("select id from public.products where name = 'Picada Ibérico 800 g'");
  const pid = p.rows[0].id;
  await db.query("update public.products set cost = 31000 where id = $1", [pid]);
  await db.query(
    "select public.adjust_stock($1, $2, 1, 'compra', null, null, 31000)",
    [ramos, pid]
  );
  await db.query("select public.import_products($1::jsonb)", [
    JSON.stringify(planilla(2.4, 3.2)),
  ]);
  const r = await db.query("select cost from public.products where id = $1", [pid]);
  if (Number(r.rows[0].cost) !== 31000) throw new Error("lo pisó, quedó en " + r.rows[0].cost);
  return "sigue en 31000, no lo pisó con 27730";
});

// ── Stock: merma, conteo y transferencias ─────────────────────────────
let mermable;
await paso("preparo un producto con stock en los dos locales", async () => {
  const r = await db.query(
    "select * from public.create_product('Queso pategrás', 'kg', 27980, null, 'simple', 19880, 3, false, null, null, null, null, 2041)"
  );
  mermable = r.rows[0].id;
  await db.query("select public.adjust_stock($1, $2, 10, 'alta_inicial')", [ramos, mermable]);
  await db.query("select public.adjust_stock($1, $2, 6, 'alta_inicial')", [mosconi, mermable]);
  return "10 kg en Ramos, 6 en Mosconi";
});

await paso("adjust_stock guarda el costo del momento sin que se lo pidan", async () => {
  const r = await db.query(
    "select unit_cost from public.stock_movements where product_id = $1 order by created_at desc limit 1",
    [mermable]
  );
  if (Number(r.rows[0].unit_cost) !== 19880) {
    throw new Error("guardó " + r.rows[0].unit_cost);
  }
  return "$19.880, el costo del producto";
});

await paso("una merma SIN motivo se rechaza", async () => {
  try {
    await db.query("select public.adjust_stock($1, $2, -1, 'merma')", [ramos, mermable]);
  } catch (e) {
    if (!/motivo/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazada, bien";
  }
  throw new Error("dejó registrar una merma sin motivo");
});

await paso("la merma descuenta y deja el motivo y la plata perdida", async () => {
  await db.query(
    "select public.register_stock_adjustment($1, $2, 'merma', 1.4, 'vencido', 'Se pasó de fecha')",
    [ramos, mermable]
  );
  const m = await db.query(
    "select delta, reason, motive, unit_cost from public.stock_movements where product_id = $1 order by created_at desc limit 1",
    [mermable]
  );
  const mv = m.rows[0];
  if (mv.reason !== "merma" || mv.motive !== "vencido") {
    throw new Error(`quedó ${mv.reason}/${mv.motive}`);
  }
  const perdido = Math.abs(Number(mv.delta)) * Number(mv.unit_cost);
  const q = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, mermable]);
  if (Number(q.rows[0].qty) !== 8.6) throw new Error("el stock quedó en " + q.rows[0].qty);
  return `8,600 kg, motivo vencido, $${perdido.toFixed(0)} perdidos`;
});

await paso("el conteo calcula la diferencia, no se la pide al usuario", async () => {
  await db.query(
    "select public.register_stock_adjustment($1, $2, 'conteo', 8.2, null, null)",
    [ramos, mermable]
  );
  const m = await db.query(
    "select delta, reason from public.stock_movements where product_id = $1 order by created_at desc limit 1",
    [mermable]
  );
  if (m.rows[0].reason !== "ajuste") throw new Error("el motivo fue " + m.rows[0].reason);
  if (Math.abs(Number(m.rows[0].delta) + 0.4) > 0.0005) {
    throw new Error("el delta fue " + m.rows[0].delta);
  }
  return "conté 8,200 sobre 8,600 -> movimiento de -0,400";
});

await paso("un conteo que coincide NO ensucia el historial", async () => {
  const antes = await db.query("select count(*)::int as n from public.stock_movements where product_id = $1", [mermable]);
  await db.query(
    "select public.register_stock_adjustment($1, $2, 'conteo', 8.2, null, null)",
    [ramos, mermable]
  );
  const despues = await db.query("select count(*)::int as n from public.stock_movements where product_id = $1", [mermable]);
  if (despues.rows[0].n !== antes.rows[0].n) throw new Error("registró un movimiento de cero");
  return "sin movimiento nuevo";
});

await paso("la transferencia mueve de un local al otro en un solo acto", async () => {
  const items = JSON.stringify([{ product_id: mermable, qty: 3 }]);
  await db.query("select public.create_transfer($1, $2, $3::jsonb, 'Reposición')", [ramos, mosconi, items]);
  const a = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, mermable]);
  const b = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [mosconi, mermable]);
  if (Number(a.rows[0].qty) !== 5.2) throw new Error("Ramos quedó en " + a.rows[0].qty);
  if (Number(b.rows[0].qty) !== 9) throw new Error("Mosconi quedó en " + b.rows[0].qty);
  return "Ramos 5,200 / Mosconi 9,000";
});

await paso("no se puede transferir mas de lo que hay", async () => {
  const items = JSON.stringify([{ product_id: mermable, qty: 999 }]);
  try {
    await db.query("select public.create_transfer($1, $2, $3::jsonb, null)", [ramos, mosconi, items]);
  } catch (e) {
    if (!/No alcanza el stock/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazada con el mensaje correcto";
  }
  throw new Error("dejó mandar mercadería que no existe");
});

await paso("una transferencia rechazada no deja rastro (es atomica)", async () => {
  const antes = await db.query("select count(*)::int as n from public.transfers");
  const items = JSON.stringify([
    { product_id: mermable, qty: 1 },
    { product_id: mermable, qty: 999 },
  ]);
  try {
    await db.query("select public.create_transfer($1, $2, $3::jsonb, null)", [ramos, mosconi, items]);
  } catch {
    // esperado
  }
  const despues = await db.query("select count(*)::int as n from public.transfers");
  if (despues.rows[0].n !== antes.rows[0].n) throw new Error("quedó una transferencia a medias");
  const q = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, mermable]);
  if (Number(q.rows[0].qty) !== 5.2) throw new Error("el stock se movió igual: " + q.rows[0].qty);
  return "sin transferencia y sin mover stock";
});

await paso("los FK de transfers se llaman como espera la pantalla", async () => {
  // transfers tiene DOS claves foráneas a stores (origen y destino), así que
  // PostgREST no puede resolver el embed solo: la pantalla las nombra a mano
  // como stores!transfers_from_store_id_fkey. Si el nombre no coincide, el
  // listado tira 500. Por eso se chequea acá y no en el navegador.
  const esperados = ["transfers_from_store_id_fkey", "transfers_to_store_id_fkey"];
  const r = await db.query(`
    select conname from pg_constraint
     where conrelid = 'public.transfers'::regclass and contype = 'f'
  `);
  const nombres = r.rows.map((x) => x.conname);
  const faltan = esperados.filter((e) => !nombres.includes(e));
  if (faltan.length > 0) {
    throw new Error(`faltan ${faltan.join(", ")}; hay ${nombres.join(", ")}`);
  }
  return esperados.join(" + ");
});

await paso("no se puede transferir de un local a si mismo", async () => {
  const items = JSON.stringify([{ product_id: mermable, qty: 1 }]);
  try {
    await db.query("select public.create_transfer($1, $1, $2::jsonb, null)", [ramos, items]);
  } catch {
    return "rechazada, bien";
  }
  throw new Error("lo dejó pasar");
});

// ── Compras y costo promedio ponderado ────────────────────────────────
let prov, jamon;
await paso("alta de proveedor", async () => {
  const r = await db.query("select * from public.upsert_supplier(null, 'Frigorífico del Sur', '30-11111111-9')");
  prov = r.rows[0].id;
  return r.rows[0].name;
});

await paso("preparo un producto con stock y costo conocidos", async () => {
  const r = await db.query(
    "select * from public.create_product('Bondiola ahumada', 'kg', 31500, null, 'simple', 20000, 2, false, null, null, null, null, 1077)"
  );
  jamon = r.rows[0].id;
  await db.query("select public.adjust_stock($1, $2, 10, 'alta_inicial')", [ramos, jamon]);
  return "10 kg a $20.000 de costo";
});

await paso("el reparto entre locales tiene que cerrar con lo recibido", async () => {
  const items = JSON.stringify([
    { product_id: jamon, qty_ordered: 10, qty_received: 9.8, unit_cost: 24000,
      allocations: { [ramos]: 5, [mosconi]: 3 } },
  ]);
  try {
    await db.query(
      "select public.receive_purchase($1, null, false, null, 'contado', null, $2::jsonb)",
      [prov, items]
    );
  } catch (e) {
    if (!/no cierra/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazada: llegaron 9,8 y repartían 8";
  }
  throw new Error("dejó pasar un reparto que no cierra");
});

await paso("una compra rechazada no deja el documento a medias", async () => {
  const r = await db.query("select count(*)::int as n from public.purchases");
  if (r.rows[0].n !== 0) throw new Error("quedaron " + r.rows[0].n + " compras");
  return "sin compras huérfanas";
});

await paso("la recepcion reparte el stock entre los dos locales", async () => {
  const items = JSON.stringify([
    { product_id: jamon, qty_ordered: 10, qty_received: 9.8, unit_cost: 24000,
      allocations: { [ramos]: 6, [mosconi]: 3.8 } },
  ]);
  await db.query(
    "select public.receive_purchase($1, null, true, 'A-0001-00012345', 'contado', 'Entrega del martes', $2::jsonb)",
    [prov, items]
  );
  const a = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, jamon]);
  const b = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [mosconi, jamon]);
  if (Number(a.rows[0].qty) !== 16) throw new Error("Ramos quedó en " + a.rows[0].qty);
  if (Number(b.rows[0].qty) !== 3.8) throw new Error("Mosconi quedó en " + b.rows[0].qty);
  return "Ramos 16,000 / Mosconi 3,800";
});

await paso("el costo promedio ponderado sale bien", async () => {
  // (10 x 20000 + 9,8 x 24000) / 19,8 = 21979,80
  const r = await db.query("select cost from public.products where id = $1", [jamon]);
  const esperado = (10 * 20000 + 9.8 * 24000) / 19.8;
  const got = Number(r.rows[0].cost);
  if (Math.abs(got - esperado) > 0.01) {
    throw new Error(`esperaba ${esperado.toFixed(2)} y dio ${got}`);
  }
  return `$${got} (antes $20.000, compró a $24.000)`;
});

await paso("el total de la compra es lo recibido por el costo, no lo pedido", async () => {
  const r = await db.query("select total from public.purchases order by created_at desc limit 1");
  const esperado = 9.8 * 24000;
  if (Math.abs(Number(r.rows[0].total) - esperado) > 0.01) {
    throw new Error("el total dio " + r.rows[0].total);
  }
  return `$${esperado} = 9,8 kg x $24.000`;
});

await paso("una compra al contado NO genera deuda", async () => {
  const r = await db.query("select count(*)::int as n from public.supplier_movements");
  if (r.rows[0].n !== 0) throw new Error("generó " + r.rows[0].n + " movimientos");
  return "sin deuda, como corresponde";
});

await paso("una compra a cuenta corriente SI genera deuda", async () => {
  const items = JSON.stringify([
    { product_id: jamon, qty_received: 5, unit_cost: 25000, allocations: { [ramos]: 5 } },
  ]);
  await db.query(
    "select public.receive_purchase($1, null, true, 'A-0001-00012346', 'cuenta_corriente', null, $2::jsonb)",
    [prov, items]
  );
  const r = await db.query("select public.supplier_balances() as b");
  const saldo = await db.query("select sum(amount)::numeric as s from public.supplier_movements where supplier_id = $1", [prov]);
  if (Number(saldo.rows[0].s) !== 125000) throw new Error("el saldo dio " + saldo.rows[0].s);
  return "le debemos $125.000";
});

await paso("con stock negativo el costo no se vuelve absurdo", async () => {
  const r = await db.query(
    "select * from public.create_product('Producto en rojo', 'kg', 1000, null, 'simple', 500, 0, false, null, null, null, null, 7777)"
  );
  const pid = r.rows[0].id;
  await db.query("select public.adjust_stock($1, $2, -8, 'venta')", [ramos, pid]);
  const items = JSON.stringify([
    { product_id: pid, qty_received: 4, unit_cost: 900, allocations: { [ramos]: 4 } },
  ]);
  await db.query(
    "select public.receive_purchase($1, null, false, null, 'contado', null, $2::jsonb)",
    [prov, items]
  );
  const c = await db.query("select cost from public.products where id = $1", [pid]);
  const costo = Number(c.rows[0].cost);
  if (costo !== 900) throw new Error("el costo dio " + costo + ", esperaba 900");
  return "quedó en $900, el costo de la compra";
});

await paso("no se puede recibir una linea con cantidad cero", async () => {
  const items = JSON.stringify([
    { product_id: jamon, qty_received: 0, unit_cost: 100, allocations: { [ramos]: 0 } },
  ]);
  try {
    await db.query(
      "select public.receive_purchase($1, null, false, null, 'contado', null, $2::jsonb)",
      [prov, items]
    );
  } catch (e) {
    if (!/mayor que cero/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazada, bien";
  }
  throw new Error("lo dejó pasar");
});

await paso("la compra deja movimientos de stock con motivo compra", async () => {
  const r = await db.query(
    "select count(*)::int as n from public.stock_movements where reason = 'compra' and product_id = $1",
    [jamon]
  );
  if (r.rows[0].n !== 3) throw new Error("hay " + r.rows[0].n + " movimientos, esperaba 3");
  return "3 movimientos (Ramos, Mosconi y la segunda compra)";
});

console.log(fallas === 0 ? "\nTodo verde." : `\n${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);

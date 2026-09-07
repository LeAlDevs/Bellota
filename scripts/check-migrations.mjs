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

await paso("la compra NO pisa el costo cargado a mano", async () => {
  // Decisión del dueño (07/09/2026): el costo es manual. La compra a $24.000
  // no puede cambiar el $20.000 que él cargó.
  const r = await db.query("select cost from public.products where id = $1", [jamon]);
  if (Number(r.rows[0].cost) !== 20000) {
    throw new Error("lo pisó: quedó en " + r.rows[0].cost);
  }
  return "sigue en $20.000 aunque compró a $24.000";
});

await paso("pero el sistema avisa de la diferencia", async () => {
  const r = await db.query("select * from public.product_cost_drift() where product_id = $1", [jamon]);
  if (r.rows.length === 0) throw new Error("no reportó la diferencia");
  const d = r.rows[0];
  if (Number(d.last_cost) !== 24000) throw new Error("el último costo dio " + d.last_cost);
  if (Number(d.drift_pct) !== 20) throw new Error("el desvío dio " + d.drift_pct);
  return `cargado $20.000, última compra $24.000, +${d.drift_pct}%`;
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

await paso("update_product puede cambiar el costo a mano", async () => {
  await db.query(
    "select public.update_product($1, 'Bondiola ahumada', 'kg', 31500, null, 'simple', 2, false, null, null, null, null, true, null, 1077, 22500)",
    [jamon]
  );
  const r = await db.query("select cost from public.products where id = $1", [jamon]);
  if (Number(r.rows[0].cost) !== 22500) throw new Error("quedó en " + r.rows[0].cost);
  await db.query(
    "select public.update_product($1, 'Bondiola ahumada', 'kg', 31500, null, 'simple', 2, false, null, null, null, null, true, null, 1077, 20000)",
    [jamon]
  );
  return "de $20.000 a $22.500 y de vuelta, porque lo decide el dueño";
});

await paso("update_product SIN costo deja el que estaba", async () => {
  await db.query(
    "select public.update_product($1, 'Bondiola ahumada', 'kg', 31500, null, 'simple', 2, false, null, null, null, null, true, null, 1077)",
    [jamon]
  );
  const r = await db.query("select cost from public.products where id = $1", [jamon]);
  if (Number(r.rows[0].cost) !== 20000) throw new Error("lo puso en " + r.rows[0].cost);
  return "sigue en $20.000: no lo pone en cero sin querer";
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

// ── POS y caja ────────────────────────────────────────────────────────
let turno, efectivo, debito, jamonPos, picada;

await paso("no se puede vender sin turno abierto", async () => {
  const r = await db.query(
    "select * from public.create_product('Jamón cocido natural', 'kg', 12000, null, 'simple', 9000, 4, false, null, null, null, null, 1052)"
  );
  jamonPos = r.rows[0].id;
  await db.query("select public.adjust_stock($1, $2, 20, 'alta_inicial')", [ramos, jamonPos]);

  const items = JSON.stringify([{ product_id: jamonPos, qty: 0.5, unit_price: 12000 }]);
  try {
    await db.query(
      "select * from public.create_sale($1, $2::jsonb, '[]'::jsonb)",
      [ramos, items]
    );
  } catch (e) {
    if (!/turno de caja abierto/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazada con el mensaje correcto";
  }
  throw new Error("dejó vender con la caja cerrada");
});

await paso("abrir turno con fondo", async () => {
  const r = await db.query("select public.open_cash_session($1, 80000) as id", [ramos]);
  turno = r.rows[0].id;
  return "fondo $80.000";
});

await paso("no se pueden abrir dos turnos en el mismo local", async () => {
  try {
    await db.query("select public.open_cash_session($1, 1000)", [ramos]);
  } catch (e) {
    if (!/turno abierto/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazado, bien";
  }
  throw new Error("abrió dos turnos");
});

await paso("preparo medios de pago y una picada de precio fijo", async () => {
  const e = await db.query("select id from public.payment_methods where name = 'Efectivo'");
  const d = await db.query("select id from public.payment_methods where name = 'Débito'");
  efectivo = e.rows[0].id;
  debito = d.rows[0].id;
  const r = await db.query(
    "select * from public.create_product('Picada Ibérico para cuatro', 'unidad', 47000, null, 'elaborado', 27730, 2, true, 4, null, null, null, null)"
  );
  picada = r.rows[0].id;
  await db.query("select public.adjust_stock($1, $2, 10, 'produccion_alta')", [ramos, picada]);
  return "efectivo, débito y la picada";
});

let venta;
await paso("una venta mezcla lo pesado con lo de precio fijo", async () => {
  const items = JSON.stringify([
    { product_id: jamonPos, qty: 0.35, unit_price: 12000, source: "etiqueta", scale_code: "2010520042005" },
    { product_id: picada, qty: 1, unit_price: 47000, source: "busqueda" },
  ]);
  // 0,35 x 12000 = 4200 · picada 47000 · total 51200
  const pagos = JSON.stringify([
    { payment_method_id: efectivo, amount: 21200 },
    { payment_method_id: debito, amount: 30000 },
  ]);
  const r = await db.query(
    "select * from public.create_sale($1, $2::jsonb, $3::jsonb, true, 0, 'pos', 'verificado')",
    [ramos, items, pagos]
  );
  venta = r.rows[0];
  if (Number(venta.total) !== 51200) throw new Error("el total dio " + venta.total);
  return `venta #${venta.number} · $${venta.total}`;
});

await paso("la venta descontó el stock de los dos productos", async () => {
  const a = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, jamonPos]);
  const b = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, picada]);
  if (Number(a.rows[0].qty) !== 19.65) throw new Error("el jamón quedó en " + a.rows[0].qty);
  if (Number(b.rows[0].qty) !== 9) throw new Error("la picada quedó en " + b.rows[0].qty);
  return "jamón 19,650 kg · picada 9";
});

await paso("guardó el costo del momento en cada línea", async () => {
  const r = await db.query(
    "select cost_snapshot, source, scale_code from public.sale_items where sale_id = $1 order by subtotal",
    [venta.id]
  );
  if (Number(r.rows[0].cost_snapshot) !== 9000) throw new Error("el costo quedó en " + r.rows[0].cost_snapshot);
  if (r.rows[0].source !== "etiqueta") throw new Error("perdió el origen de la línea");
  if (!r.rows[0].scale_code) throw new Error("no guardó el código de la etiqueta");
  return "costo $9.000, origen etiqueta, con el código crudo";
});

await paso("el costo del momento NO se mueve cuando cambia el costo del producto", async () => {
  await db.query("update public.products set cost = 11000 where id = $1", [jamonPos]);
  const r = await db.query(
    "select cost_snapshot from public.sale_items where sale_id = $1 and product_id = $2",
    [venta.id, jamonPos]
  );
  if (Number(r.rows[0].cost_snapshot) !== 9000) {
    throw new Error("el margen histórico se movió: quedó en " + r.rows[0].cost_snapshot);
  }
  await db.query("update public.products set cost = 9000 where id = $1", [jamonPos]);
  return "sigue en $9.000 aunque el producto ahora cueste $11.000";
});

await paso("los pagos tienen que cubrir la venta", async () => {
  const items = JSON.stringify([{ product_id: picada, qty: 1, unit_price: 47000 }]);
  const pagos = JSON.stringify([{ payment_method_id: efectivo, amount: 10000 }]);
  try {
    await db.query(
      "select * from public.create_sale($1, $2::jsonb, $3::jsonb)",
      [ramos, items, pagos]
    );
  } catch (e) {
    if (!/pagos suman/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazada: pagaban $10.000 de $47.000";
  }
  throw new Error("dejó cobrar de menos");
});

await paso("una venta rechazada no descuenta stock ni gasta numero", async () => {
  const q = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, picada]);
  if (Number(q.rows[0].qty) !== 9) throw new Error("el stock se movió igual: " + q.rows[0].qty);
  const n = await db.query("select count(*)::int as n from public.sales");
  if (n.rows[0].n !== 1) throw new Error("quedaron " + n.rows[0].n + " ventas");
  return "stock intacto y una sola venta";
});

await paso("un producto por unidad no se puede vender fraccionado", async () => {
  const items = JSON.stringify([{ product_id: picada, qty: 0.5, unit_price: 47000 }]);
  const pagos = JSON.stringify([{ payment_method_id: efectivo, amount: 23500 }]);
  try {
    await db.query("select * from public.create_sale($1, $2::jsonb, $3::jsonb)", [ramos, items, pagos]);
  } catch (e) {
    if (!/por unidad/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "media picada no existe";
  }
  throw new Error("vendió media picada");
});

await paso("el stock puede quedar negativo: la mercadería ya está en la mano", async () => {
  const items = JSON.stringify([{ product_id: picada, qty: 20, unit_price: 47000 }]);
  const pagos = JSON.stringify([{ payment_method_id: efectivo, amount: 940000 }]);
  const r = await db.query(
    "select * from public.create_sale($1, $2::jsonb, $3::jsonb)",
    [ramos, items, pagos]
  );
  const q = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, picada]);
  if (Number(q.rows[0].qty) >= 0) throw new Error("no quedó negativo");
  await db.query("select public.cancel_sale($1, 'prueba')", [r.rows[0].id]);
  return "vendió igual y quedó en " + q.rows[0].qty;
});

await paso("anular repone el stock y no borra la venta", async () => {
  const q = await db.query("select qty from public.stock where store_id = $1 and product_id = $2", [ramos, picada]);
  if (Number(q.rows[0].qty) !== 9) throw new Error("no repuso: quedó en " + q.rows[0].qty);
  const s = await db.query("select count(*)::int as n from public.sales where status = 'anulada'");
  if (s.rows[0].n !== 1) throw new Error("la venta desapareció");
  return "stock en 9 y la venta queda como anulada";
});

await paso("el arqueo cuenta el efectivo y NO la tarjeta", async () => {
  // fondo 80.000 + efectivo de la venta 21.200 = 101.200
  const r = await db.query("select public.expected_cash($1) as e", [turno]);
  if (Number(r.rows[0].e) !== 101200) throw new Error("esperaba 101200 y dio " + r.rows[0].e);
  return "$101.200 = fondo $80.000 + $21.200 en efectivo (los $30.000 de débito no)";
});

await paso("una venta anulada no cuenta en el arqueo", async () => {
  const r = await db.query("select public.expected_cash($1) as e", [turno]);
  if (Number(r.rows[0].e) !== 101200) throw new Error("la anulada sumó: dio " + r.rows[0].e);
  return "sigue en $101.200";
});

await paso("un retiro baja lo esperado en el cajón", async () => {
  await db.query(
    "select public.register_cash_movement($1, -20000, 'retiro', 'Retiro del dueño')",
    [turno]
  );
  const r = await db.query("select public.expected_cash($1) as e", [turno]);
  if (Number(r.rows[0].e) !== 81200) throw new Error("dio " + r.rows[0].e);
  return "$81.200 después de un retiro de $20.000";
});

await paso("el cierre calcula la diferencia contra lo contado", async () => {
  const r = await db.query(
    "select * from public.close_cash_session($1, 80700, 'Faltaron 500')",
    [turno]
  );
  const c = r.rows[0];
  if (Number(c.expected_cash) !== 81200) throw new Error("esperado " + c.expected_cash);
  if (Number(c.difference) !== -500) throw new Error("diferencia " + c.difference);
  if (c.status !== "cerrada") throw new Error("no lo cerró");
  return "contó $80.700 sobre $81.200 esperados: faltan $500";
});

await paso("un turno cerrado no se cierra dos veces", async () => {
  try {
    await db.query("select public.close_cash_session($1, 1000)", [turno]);
  } catch (e) {
    if (!/ya está cerrado/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazado";
  }
  throw new Error("lo cerró de nuevo");
});

await paso("los numeros de venta no se repiten", async () => {
  const r = await db.query(
    "select count(*)::int as total, count(distinct number)::int as distintos from public.sales"
  );
  if (r.rows[0].total !== r.rows[0].distintos) throw new Error("hay números repetidos");
  return `${r.rows[0].total} ventas, ${r.rows[0].distintos} números distintos`;
});

// ── Lotes y vencimiento ───────────────────────────────────────────────
let queso;
await paso("un producto con vencimiento exige la fecha al recibirlo", async () => {
  const r = await db.query(
    "select * from public.create_product('Queso cremoso', 'unidad', 9800, null, 'simple', 6200, 4, true, 20, null, null, null, 2099)"
  );
  queso = r.rows[0].id;
  const items = JSON.stringify([
    { product_id: queso, qty_received: 2, unit_cost: 6200, allocations: { [ramos]: 2 } },
  ]);
  try {
    await db.query(
      "select public.receive_purchase($1, null, false, null, 'contado', null, $2::jsonb)",
      [prov, items]
    );
  } catch (e) {
    if (!/vencimiento/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "sin fecha no entra";
  }
  throw new Error("dejó entrar mercadería que vence sin fecha");
});

await paso("LA PREGUNTA DEL DUEÑO: 4 iguales, 2 vencen en 3 dias y 2 en una semana", async () => {
  const hoy = new Date();
  const enDias = (d) => new Date(hoy.getTime() + d * 86400000).toISOString().slice(0, 10);

  for (const [dias, cant] of [[3, 2], [7, 2]]) {
    const items = JSON.stringify([
      {
        product_id: queso,
        qty_received: cant,
        unit_cost: 6200,
        expires_on: enDias(dias),
        allocations: { [ramos]: cant },
      },
    ]);
    await db.query(
      "select public.receive_purchase($1, null, false, null, 'contado', null, $2::jsonb)",
      [prov, items]
    );
  }

  const lotes = await db.query(
    "select expires_on, qty_remaining from public.stock_lots where product_id = $1 order by expires_on",
    [queso]
  );
  if (lotes.rows.length !== 2) throw new Error("armó " + lotes.rows.length + " lotes");
  if (Number(lotes.rows[0].qty_remaining) !== 2 || Number(lotes.rows[1].qty_remaining) !== 2) {
    throw new Error("las cantidades quedaron mal");
  }
  const stock = await db.query(
    "select qty from public.stock where store_id = $1 and product_id = $2",
    [ramos, queso]
  );
  if (Number(stock.rows[0].qty) !== 4) throw new Error("el stock quedó en " + stock.rows[0].qty);
  return "1 producto, 4 unidades, 2 lotes: uno vence en 3 días y otro en 7";
});

await paso("vender descuenta del lote que vence primero, sin preguntarle al cajero", async () => {
  await db.query("select public.adjust_stock($1, $2, -2, 'venta')", [ramos, queso]);
  const r = await db.query(
    "select expires_on, qty_remaining from public.stock_lots where product_id = $1 order by expires_on",
    [queso]
  );
  if (Number(r.rows[0].qty_remaining) !== 0) {
    throw new Error("el lote viejo quedó en " + r.rows[0].qty_remaining);
  }
  if (Number(r.rows[1].qty_remaining) !== 2) {
    throw new Error("tocó el lote nuevo: quedó en " + r.rows[1].qty_remaining);
  }
  return "se llevó las 2 del lote de 3 días y no tocó el de 7";
});

await paso("dar de baja un lote vencido sale como merma con motivo", async () => {
  const l = await db.query(
    "select id from public.stock_lots where product_id = $1 and qty_remaining > 0 limit 1",
    [queso]
  );
  await db.query("select public.write_off_lot($1)", [l.rows[0].id]);

  const m = await db.query(
    "select reason, motive, delta from public.stock_movements where product_id = $1 order by created_at desc limit 1",
    [queso]
  );
  if (m.rows[0].reason !== "merma" || m.rows[0].motive !== "vencido") {
    throw new Error(`quedó ${m.rows[0].reason}/${m.rows[0].motive}`);
  }
  const q = await db.query(
    "select qty from public.stock where store_id = $1 and product_id = $2",
    [ramos, queso]
  );
  if (Number(q.rows[0].qty) !== 0) throw new Error("el stock quedó en " + q.rows[0].qty);
  return "merma por vencido, y el stock bajó a 0";
});

await paso("la transferencia se lleva el lote con su fecha", async () => {
  const hoy = new Date();
  const vence = new Date(hoy.getTime() + 10 * 86400000).toISOString().slice(0, 10);
  const items = JSON.stringify([
    { product_id: queso, qty_received: 6, unit_cost: 6200, expires_on: vence, allocations: { [ramos]: 6 } },
  ]);
  await db.query(
    "select public.receive_purchase($1, null, false, null, 'contado', null, $2::jsonb)",
    [prov, items]
  );

  const t = JSON.stringify([{ product_id: queso, qty: 4 }]);
  await db.query("select public.create_transfer($1, $2, $3::jsonb, null)", [ramos, mosconi, t]);

  const destino = await db.query(
    "select expires_on, qty_remaining from public.stock_lots where store_id = $1 and product_id = $2 and qty_remaining > 0",
    [mosconi, queso]
  );
  if (destino.rows.length !== 1) throw new Error("en el destino hay " + destino.rows.length + " lotes");
  if (Number(destino.rows[0].qty_remaining) !== 4) {
    throw new Error("llegaron " + destino.rows[0].qty_remaining);
  }
  const origen = await db.query(
    "select sum(qty_remaining)::numeric as q from public.stock_lots where store_id = $1 and product_id = $2",
    [ramos, queso]
  );
  if (Number(origen.rows[0].q) !== 2) throw new Error("en el origen quedaron " + origen.rows[0].q);
  return "4 al destino con la misma fecha, 2 quedaron en el origen";
});

await paso("un producto que NO vence no genera lotes", async () => {
  const r = await db.query(
    "select count(*)::int as n from public.stock_lots l join public.products p on p.id = l.product_id where not p.track_expiry"
  );
  if (r.rows[0].n !== 0) throw new Error("armó " + r.rows[0].n + " lotes de más");
  return "ninguno";
});

// ── El importe de la etiqueta manda sobre cantidad x precio ───────────
await paso("la linea de etiqueta cobra el importe del ticket, no el recalculado", async () => {
  // Caso real de la primera prueba (07/09/2026): el ticket decía $5.400 y el
  // mostrador quería cobrar $5.377,20 porque redondeaba el peso y volvía a
  // multiplicar. El cliente tiene el papel en la mano.
  await db.query("select public.open_cash_session($1, 0)", [mosconi]);

  const a = await db.query(
    "select * from public.create_product('JAMON COCIDO 8VA', 'kg', 26400, null, 'simple', 18000, 0, false, null, null, null, null, 65)"
  );
  const b = await db.query(
    "select * from public.create_product('JAMON COCIDO 42', 'kg', 30000, null, 'simple', 21000, 0, false, null, null, null, null, 66)"
  );
  await db.query("select public.adjust_stock($1, $2, 5, 'alta_inicial')", [mosconi, a.rows[0].id]);
  await db.query("select public.adjust_stock($1, $2, 5, 'alta_inicial')", [mosconi, b.rows[0].id]);

  // Lo que arma el mostrador al escanear: peso reconstruido (redondeado) más
  // el importe que traía la etiqueta.
  const items = JSON.stringify([
    { product_id: a.rows[0].id, qty: 0.098, unit_price: 26400, subtotal: 2600, source: "etiqueta" },
    { product_id: b.rows[0].id, qty: 0.093, unit_price: 30000, subtotal: 2800, source: "etiqueta" },
  ]);
  const efe = await db.query("select id from public.payment_methods where name = 'Efectivo'");
  const pagos = JSON.stringify([{ payment_method_id: efe.rows[0].id, amount: 5400 }]);

  const r = await db.query(
    "select * from public.create_sale($1, $2::jsonb, $3::jsonb)",
    [mosconi, items, pagos]
  );
  if (Number(r.rows[0].total) !== 5400) {
    throw new Error("cobró " + r.rows[0].total + " y el ticket decía 5400");
  }
  return "$5.400, igual que el ticket (antes daba $5.377,20)";
});

await paso("sin importe de etiqueta, la linea se sigue calculando sola", async () => {
  const p = await db.query("select id from public.products where plu = 65");
  const efe = await db.query("select id from public.payment_methods where name = 'Efectivo'");
  const items = JSON.stringify([
    { product_id: p.rows[0].id, qty: 0.25, unit_price: 26400, source: "manual" },
  ]);
  const pagos = JSON.stringify([{ payment_method_id: efe.rows[0].id, amount: 6600 }]);
  const r = await db.query(
    "select * from public.create_sale($1, $2::jsonb, $3::jsonb)",
    [mosconi, items, pagos]
  );
  if (Number(r.rows[0].total) !== 6600) throw new Error("dio " + r.rows[0].total);
  return "0,250 kg x $26.400 = $6.600";
});

// ── Devoluciones y reportes ───────────────────────────────────────────
let ventaDev, itemDev, turnoMos, reporteAntes;

await paso("preparo una venta para devolver", async () => {
  const t = await db.query(
    "select id from public.cash_sessions where store_id = $1 and status = 'abierta'",
    [mosconi]
  );
  turnoMos = t.rows[0].id;

  const p = await db.query("select id from public.products where plu = 66");
  itemDev = p.rows[0].id;
  const efe = await db.query("select id from public.payment_methods where name = 'Efectivo'");

  await db.query("select public.adjust_stock($1, $2, 10, 'alta_inicial')", [mosconi, itemDev]);

  // El producto ya tiene ventas de casos anteriores: el reporte se compara
  // contra este estado, no contra cero.
  const hoyRep = new Date().toISOString().slice(0, 10);
  const antes = await db.query(
    "select * from public.report_sales_by_product($1::date, $1::date, $2, false) where product_id = $3",
    [hoyRep, mosconi, itemDev]
  );
  reporteAntes = antes.rows[0]
    ? { qty: Number(antes.rows[0].qty), revenue: Number(antes.rows[0].revenue) }
    : { qty: 0, revenue: 0 };

  const items = JSON.stringify([
    { product_id: itemDev, qty: 2, unit_price: 30000, source: "busqueda" },
  ]);
  const pagos = JSON.stringify([{ payment_method_id: efe.rows[0].id, amount: 60000 }]);
  const r = await db.query(
    "select * from public.create_sale($1, $2::jsonb, $3::jsonb)",
    [mosconi, items, pagos]
  );
  ventaDev = r.rows[0];
  return `venta #${ventaDev.number} por $${ventaDev.total}`;
});

await paso("no se puede devolver mas de lo que se vendio", async () => {
  const li = await db.query("select id from public.sale_items where sale_id = $1", [ventaDev.id]);
  const items = JSON.stringify([{ sale_item_id: li.rows[0].id, qty: 5 }]);
  try {
    await db.query("select public.create_return($1, $2::jsonb, null)", [ventaDev.id, items]);
  } catch (e) {
    if (!/no se pueden devolver/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "vendió 2 y quiso devolver 5: rechazado";
  }
  throw new Error("dejó devolver de más");
});

await paso("la devolucion repone stock y saca plata del cajon", async () => {
  const antesStock = await db.query(
    "select qty from public.stock where store_id = $1 and product_id = $2",
    [mosconi, itemDev]
  );
  const antesCaja = await db.query("select public.expected_cash($1) as e", [turnoMos]);

  const li = await db.query("select id from public.sale_items where sale_id = $1", [ventaDev.id]);
  const items = JSON.stringify([{ sale_item_id: li.rows[0].id, qty: 1 }]);
  await db.query("select public.create_return($1, $2::jsonb, 'Se lo llevó fallado')", [
    ventaDev.id,
    items,
  ]);

  const despuesStock = await db.query(
    "select qty from public.stock where store_id = $1 and product_id = $2",
    [mosconi, itemDev]
  );
  const despuesCaja = await db.query("select public.expected_cash($1) as e", [turnoMos]);

  const dStock = Number(despuesStock.rows[0].qty) - Number(antesStock.rows[0].qty);
  const dCaja = Number(despuesCaja.rows[0].e) - Number(antesCaja.rows[0].e);
  if (dStock !== 1) throw new Error("el stock subió " + dStock);
  if (dCaja !== -30000) throw new Error("la caja cambió " + dCaja);
  return "+1 al stock y −$30.000 del cajón";
});

await paso("devolver la parte restante sí se puede", async () => {
  const li = await db.query("select id from public.sale_items where sale_id = $1", [ventaDev.id]);
  const items = JSON.stringify([{ sale_item_id: li.rows[0].id, qty: 1 }]);
  await db.query("select public.create_return($1, $2::jsonb, null)", [ventaDev.id, items]);
  const r = await db.query("select public.returned_qty($1) as q", [li.rows[0].id]);
  if (Number(r.rows[0].q) !== 2) throw new Error("devuelto " + r.rows[0].q);
  return "las 2 devueltas, ni una más";
});

await paso("ahora ya no queda nada por devolver", async () => {
  const li = await db.query("select id from public.sale_items where sale_id = $1", [ventaDev.id]);
  const items = JSON.stringify([{ sale_item_id: li.rows[0].id, qty: 1 }]);
  try {
    await db.query("select public.create_return($1, $2::jsonb, null)", [ventaDev.id, items]);
  } catch {
    return "rechazado, bien";
  }
  throw new Error("dejó devolver una tercera");
});

await paso("no se devuelve contra una venta anulada", async () => {
  const anulada = await db.query("select id from public.sales where status = 'anulada' limit 1");
  const li = await db.query("select id from public.sale_items where sale_id = $1", [
    anulada.rows[0].id,
  ]);
  if (li.rows.length === 0) return "la anulada no tiene líneas para probar";
  const items = JSON.stringify([{ sale_item_id: li.rows[0].id, qty: 1 }]);
  try {
    await db.query("select public.create_return($1, $2::jsonb, null)", [
      anulada.rows[0].id,
      items,
    ]);
  } catch (e) {
    if (!/anulada/i.test(e.message)) throw new Error("falló por otra cosa: " + e.message);
    return "rechazado";
  }
  throw new Error("dejó devolver de una venta anulada");
});

await paso("el reporte por producto netea las devoluciones", async () => {
  // Se vendieron 2 unidades por $60.000 y se devolvieron las 2: el reporte
  // tiene que quedar exactamente como estaba antes de esa venta.
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await db.query(
    "select * from public.report_sales_by_product($1::date, $1::date, $2, false) where product_id = $3",
    [hoy, mosconi, itemDev]
  );
  const ahora = r.rows[0]
    ? { qty: Number(r.rows[0].qty), revenue: Number(r.rows[0].revenue) }
    : { qty: 0, revenue: 0 };

  if (Math.abs(ahora.qty - reporteAntes.qty) > 0.0005) {
    throw new Error(`la cantidad pasó de ${reporteAntes.qty} a ${ahora.qty}`);
  }
  if (Math.abs(ahora.revenue - reporteAntes.revenue) > 0.01) {
    throw new Error(`la venta pasó de ${reporteAntes.revenue} a ${ahora.revenue}`);
  }
  return `vendí 2 por $60.000 y devolví las 2: el reporte quedó igual (${ahora.qty} / $${ahora.revenue})`;
});

await paso("el reporte por producto calcula el margen", async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await db.query(
    "select * from public.report_sales_by_product($1::date, $1::date, null, false)",
    [hoy]
  );
  if (r.rows.length === 0) throw new Error("no devolvió ninguna fila");
  const con = r.rows.find((x) => Number(x.revenue) > 0 && Number(x.cost) > 0);
  if (!con) throw new Error("ninguna fila tiene costo cargado");
  const esperado = Number(con.revenue) - Number(con.cost);
  if (Math.abs(Number(con.margin) - esperado) > 0.01) {
    throw new Error("el margen dio " + con.margin);
  }
  return `${con.name}: venta $${con.revenue}, costo $${con.cost}, margen $${con.margin}`;
});

await paso("el resumen del periodo cierra", async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await db.query(
    "select * from public.report_sales_summary($1::date, $1::date, null, false)",
    [hoy]
  );
  const s = r.rows[0];
  if (!s) throw new Error("no devolvió resumen");
  if (Number(s.returned) <= 0) throw new Error("no contó las devoluciones");
  const esperado = Number(s.revenue) - Number(s.cost);
  if (Math.abs(Number(s.margin) - esperado) > 0.01) {
    throw new Error("el margen del resumen no cierra");
  }
  return `${s.tickets} tickets · devuelto $${s.returned} · ${s.cancelled} anuladas`;
});

await paso("el reporte por hora agrupa en hora de Buenos Aires", async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await db.query(
    "select * from public.report_sales_by_hour($1::date, $1::date, null)",
    [hoy]
  );
  if (r.rows.length === 0) throw new Error("no devolvió ninguna hora");
  const total = r.rows.reduce((a, x) => a + Number(x.tickets), 0);
  if (total === 0) throw new Error("no contó tickets");
  return `${r.rows.length} franja(s), ${total} tickets`;
});

console.log(fallas === 0 ? "\nTodo verde." : `\n${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);

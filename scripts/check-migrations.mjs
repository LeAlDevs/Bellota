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
await paso("create_product asigna PLU 1000", async () => {
  const r = await db.query(
    "select * from public.create_product('Jamón crudo estacionado', 'kg', 42900, null, 'simple', 28314, 5, false, null, null, null, null, null)"
  );
  prod1 = r.rows[0];
  if (prod1.plu !== 1000) throw new Error("PLU esperado 1000, salió " + prod1.plu);
  return `PLU ${prod1.plu}`;
});

await paso("el segundo producto saca 1001, no repite", async () => {
  const r = await db.query(
    "select * from public.create_product('Queso sardo', 'kg', 28400, null, 'simple', 20164, 3, false, null, null, null, null, null)"
  );
  if (r.rows[0].plu !== 1001) throw new Error("PLU esperado 1001, salió " + r.rows[0].plu);
  return `PLU ${r.rows[0].plu}`;
});

await paso("el alta dejó el precio en price_history", async () => {
  const r = await db.query("select count(*)::int as n from public.price_history");
  if (r.rows[0].n !== 2) throw new Error("esperaba 2 filas, hay " + r.rows[0].n);
});

await paso("update_product registra el cambio de precio", async () => {
  await db.query(
    "select public.update_product($1, 'Jamón crudo estacionado', 'kg', 45900, null, 'simple', 5, false, null, null, null, null, true, 'aumento del proveedor')",
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

await paso("un PLU dado de baja NO se reutiliza", async () => {
  const antes = await db.query("select max(plu)::int as m from public.products");
  await db.query("delete from public.products where plu = $1", [antes.rows[0].m]);
  const r = await db.query(
    "select * from public.create_product('Producto nuevo', 'unidad', 100, null, 'simple', 0, 0, false, null, null, null, null, null)"
  );
  if (r.rows[0].plu <= antes.rows[0].m) {
    throw new Error(`reutilizó el ${r.rows[0].plu}`);
  }
  return `borré el ${antes.rows[0].m}, el nuevo sacó ${r.rows[0].plu}`;
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

await paso("sin PLU en la planilla, Bellota se lo asigna", async () => {
  const r = await db.query(
    "select plu from public.products where name = 'Mortadela con pistacho'"
  );
  if (!r.rows[0].plu) throw new Error("quedó sin PLU");
  return `PLU ${r.rows[0].plu}`;
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

console.log(fallas === 0 ? "\nTodo verde." : `\n${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);

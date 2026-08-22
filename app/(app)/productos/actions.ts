"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * formData.get() devuelve null si el campo no está en el form (por ejemplo un
 * checkbox sin marcar). Normalizar a undefined ANTES de validar.
 */
function str(v: FormDataEntryValue | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** Acepta coma o punto como separador decimal: en el mostrador se tipea coma. */
function num(v: FormDataEntryValue | null): number | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true" || v === "1";
}

const schema = z.object({
  name: z.string().min(2, "Poné un nombre de al menos 2 letras.").max(120),
  unit_type: z.enum(["kg", "unidad"], { message: "Elegí si se pesa o se cuenta." }),
  kind: z.enum(["simple", "elaborado", "combo"]).default("simple"),
  price: z.number({ message: "El precio tiene que ser un número." }).min(0, "El precio no puede ser negativo."),
  cost: z.number().min(0, "El costo no puede ser negativo.").optional(),
  category_id: z.uuid().optional(),
  min_stock: z.number().min(0, "El mínimo no puede ser negativo.").optional(),
  track_expiry: z.boolean().default(false),
  shelf_life_days: z.number().int().positive("Los días tienen que ser mayores a cero.").optional(),
  barcode: z.string().max(40).optional(),
  sku: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
});

function parse(formData: FormData) {
  return schema.safeParse({
    name: str(formData.get("name")),
    unit_type: str(formData.get("unit_type")),
    kind: str(formData.get("kind")) ?? "simple",
    price: num(formData.get("price")),
    cost: num(formData.get("cost")),
    category_id: str(formData.get("category_id")),
    min_stock: num(formData.get("min_stock")),
    track_expiry: bool(formData.get("track_expiry")),
    shelf_life_days: num(formData.get("shelf_life_days")),
    barcode: str(formData.get("barcode")),
    sku: str(formData.get("sku")),
    description: str(formData.get("description")),
  });
}

export async function crearProducto(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const parsed = parse(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;

  const sb = await createClient();
  // create_product devuelve la fila entera (tipo compuesto, no SETOF): PostgREST
  // ya responde un objeto, así que NO hay que pedir .single().
  const { data, error } = await sb
    .rpc("create_product", {
      p_name: d.name,
      p_unit_type: d.unit_type,
      p_price: d.price,
      p_category_id: d.category_id ?? null,
      p_kind: d.kind,
      p_cost: d.cost ?? 0,
      p_min_stock: d.min_stock ?? 0,
      p_track_expiry: d.track_expiry,
      p_shelf_life_days: d.track_expiry ? (d.shelf_life_days ?? null) : null,
      p_barcode: d.barcode ?? null,
      p_sku: d.sku ?? null,
      p_description: d.description ?? null,
    });

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya hay un producto con ese PLU o ese código de barras." };
    }
    return { error: error.message };
  }

  const creado = (Array.isArray(data) ? data[0] : data) as { id: string } | null;
  if (!creado?.id) return { error: "El producto se creó pero no pude leerlo." };

  revalidatePath("/productos");
  redirect(`/productos/${creado.id}?alta=1`);
}

export async function editarProducto(
  id: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const parsed = parse(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.rpc("update_product", {
    p_id: id,
    p_name: d.name,
    p_unit_type: d.unit_type,
    p_price: d.price,
    p_category_id: d.category_id ?? null,
    p_kind: d.kind,
    p_min_stock: d.min_stock ?? 0,
    p_track_expiry: d.track_expiry,
    p_shelf_life_days: d.track_expiry ? (d.shelf_life_days ?? null) : null,
    p_barcode: d.barcode ?? null,
    p_sku: d.sku ?? null,
    p_description: d.description ?? null,
    p_is_active: bool(formData.get("is_active")),
    p_price_reason: str(formData.get("price_reason")) ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/productos");
  revalidatePath(`/productos/${id}`);
  return { ok: true };
}

/** Baja lógica. El PLU queda reservado de por vida: nunca se reutiliza. */
export async function alternarActivo(
  id: string,
  activo: boolean
): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const sb = await createClient();
  const { data: p, error: readError } = await sb
    .from("products")
    .select(
      "name, unit_type, price, category_id, kind, min_stock, track_expiry, shelf_life_days, barcode, sku, description"
    )
    .eq("id", id)
    .maybeSingle();

  if (readError || !p) return { error: "No encontré ese producto." };

  const { error } = await sb.rpc("update_product", {
    p_id: id,
    p_name: p.name,
    p_unit_type: p.unit_type,
    p_price: p.price,
    p_category_id: p.category_id,
    p_kind: p.kind,
    p_min_stock: p.min_stock,
    p_track_expiry: p.track_expiry,
    p_shelf_life_days: p.shelf_life_days,
    p_barcode: p.barcode,
    p_sku: p.sku,
    p_description: p.description,
    p_is_active: activo,
    p_price_reason: null,
  });

  if (error) return { error: error.message };

  revalidatePath("/productos");
  revalidatePath(`/productos/${id}`);
  return { ok: true };
}

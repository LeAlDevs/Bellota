"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FORMATO_POR_DEFECTO, pluMaximo } from "@/lib/balanza";

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
  // El PLU sale de la balanza. Puede no existir: los envasados de fábrica se
  // venden por su código de barras y no pasan nunca por la balanza.
  //
  // El tope y el número reservado salen del formato real de la etiqueta: el
  // PLU ocupa 4 dígitos, y el 2000 lo usa la balanza para el total de la
  // operación. Un producto con PLU 2000 haría que el total de un ticket se
  // escanee como ese producto.
  plu: z
    .number()
    .int("El PLU es un número entero.")
    .min(1, "El PLU tiene que ser mayor a cero.")
    .max(
      pluMaximo(),
      `El PLU no puede pasar de ${pluMaximo()}: no entra en el código de barras de la balanza.`
    )
    .refine((v) => v !== FORMATO_POR_DEFECTO.pluTotal, {
      message: `El ${FORMATO_POR_DEFECTO.pluTotal} lo usa la balanza para el total del ticket. Elegí otro.`,
    })
    .optional(),
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
    plu: num(formData.get("plu")),
    min_stock: num(formData.get("min_stock")),
    track_expiry: bool(formData.get("track_expiry")),
    shelf_life_days: num(formData.get("shelf_life_days")),
    barcode: str(formData.get("barcode")),
    sku: str(formData.get("sku")),
    description: str(formData.get("description")),
  });
}

function errorLegible(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return error.message.includes("plu")
      ? "Ese PLU ya está usado por otro producto. Fijate en la balanza cuál corresponde."
      : "Ese código de barras ya está cargado en otro producto.";
  }
  return error.message;
}

/** Propone un PLU libre para un producto nuevo que todavía no está en la balanza. */
export async function sugerirPlu(): Promise<{ plu?: number; error?: string }> {
  const denied = await requireCan("productos", true);
  if (denied) return { error: denied.error };

  const sb = await createClient();
  const { data, error } = await sb.rpc("suggest_plu");
  if (error) return { error: error.message };
  return { plu: data as number };
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
  const { data, error } = await sb.rpc("create_product", {
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
    p_plu: d.plu ?? null,
  });

  if (error) return { error: errorLegible(error) };

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
    p_plu: d.plu ?? null,
  });

  if (error) return { error: errorLegible(error) };

  revalidatePath("/productos");
  revalidatePath(`/productos/${id}`);
  return { ok: true };
}

/**
 * Baja lógica. Va por su propia función para no pasar por update_product, que
 * pisa todos los campos: un llamador distraído le borraría el PLU al producto.
 */
export async function alternarActivo(
  id: string,
  activo: boolean
): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("set_product_active", {
    p_id: id,
    p_active: activo,
  });

  if (error) return { error: error.message };

  revalidatePath("/productos");
  revalidatePath(`/productos/${id}`);
  return { ok: true };
}

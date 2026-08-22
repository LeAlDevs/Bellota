"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function num(v: FormDataEntryValue | null): number | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

const ajusteSchema = z
  .object({
    store_id: z.uuid("Elegí el local."),
    product_id: z.uuid("Elegí el producto."),
    mode: z.enum(["merma", "conteo"]),
    qty: z
      .number({ message: "La cantidad tiene que ser un número." })
      .min(0, "La cantidad no puede ser negativa."),
    motive: z
      .enum(["vencido", "roto", "mal_estado", "degustacion", "error_de_carga", "robo"])
      .optional(),
    note: z.string().max(300).optional(),
  })
  .refine((d) => d.mode !== "merma" || d.motive !== undefined, {
    message: "Elegí el motivo de la merma.",
    path: ["motive"],
  })
  .refine((d) => d.mode !== "merma" || d.qty > 0, {
    message: "Una merma de cero no se registra.",
    path: ["qty"],
  });

export async function registrarAjuste(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireCan("stock", true);
  if (denied) return denied;

  const parsed = ajusteSchema.safeParse({
    store_id: str(formData.get("store_id")),
    product_id: str(formData.get("product_id")),
    mode: str(formData.get("mode")),
    qty: num(formData.get("qty")),
    motive: str(formData.get("motive")),
    note: str(formData.get("note")),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.rpc("register_stock_adjustment", {
    p_store_id: d.store_id,
    p_product_id: d.product_id,
    p_mode: d.mode,
    p_qty: d.qty,
    p_motive: d.motive ?? null,
    p_note: d.note ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/stock");
  revalidatePath("/stock/movimientos");
  revalidatePath("/stock/ajustes");
  return { ok: true };
}

const transferSchema = z.object({
  from_store: z.uuid("Elegí el local de origen."),
  to_store: z.uuid("Elegí el local de destino."),
  note: z.string().max(300).optional(),
  items: z
    .array(
      z.object({
        product_id: z.uuid(),
        qty: z.number().positive(),
      })
    )
    .min(1, "Agregá al menos un producto."),
});

export async function crearTransferencia(
  fromStore: string,
  toStore: string,
  items: { product_id: string; qty: number }[],
  note?: string
): Promise<ActionState> {
  const denied = await requireCan("stock", true);
  if (denied) return denied;

  const parsed = transferSchema.safeParse({
    from_store: fromStore,
    to_store: toStore,
    items,
    note,
  });

  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      error:
        flat.formErrors[0] ??
        Object.values(flat.fieldErrors).flat()[0] ??
        "Revisá los datos de la transferencia.",
    };
  }

  if (fromStore === toStore) {
    return { error: "El origen y el destino son el mismo local." };
  }

  const sb = await createClient();
  const { error } = await sb.rpc("create_transfer", {
    p_from_store: fromStore,
    p_to_store: toStore,
    p_items: items,
    p_note: note ?? null,
  });

  // Los mensajes de la función SQL ya están escritos para que los lea una
  // persona ("No alcanza el stock de Queso sardo en el origen: hay 2 y querés
  // mandar 5"), así que se pasan tal cual en vez de taparlos con un genérico.
  if (error) return { error: error.message };

  revalidatePath("/stock");
  revalidatePath("/stock/transferencias");
  revalidatePath("/stock/movimientos");
  return { ok: true };
}

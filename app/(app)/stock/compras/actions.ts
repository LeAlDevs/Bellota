"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LineaCompra = {
  product_id: string;
  qty_ordered?: number;
  qty_received: number;
  unit_cost: number;
  /** { store_id: cantidad } — tiene que sumar exactamente lo recibido. */
  allocations: Record<string, number>;
  /** Obligatoria si el producto lleva control de vencimiento. */
  expires_on?: string;
  lot_code?: string;
};

const proveedorSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Poné un nombre de al menos 2 letras.").max(120),
  cuit: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(300).optional(),
});

function str(v: FormDataEntryValue | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

export async function guardarProveedor(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireCan("compras", true);
  if (denied) return denied;

  const parsed = proveedorSchema.safeParse({
    id: str(formData.get("id")),
    name: str(formData.get("name")),
    cuit: str(formData.get("cuit")),
    phone: str(formData.get("phone")),
    email: str(formData.get("email")),
    notes: str(formData.get("notes")),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.rpc("upsert_supplier", {
    p_id: d.id ?? null,
    p_name: d.name,
    p_cuit: d.cuit ?? null,
    p_phone: d.phone ?? null,
    p_email: d.email ?? null,
    p_notes: d.notes ?? null,
    p_active: true,
  });

  if (error) {
    if (error.code === "23505") return { error: "Ya hay un proveedor con ese nombre." };
    return { error: error.message };
  }

  revalidatePath("/stock/compras/proveedores");
  revalidatePath("/stock/compras");
  return { ok: true };
}

export async function recibirCompra(input: {
  supplier_id: string;
  received_on: string;
  has_invoice: boolean;
  invoice_number?: string;
  payment_terms: "contado" | "cuenta_corriente";
  note?: string;
  items: LineaCompra[];
}): Promise<ActionState & { id?: string }> {
  const denied = await requireCan("compras", true);
  if (denied) return denied;

  if (!input.items || input.items.length === 0) {
    return { error: "La compra no tiene ninguna línea." };
  }

  // El reparto también se revisa acá, para avisar antes de ir a la base.
  // La validación de verdad está en la función SQL: es la que no se puede saltear.
  for (const it of input.items) {
    const repartido = Object.values(it.allocations ?? {}).reduce(
      (a, b) => a + Number(b || 0),
      0
    );
    if (Math.abs(repartido - it.qty_received) > 0.0005) {
      return {
        error: `Hay una línea donde el reparto no cierra: llegaron ${it.qty_received} y estás repartiendo ${repartido}.`,
      };
    }
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("receive_purchase", {
    p_supplier_id: input.supplier_id,
    p_received_on: input.received_on || null,
    p_has_invoice: input.has_invoice,
    p_invoice_number: input.invoice_number ?? null,
    p_payment_terms: input.payment_terms,
    p_note: input.note ?? null,
    p_items: input.items,
  });

  // Los mensajes de la función están escritos para que los lea una persona
  // ("El reparto de Queso sardo no cierra: llegaron 9,8 y estás repartiendo 8").
  if (error) return { error: error.message };

  revalidatePath("/stock");
  revalidatePath("/stock/compras");
  revalidatePath("/stock/movimientos");
  revalidatePath("/productos");

  return { ok: true, id: data as string };
}

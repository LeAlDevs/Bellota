"use server";

import { revalidatePath } from "next/cache";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Da de baja lo que queda de un lote. Sale como merma con motivo `vencido`. */
export async function darDeBajaLote(
  lotId: string,
  nota?: string
): Promise<ActionState> {
  const denied = await requireCan("stock", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("write_off_lot", {
    p_lot_id: lotId,
    p_note: nota ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/stock/vencimientos");
  revalidatePath("/stock");
  revalidatePath("/stock/movimientos");
  revalidatePath("/");
  return { ok: true };
}

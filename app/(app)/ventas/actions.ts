"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LineaDevolucion = { sale_item_id: string; qty: number };

function revalidarTodo(saleId?: string) {
  revalidatePath("/ventas");
  revalidatePath("/ventas/devoluciones");
  revalidatePath("/ventas/reportes");
  if (saleId) revalidatePath(`/ventas/${saleId}`);
  revalidatePath("/pos/caja");
  revalidatePath("/stock");
  revalidatePath("/stock/movimientos");
  revalidatePath("/");
}

/**
 * Anula una venta entera: repone todo el stock y saca la plata de la caja.
 *
 * Reservado al administrador. Lo controla `cancel_sale` adentro de la base;
 * el guard de acá es para dar un mensaje decente antes de ir al servidor.
 */
export async function anularVenta(
  saleId: string,
  motivo?: string
): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("cancel_sale", {
    p_sale_id: saleId,
    p_reason: motivo?.trim() || null,
  });

  if (error) return { error: error.message };

  revalidarTodo(saleId);
  return { ok: true };
}

/**
 * Devuelve una parte (o todo) de una venta.
 *
 * No recalcula precios: `create_return` copia el precio y el costo de la línea
 * original. Si el precio subió entre la venta y la devolución, al cliente hay
 * que devolverle lo que pagó.
 */
export async function registrarDevolucion(
  saleId: string,
  lineas: LineaDevolucion[],
  motivo?: string
): Promise<ActionState & { id?: string }> {
  const denied = await requireCan("devoluciones", true);
  if (denied) return denied;

  const items = lineas.filter((l) => l.qty > 0);
  if (items.length === 0) {
    return { error: "No marcaste nada para devolver." };
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("create_return", {
    p_sale_id: saleId,
    p_items: items,
    p_reason: motivo?.trim() || null,
  });

  if (error) return { error: error.message };

  revalidarTodo(saleId);
  return { ok: true, id: data as string };
}

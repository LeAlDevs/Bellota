"use server";

import { revalidatePath } from "next/cache";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LineaVenta = {
  product_id: string;
  /**
   * Con qué precio se cobró: fraccionado, horma entera. Si no viene, la base
   * asume la principal. Sin esto no hay forma de saber, dentro de un mes, si
   * esos 3 kg salieron a precio de horma o si alguien erró el PLU.
   */
  presentation_id?: string;
  qty: number;
  unit_price: number;
  /**
   * Importe de la línea, cuando viene de una etiqueta de balanza. Manda sobre
   * cantidad × precio: es el número que el cliente ya leyó en el papel.
   */
  subtotal?: number;
  source: "etiqueta" | "codigo" | "busqueda" | "manual";
  scale_code?: string;
};

export type PagoVenta = { payment_method_id: string; amount: number };

function revalidarTodo() {
  revalidatePath("/pos");
  revalidatePath("/pos/caja");
  revalidatePath("/pos/arqueos");
  revalidatePath("/stock");
  revalidatePath("/ventas");
  revalidatePath("/");
}

export async function abrirTurno(
  storeId: string,
  fondo: number
): Promise<ActionState & { id?: string }> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  const sb = await createClient();
  const { data, error } = await sb.rpc("open_cash_session", {
    p_store_id: storeId,
    p_float: fondo,
  });

  if (error) return { error: error.message };
  revalidarTodo();
  return { ok: true, id: data as string };
}

export async function cerrarTurno(
  sessionId: string,
  declarado: number,
  nota?: string
): Promise<ActionState & { esperado?: number; diferencia?: number }> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  const sb = await createClient();
  const { data, error } = await sb.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_declared: declarado,
    p_note: nota ?? null,
  });

  if (error) return { error: error.message };

  const row = (Array.isArray(data) ? data[0] : data) as {
    expected_cash: number;
    difference: number;
  } | null;

  revalidarTodo();
  return {
    ok: true,
    esperado: Number(row?.expected_cash ?? 0),
    diferencia: Number(row?.difference ?? 0),
  };
}

export async function registrarMovimientoCaja(
  sessionId: string,
  monto: number,
  tipo: "retiro" | "ingreso",
  nota?: string
): Promise<ActionState> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "Poné un monto mayor que cero." };
  }

  const sb = await createClient();
  const { error } = await sb.rpc("register_cash_movement", {
    p_session_id: sessionId,
    // El retiro sale del cajón: viaja en negativo.
    p_amount: tipo === "retiro" ? -monto : monto,
    p_kind: tipo,
    p_note: nota ?? null,
  });

  if (error) return { error: error.message };
  revalidarTodo();
  return { ok: true };
}

export async function cobrar(input: {
  store_id: string;
  items: LineaVenta[];
  payments: PagoVenta[];
  is_fiscal: boolean;
  discount?: number;
  scale_check: "sin_balanza" | "verificado" | "sin_verificar";
  email?: string;
  phone?: string;
  note?: string;
}): Promise<ActionState & { numero?: number; total?: number }> {
  const denied = await requireCan("pos", true);
  if (denied) return denied;

  if (!input.items || input.items.length === 0) {
    return { error: "No hay nada cargado en la venta." };
  }
  if (!input.payments || input.payments.length === 0) {
    return { error: "Elegí cómo paga el cliente." };
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("create_sale", {
    p_store_id: input.store_id,
    p_items: input.items,
    p_payments: input.payments,
    p_is_fiscal: input.is_fiscal,
    p_discount: input.discount ?? 0,
    p_channel: "pos",
    p_scale_check: input.scale_check,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_note: input.note ?? null,
  });

  // Los mensajes de la función están escritos para el mostrador:
  // "No hay un turno de caja abierto en este local", "Los pagos suman X y la
  // venta es de Y". Se pasan tal cual.
  if (error) return { error: error.message };

  const venta = (Array.isArray(data) ? data[0] : data) as {
    number: number;
    total: number;
  } | null;

  revalidarTodo();
  return {
    ok: true,
    numero: Number(venta?.number ?? 0),
    total: Number(venta?.total ?? 0),
  };
}

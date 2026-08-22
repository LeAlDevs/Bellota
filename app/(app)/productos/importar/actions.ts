"use server";

import { revalidatePath } from "next/cache";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type FilaImportable = {
  nombre: string;
  tipo: "kg" | "unidad";
  precio: number;
  costo?: number;
  plu?: number;
  categoria?: string;
  minimo?: number;
  vence?: boolean;
  vida_util?: number;
  /** { store_id: cantidad } — cuánto HAY, no cuánto sumar. */
  stock?: Record<string, number>;
};

export type ResultadoImport = ActionState & {
  creados?: number;
  actualizados?: number;
  ajustes_stock?: number;
};

/** Tope defensivo: una planilla más larga que esto es casi seguro un error. */
const MAX_FILAS = 2000;

export async function importarProductos(
  filas: FilaImportable[]
): Promise<ResultadoImport> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  if (!Array.isArray(filas) || filas.length === 0) {
    return { error: "No hay filas para importar." };
  }
  if (filas.length > MAX_FILAS) {
    return {
      error: `La planilla tiene ${filas.length} filas y el tope es ${MAX_FILAS}. Partila en dos.`,
    };
  }

  const payload = filas.map((f) => ({
    nombre: f.nombre,
    tipo: f.tipo,
    precio: f.precio,
    costo: f.costo ?? null,
    plu: f.plu ?? null,
    categoria: f.categoria ?? null,
    minimo: f.minimo ?? null,
    vence: f.vence ?? false,
    vida_util: f.vida_util ?? null,
    stock: f.stock ?? {},
  }));

  const sb = await createClient();
  const { data, error } = await sb.rpc("import_products", { p_rows: payload });

  if (error) return { error: error.message };

  const res = (data ?? {}) as {
    creados: number;
    actualizados: number;
    ajustes_stock: number;
  };

  revalidatePath("/productos");
  revalidatePath("/productos/categorias");

  return { ok: true, ...res };
}

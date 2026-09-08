import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PickerProduct, Presentacion } from "@/components/ui/product-picker";

export type FilaPresentacion = {
  id: string;
  name: string;
  plu: number | null;
  price: number;
  min_qty: number | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
};

type Fila = {
  id: string;
  name: string;
  barcode: string | null;
  unit_type: "kg" | "unidad";
  cost: number;
  track_expiry: boolean;
  shelf_life_days: number | null;
  stock: { qty: number; store_id: string }[] | null;
  product_presentations: FilaPresentacion[] | null;
};

const SELECT_PRESENTACIONES =
  "product_presentations(id, name, plu, price, min_qty, is_default, is_active, sort_order)";

/** Ordena por sort_order dejando la principal primero, y descarta las de baja. */
export function ordenarPresentaciones(filas: FilaPresentacion[]): Presentacion[] {
  return filas
    .filter((x) => x.is_active)
    .sort((a, b) =>
      a.is_default === b.is_default
        ? a.sort_order - b.sort_order
        : a.is_default
          ? -1
          : 1
    )
    .map((x) => ({
      id: x.id,
      name: x.name,
      plu: x.plu,
      price: Number(x.price),
      min_qty: x.min_qty === null ? null : Number(x.min_qty),
      is_default: x.is_default,
    }));
}

/**
 * Catálogo activo con presentaciones, costo y stock por local, en la forma que
 * espera el buscador. Lo usan el ajuste de stock, la transferencia, la compra y
 * el mostrador.
 *
 * Va entero al cliente a propósito: en el mostrador el escaneo tiene que
 * resolver el producto sin ir y volver al servidor. Con unos cientos de
 * productos el peso es despreciable, y si algún día son miles se cambia por
 * una búsqueda contra el servidor sin tocar el resto.
 *
 * `plu` y `price` son los de la presentación principal. Están para que todo lo
 * que no vende (ajustes, transferencias, compras) siga sin enterarse de que
 * existen las presentaciones; el mostrador sí mira `presentations`.
 */
export async function getProductosParaPicker(): Promise<PickerProduct[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("products")
    .select(
      `id, name, barcode, unit_type, cost, track_expiry, shelf_life_days, stock(qty, store_id), ${SELECT_PRESENTACIONES}`
    )
    .eq("is_active", true)
    .order("name")
    .returns<Fila[]>();

  return (data ?? []).map((p) => {
    const presentations = ordenarPresentaciones(p.product_presentations ?? []);
    const principal = presentations.find((x) => x.is_default) ?? presentations[0];

    return {
      id: p.id,
      name: p.name,
      plu: principal?.plu ?? null,
      barcode: p.barcode,
      unit_type: p.unit_type,
      price: principal?.price ?? 0,
      cost: Number(p.cost),
      track_expiry: p.track_expiry,
      shelf_life_days: p.shelf_life_days,
      presentations,
      stock: Object.fromEntries(
        (p.stock ?? []).map((s) => [s.store_id, Number(s.qty)])
      ),
    };
  });
}

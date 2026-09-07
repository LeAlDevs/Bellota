import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PickerProduct } from "@/components/ui/product-picker";

type Fila = {
  id: string;
  name: string;
  plu: number | null;
  barcode: string | null;
  unit_type: "kg" | "unidad";
  price: number;
  cost: number;
  track_expiry: boolean;
  shelf_life_days: number | null;
  stock: { qty: number; store_id: string }[] | null;
};

/**
 * Catálogo activo con precio, costo y stock por local, en la forma que espera
 * el buscador. Lo usan el ajuste de stock, la transferencia, la compra y el
 * mostrador.
 *
 * Va entero al cliente a propósito: en el mostrador el escaneo tiene que
 * resolver el producto sin ir y volver al servidor. Con unos cientos de
 * productos el peso es despreciable, y si algún día son miles se cambia por
 * una búsqueda contra el servidor sin tocar el resto.
 */
export async function getProductosParaPicker(): Promise<PickerProduct[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("products")
    .select("id, name, plu, barcode, unit_type, price, cost, track_expiry, shelf_life_days, stock(qty, store_id)")
    .eq("is_active", true)
    .order("name")
    .returns<Fila[]>();

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    plu: p.plu,
    barcode: p.barcode,
    unit_type: p.unit_type,
    price: Number(p.price),
    cost: Number(p.cost),
    track_expiry: p.track_expiry,
    shelf_life_days: p.shelf_life_days,
    stock: Object.fromEntries(
      (p.stock ?? []).map((s) => [s.store_id, Number(s.qty)])
    ),
  }));
}

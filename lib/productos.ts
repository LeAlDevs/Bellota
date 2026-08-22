import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PickerProduct } from "@/components/ui/product-picker";

type Fila = {
  id: string;
  name: string;
  plu: number | null;
  unit_type: "kg" | "unidad";
  cost: number;
  stock: { qty: number; store_id: string }[] | null;
};

/**
 * Catálogo activo con su stock por local, en la forma que espera el buscador de
 * productos. Lo usan los formularios de ajuste, transferencia y (más adelante)
 * el mostrador.
 */
export async function getProductosParaPicker(): Promise<PickerProduct[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("products")
    .select("id, name, plu, unit_type, cost, stock(qty, store_id)")
    .eq("is_active", true)
    .order("name")
    .returns<Fila[]>();

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    plu: p.plu,
    unit_type: p.unit_type,
    cost: Number(p.cost),
    stock: Object.fromEntries(
      (p.stock ?? []).map((s) => [s.store_id, Number(s.qty)])
    ),
  }));
}

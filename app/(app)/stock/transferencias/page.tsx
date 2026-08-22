import { ArrowRight } from "lucide-react";
import { getMe, getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getProductosParaPicker } from "@/lib/productos";
import { getNombresDeUsuarios } from "@/lib/usuarios";
import { formatDateTime, formatKg, formatMoney, formatNumber } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/form";
import { TransferForm } from "./transfer-form";

type Transfer = {
  id: string;
  note: string | null;
  created_at: string;
  user_id: string | null;
  origen: { name: string } | null;
  destino: { name: string } | null;
  transfer_items: {
    qty: number;
    unit_cost: number | null;
    products: { name: string; unit_type: "kg" | "unidad" } | null;
  }[];
};

export default async function TransferenciasPage() {
  const [perms, me, sb, products] = await Promise.all([
    getPermissions(),
    getMe(),
    createClient(),
    getProductosParaPicker(),
  ]);

  const { data: stores } = await sb
    .from("stores")
    .select("id, name")
    .eq("active", true)
    .order("name");

  // Los dos FK apuntan a `stores`, así que hay que nombrar cuál es cuál.
  const { data: historial } = await sb
    .from("transfers")
    .select(
      "id, note, created_at, user_id, origen:stores!transfers_from_store_id_fkey(name), destino:stores!transfers_to_store_id_fkey(name), transfer_items(qty, unit_cost, products(name, unit_type))"
    )
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<Transfer[]>();

  const movimientos = historial ?? [];
  const nombres = await getNombresDeUsuarios(movimientos.map((t) => t.user_id));

  return (
    <>
      <PageHeader
        title="Transferencias"
        subtitle="Mercadería que pasa de un local al otro."
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-y-auto pb-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {canEdit(perms, "stock") ? (
          <TransferForm
            stores={stores ?? []}
            products={products}
            storeIdPropio={me?.storeId ?? null}
          />
        ) : (
          <Card>
            <EmptyState
              title="No tenés permiso para transferir"
              description="Podés ver el historial, pero las transferencias las carga el encargado o el administrador."
            />
          </Card>
        )}

        <Card className="flex h-fit flex-col overflow-hidden">
          <p className="px-4 pb-3 pt-4 text-sm font-semibold">Últimas transferencias</p>

          {movimientos.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-muted">
              Todavía no se movió mercadería entre los locales.
            </p>
          ) : (
            movimientos.map((t) => {
              const valor = t.transfer_items.reduce(
                (a, i) => a + Number(i.qty) * Number(i.unit_cost ?? 0),
                0
              );
              return (
                <div
                  key={t.id}
                  className="flex flex-col gap-1.5 border-t border-line/60 px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <span>{t.origen?.name ?? "—"}</span>
                    <ArrowRight className="size-3.5 text-faint" strokeWidth={2} />
                    <span>{t.destino?.name ?? "—"}</span>
                    <span className="grow" />
                    <span className="num text-[13px] text-muted">
                      {formatMoney(valor)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    {t.transfer_items.map((i, k) => (
                      <div key={k} className="flex items-baseline gap-2 text-[12px]">
                        <span className="truncate text-muted">
                          {i.products?.name ?? "—"}
                        </span>
                        <span className="grow border-b border-dotted border-line" />
                        <span className="tnum shrink-0 text-muted">
                          {i.products?.unit_type === "kg"
                            ? `${formatKg(i.qty)} kg`
                            : formatNumber(i.qty)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {t.note && (
                    <p className="text-[11.5px] leading-snug text-muted">{t.note}</p>
                  )}

                  <div className="flex items-center gap-2 text-[11px] text-faint">
                    <span>{(t.user_id && nombres.get(t.user_id)) || "—"}</span>
                    <span>·</span>
                    <span>{formatDateTime(t.created_at)}</span>
                  </div>
                </div>
              );
            })
          )}
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { getMe, getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getProductosParaPicker } from "@/lib/productos";
import { formatDateTime, formatKg, formatMoney, formatNumber } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { MOTIVE_LABEL, type Motive } from "@/lib/stock";
import { AdjustForm } from "./adjust-form";

type Mov = {
  id: string;
  delta: number;
  reason: string;
  motive: Motive | null;
  unit_cost: number | null;
  note: string | null;
  created_at: string;
  products: { name: string; unit_type: "kg" | "unidad" } | null;
  stores: { name: string } | null;
};

export default async function AjustesPage() {
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

  // Los últimos ajustes a mano, para que se vea que quedó registrado.
  const { data: ultimos } = await sb
    .from("stock_movements")
    .select(
      "id, delta, reason, motive, unit_cost, note, created_at, products(name, unit_type), stores(name)"
    )
    .in("reason", ["merma", "ajuste"])
    .order("created_at", { ascending: false })
    .limit(8)
    .returns<Mov[]>();

  if (!canEdit(perms, "stock")) {
    return (
      <>
        <PageHeader title="Ajustes y merma" />
        <Card>
          <EmptyState
            title="No tenés permiso para ajustar el stock"
            description="Podés mirar las existencias y los movimientos, pero los ajustes y las mermas los cargan el encargado o el administrador."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Ajustes y merma"
        subtitle="Lo que se perdió, con nombre y apellido."
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-y-auto pb-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AdjustForm
          stores={stores ?? []}
          products={products}
          storeIdPropio={me?.storeId ?? null}
        />

        <Card className="flex h-fit flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 pb-3 pt-4">
            <p className="text-sm font-semibold">Últimos ajustes</p>
            <span className="grow" />
            <Link
              href="/stock/movimientos"
              className="text-[12px] font-medium text-accent hover:text-accent-hover"
            >
              Ver todo
            </Link>
          </div>

          {(ultimos ?? []).length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-muted">
              Todavía no se registró ningún ajuste.
            </p>
          ) : (
            (ultimos ?? []).map((m) => {
              const cant = Math.abs(Number(m.delta));
              const esKg = m.products?.unit_type === "kg";
              const plata = Number(m.unit_cost ?? 0) * cant;
              return (
                <div
                  key={m.id}
                  className="flex flex-col gap-1 border-t border-line/60 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">
                      {m.products?.name ?? "—"}
                    </span>
                    <span className="grow" />
                    <span
                      className={`num text-[13px] ${Number(m.delta) < 0 ? "text-danger" : "text-ok"}`}
                    >
                      {Number(m.delta) > 0 ? "+" : "−"}
                      {esKg ? `${formatKg(cant)} kg` : formatNumber(cant)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {m.reason === "merma" ? (
                      <Badge tone="danger">
                        {m.motive ? MOTIVE_LABEL[m.motive] : "Merma"}
                      </Badge>
                    ) : (
                      <Badge>Conteo</Badge>
                    )}
                    <span className="text-[11.5px] text-muted">{m.stores?.name}</span>
                    {m.reason === "merma" && plata > 0 && (
                      <span className="num text-[11.5px] text-danger">
                        {formatMoney(plata)}
                      </span>
                    )}
                    <span className="grow" />
                    <span className="text-[11px] text-faint">
                      {formatDateTime(m.created_at)}
                    </span>
                  </div>
                  {m.note && (
                    <p className="text-[11.5px] leading-snug text-muted">{m.note}</p>
                  )}
                </div>
              );
            })
          )}
        </Card>
      </div>
    </>
  );
}

import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCalendarDate, formatKg, formatMoney, formatNumber, todayLocal } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { BotonDarDeBaja } from "./lot-row";

type Lote = {
  id: string;
  expires_on: string;
  code: string | null;
  qty_remaining: number;
  unit_cost: number | null;
  products: { name: string; unit_type: "kg" | "unidad" } | null;
  stores: { name: string } | null;
};

const COLS = "grid-cols-[120px_minmax(0,1fr)_120px_110px_120px_44px]";

/** Días entre hoy y la fecha, en día calendario (sin horas). */
function diasHasta(fecha: string, hoy: string): number {
  const a = new Date(fecha + "T00:00:00");
  const b = new Date(hoy + "T00:00:00");
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export default async function VencimientosPage() {
  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);
  const puedeEditar = canEdit(perms, "stock");
  const hoy = todayLocal();

  const { data, error } = await sb
    .from("stock_lots")
    .select(
      "id, expires_on, code, qty_remaining, unit_cost, products(name, unit_type), stores(name)"
    )
    .gt("qty_remaining", 0)
    .order("expires_on")
    .limit(200)
    .returns<Lote[]>();

  const lotes = data ?? [];

  const conDias = lotes.map((l) => ({ ...l, dias: diasHasta(l.expires_on, hoy) }));
  const vencidos = conDias.filter((l) => l.dias < 0);
  const urgentes = conDias.filter((l) => l.dias >= 0 && l.dias <= 3);
  const proximos = conDias.filter((l) => l.dias > 3 && l.dias <= 7);

  const plata = (ls: typeof conDias) =>
    ls.reduce((a, l) => a + Number(l.qty_remaining) * Number(l.unit_cost ?? 0), 0);

  const fmt = (l: (typeof conDias)[number]) =>
    l.products?.unit_type === "kg"
      ? `${formatKg(l.qty_remaining)} kg`
      : formatNumber(l.qty_remaining);

  return (
    <>
      <PageHeader
        title="Vencimientos"
        subtitle="Cada entrada de mercadería es un lote con su propia fecha."
      />

      {lotes.length > 0 && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Card className="flex flex-col gap-1 border-danger/25 bg-danger-bg/40 p-4">
            <span className="text-[11.5px] text-danger">Ya vencidos</span>
            <span className="num text-[26px] leading-none text-danger">
              {formatNumber(vencidos.length)}
            </span>
            <span className="text-[11.5px] text-muted">
              {formatMoney(plata(vencidos))} para dar de baja
            </span>
          </Card>
          <Card className="flex flex-col gap-1 border-warn/25 bg-warn-bg/40 p-4">
            <span className="text-[11.5px] text-warn">Vencen en 3 días o menos</span>
            <span className="num text-[26px] leading-none text-warn">
              {formatNumber(urgentes.length)}
            </span>
            <span className="text-[11.5px] text-muted">
              {formatMoney(plata(urgentes))} en juego
            </span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Esta semana</span>
            <span className="num text-[26px] leading-none">
              {formatNumber(proximos.length)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Lotes abiertos</span>
            <span className="num text-[26px] leading-none">
              {formatNumber(lotes.length)}
            </span>
            <span className="text-[11.5px] text-faint">
              {formatMoney(plata(conDias))} en góndola
            </span>
          </Card>
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer los vencimientos"
            description={`La base devolvió: ${error.message}. Si todavía no corriste 0009_costo_manual_y_lotes.sql, es eso.`}
          />
        ) : lotes.length === 0 ? (
          <EmptyState
            title="No hay nada con vencimiento cargado"
            description="Los lotes se crean al recibir una compra de un producto que lleva control de vencimiento. Marcá esa opción en el producto y poné la fecha cuando entre la mercadería."
          />
        ) : (
          <>
            <div
              className={cn(
                "grid shrink-0 border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint",
                COLS
              )}
            >
              <div>Vence</div>
              <div>Producto</div>
              <div>Local</div>
              <div className="text-right">Queda</div>
              <div className="text-right">A costo</div>
              <div />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {conDias.map((l) => {
                const perdida = Number(l.qty_remaining) * Number(l.unit_cost ?? 0);
                const tono =
                  l.dias < 0 ? "danger" : l.dias <= 3 ? "warn" : l.dias <= 7 ? "muted" : "faint";

                return (
                  <div
                    key={l.id}
                    className={cn(
                      "grid items-center border-b border-line/60 px-4 py-2.5 text-[13px]",
                      COLS,
                      l.dias < 0 && "bg-danger-bg/35",
                      l.dias >= 0 && l.dias <= 3 && "bg-warn-bg/30"
                    )}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="tnum text-[12.5px]">
                        {formatCalendarDate(l.expires_on)}
                      </span>
                      <span
                        className={cn(
                          "text-[11px] font-medium",
                          tono === "danger" && "text-danger",
                          tono === "warn" && "text-warn",
                          tono === "muted" && "text-muted",
                          tono === "faint" && "text-faint"
                        )}
                      >
                        {l.dias < 0
                          ? `vencido hace ${Math.abs(l.dias)} ${Math.abs(l.dias) === 1 ? "día" : "días"}`
                          : l.dias === 0
                            ? "vence hoy"
                            : l.dias === 1
                              ? "vence mañana"
                              : `en ${l.dias} días`}
                      </span>
                    </div>

                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {l.products?.name ?? "—"}
                      </span>
                      {l.code && <Badge>{l.code}</Badge>}
                      {l.dias < 0 && <Badge tone="danger">Vencido</Badge>}
                    </div>

                    <div className="truncate text-muted">{l.stores?.name ?? "—"}</div>

                    <div className="tnum text-right">{fmt(l)}</div>

                    <div className="tnum text-right text-muted">
                      {formatMoney(perdida)}
                    </div>

                    <div className="flex justify-end">
                      {puedeEditar && (
                        <BotonDarDeBaja
                          lotId={l.id}
                          producto={l.products?.name ?? "el producto"}
                          cantidad={Number(l.qty_remaining)}
                          unitType={l.products?.unit_type ?? "unidad"}
                          perdida={perdida}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      <p className="text-[12.5px] leading-relaxed text-muted">
        El mostrador nunca elige lote: al vender, el sistema descuenta solo del que
        vence primero. Por eso lo que figura acá es lo que realmente queda de cada
        entrada, sin sumarle un paso al cajero.
      </p>
    </>
  );
}

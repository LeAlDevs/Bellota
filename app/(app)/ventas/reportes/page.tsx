import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatNumber, formatQty } from "@/lib/format";
import { diasAtras, rangoDeFechas, textoDelRango } from "@/lib/ventas";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PorProducto = {
  product_id: string;
  name: string;
  plu: number | null;
  unit_type: "kg" | "unidad";
  qty: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number | null;
};

type PorHora = { hora: number; tickets: number; revenue: number };

type Resumen = {
  tickets: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number | null;
  avg_ticket: number;
  returned: number;
  cancelled: number;
};

const COLS = "grid-cols-[minmax(0,1fr)_120px_130px_130px_130px_80px]";

const selectCls =
  "h-10 rounded-lg border border-line-strong bg-card px-3 pr-8 text-[13px] outline-none";
const dateCls = "h-10 rounded-lg border border-line-strong bg-card px-3 text-[13px] outline-none";

function Dato({
  label,
  valor,
  tono,
  nota,
}: {
  label: string;
  valor: string;
  tono?: string;
  nota?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-[11px] uppercase tracking-[0.05em] text-faint">{label}</span>
      <span className={cn("num text-[17px]", tono)}>{valor}</span>
      {nota && <span className="text-[11.5px] text-muted">{nota}</span>}
    </div>
  );
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; local?: string; fiscal?: string }>;
}) {
  const sp = await searchParams;
  // Un reporte de un día solo no dice nada: el default son los últimos 30.
  const rango = rangoDeFechas(sp, diasAtras(29));
  const soloFiscal = sp.fiscal === "1";

  const sb = await createClient();
  const args = {
    p_from: rango.desde,
    p_to: rango.hasta,
    p_store: sp.local || null,
  };

  const [{ data: stores }, resumenRes, productosRes, horasRes] = await Promise.all([
    sb.from("stores").select("id, name").eq("active", true).order("name"),
    sb.rpc("report_sales_summary", { ...args, p_only_fiscal: soloFiscal }),
    sb.rpc("report_sales_by_product", { ...args, p_only_fiscal: soloFiscal }),
    sb.rpc("report_sales_by_hour", args),
  ]);

  const resumen = (resumenRes.data as Resumen[] | null)?.[0] ?? null;
  const productos = (productosRes.data as PorProducto[] | null) ?? [];
  const horas = (horasRes.data as PorHora[] | null) ?? [];
  const errorMsg =
    resumenRes.error?.message ?? productosRes.error?.message ?? horasRes.error?.message;

  const maxHora = Math.max(1, ...horas.map((h) => Number(h.revenue)));
  const nombreLocal = sp.local
    ? (stores ?? []).find((s) => s.id === sp.local)?.name ?? "un local"
    : "los dos locales";

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle={`${textoDelRango(rango)} · ${nombreLocal} · ${soloFiscal ? "solo fiscal" : "todo"}`}
      >
        <Link href="/stock/movimientos?motivo=merma">
          <Button variant="ghost">Ver merma</Button>
        </Link>
      </PageHeader>

      <form className="flex flex-wrap items-center gap-2.5">
        <input type="date" name="desde" defaultValue={rango.desde} className={dateCls} />
        <span className="text-[12.5px] text-muted">a</span>
        <input type="date" name="hasta" defaultValue={rango.hasta} className={dateCls} />

        <select name="local" defaultValue={sp.local ?? ""} className={selectCls}>
          <option value="">Los dos locales</option>
          {(stores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select name="fiscal" defaultValue={sp.fiscal ?? ""} className={selectCls}>
          <option value="">Todo</option>
          <option value="1">Solo fiscal</option>
        </select>

        <Button type="submit" variant="ghost">
          Actualizar
        </Button>

        {(sp.desde || sp.hasta || sp.local || sp.fiscal) && (
          <Link
            href="/ventas/reportes"
            className="text-[12.5px] font-medium text-accent hover:text-accent-hover"
          >
            Limpiar
          </Link>
        )}
      </form>

      {errorMsg ? (
        <Card>
          <EmptyState
            title="No pude armar los reportes"
            description={`La base devolvió: ${errorMsg}. Si dice que la función no existe, falta correr la migración 0011.`}
          />
        </Card>
      ) : (
        <>
          {resumen && (
            <Card className="grid grid-cols-2 divide-x divide-line md:grid-cols-5">
              <Dato
                label="Vendido"
                valor={formatMoney(resumen.revenue)}
                tono="text-accent"
                nota={`${formatNumber(resumen.tickets)} tickets`}
              />
              <Dato label="Costo" valor={formatMoney(resumen.cost)} />
              <Dato
                label="Margen"
                valor={formatMoney(resumen.margin)}
                tono={Number(resumen.margin) < 0 ? "text-danger" : "text-ok"}
                nota={resumen.margin_pct !== null ? `${resumen.margin_pct}% sobre la venta` : undefined}
              />
              <Dato label="Ticket promedio" valor={formatMoney(resumen.avg_ticket)} />
              <Dato
                label="Devuelto"
                valor={formatMoney(resumen.returned)}
                tono={Number(resumen.returned) > 0 ? "text-danger" : undefined}
                nota={
                  Number(resumen.cancelled) > 0
                    ? `${formatNumber(resumen.cancelled)} ventas anuladas`
                    : undefined
                }
              />
            </Card>
          )}

          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="text-[13px] font-semibold">Qué se vende y cuánto deja</span>
              <span className="grow" />
              <span className="text-[11.5px] text-muted">
                Costo del momento de cada venta, neto de devoluciones
              </span>
            </div>

            {productos.length === 0 ? (
              <EmptyState
                title="Sin ventas en este período"
                description="Ampliá las fechas o sacá el filtro de local."
              />
            ) : (
              <>
                <div
                  className={cn(
                    "grid border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint",
                    COLS
                  )}
                >
                  <div>Producto</div>
                  <div className="text-right">Cantidad</div>
                  <div className="text-right">Vendido</div>
                  <div className="text-right">Costo</div>
                  <div className="text-right">Margen</div>
                  <div className="text-right">%</div>
                </div>

                <div className="max-h-[520px] overflow-y-auto">
                  {productos.map((p) => {
                    const margen = Number(p.margin);
                    return (
                      <Link
                        key={p.product_id}
                        href={`/stock/movimientos?producto=${p.product_id}`}
                        className={cn(
                          "grid items-center border-b border-line/60 px-4 py-2.5 text-[13px] transition-colors hover:bg-subtle",
                          COLS
                        )}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{p.name}</span>
                          {p.plu !== null && (
                            <span className="text-[11.5px] text-faint">PLU {p.plu}</span>
                          )}
                        </div>
                        <div className="num text-right">{formatQty(p.qty, p.unit_type)}</div>
                        <div className="tnum text-right">{formatMoney(p.revenue)}</div>
                        <div className="tnum text-right text-muted">{formatMoney(p.cost)}</div>
                        <div
                          className={cn(
                            "tnum text-right font-medium",
                            margen < 0 ? "text-danger" : "text-ok"
                          )}
                        >
                          {formatMoney(margen)}
                        </div>
                        <div
                          className={cn(
                            "tnum text-right text-[12.5px]",
                            margen < 0 ? "text-danger" : "text-muted"
                          )}
                        >
                          {p.margin_pct === null ? "—" : `${p.margin_pct}%`}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </Card>

          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="text-[13px] font-semibold">A qué hora entra la gente</span>
              <span className="grow" />
              <span className="text-[11.5px] text-muted">Hora de Buenos Aires</span>
            </div>

            {horas.length === 0 ? (
              <EmptyState
                title="Sin datos de horario"
                description="Cuando haya ventas en el período, acá se ve en qué franja se concentran."
              />
            ) : (
              <div className="flex items-end gap-1.5 px-4 py-4">
                {horas.map((h) => {
                  const alto = Math.max(4, (Number(h.revenue) / maxHora) * 120);
                  return (
                    <div
                      key={h.hora}
                      className="flex min-w-0 grow flex-col items-center gap-1"
                      title={`${h.hora}:00 · ${formatNumber(h.tickets)} tickets · ${formatMoney(h.revenue)}`}
                    >
                      <span className="tnum text-[10.5px] text-faint">
                        {formatNumber(h.tickets)}
                      </span>
                      <div
                        className="w-full rounded-t bg-tostado"
                        style={{ height: `${alto}px` }}
                      />
                      <span className="num text-[11px] text-muted">{h.hora}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <p className="text-[12px] text-faint">
            Falta todavía: merma por motivo con su costo (hoy se ve en{" "}
            <Link href="/stock/movimientos?motivo=merma" className="text-accent hover:underline">
              Movimientos
            </Link>
            ) y rinde real contra esperado en los despieces, que llega con Producción.
          </p>
        </>
      )}
    </>
  );
}

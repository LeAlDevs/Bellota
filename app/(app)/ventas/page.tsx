import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getNombresDeUsuarios } from "@/lib/usuarios";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { rangoDeFechas, textoDelRango } from "@/lib/ventas";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Venta = {
  id: string;
  number: number;
  created_at: string;
  total: number;
  status: "completada" | "anulada";
  is_fiscal: boolean;
  user_id: string | null;
  stores: { name: string } | null;
  sale_items: { id: string }[];
  sale_payments: { amount: number; payment_methods: { name: string } | null }[];
};

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

const COLS = "grid-cols-[70px_150px_110px_minmax(0,1fr)_minmax(0,190px)_130px_28px]";

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

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string;
    hasta?: string;
    local?: string;
    cajero?: string;
    medio?: string;
    fiscal?: string;
  }>;
}) {
  const sp = await searchParams;
  const rango = rangoDeFechas(sp);
  // "Todo" por defecto: el dueño mira el negocio entero, no solo lo facturado.
  const soloFiscal = sp.fiscal === "1";

  const sb = await createClient();

  const [{ data: stores }, { data: metodos }, { data: perfiles }, { data: resumenRows }] =
    await Promise.all([
      sb.from("stores").select("id, name").eq("active", true).order("name"),
      sb.from("payment_methods").select("id, name").eq("active", true).order("name"),
      sb.from("profiles").select("id, full_name, email").order("full_name"),
      sb.rpc("report_sales_summary", {
        p_from: rango.desde,
        p_to: rango.hasta,
        p_store: sp.local || null,
        p_only_fiscal: soloFiscal,
      }),
    ]);

  const resumen = (resumenRows as Resumen[] | null)?.[0] ?? null;

  /*
   * El filtro por medio de pago va en dos pasos a propósito. Con un embed
   * `!inner` PostgREST filtraría también los pagos que devuelve, y una venta
   * mitad efectivo mitad débito aparecería como si se hubiera pagado solo con
   * uno. Primero saco los ids, después traigo las ventas completas.
   */
  let idsPorMedio: string[] | null = null;
  if (sp.medio) {
    const { data } = await sb
      .from("sale_payments")
      .select("sale_id")
      .eq("payment_method_id", sp.medio)
      .limit(2000);
    idsPorMedio = [...new Set((data ?? []).map((p) => p.sale_id as string))];
  }

  let query = sb
    .from("sales")
    .select(
      "id, number, created_at, total, status, is_fiscal, user_id, stores(name), sale_items(id), sale_payments(amount, payment_methods(name))"
    )
    .gte("created_at", `${rango.desde}T00:00:00-03:00`)
    .lt("created_at", `${rango.hasta}T23:59:59.999-03:00`)
    .order("created_at", { ascending: false })
    .limit(300);

  if (sp.local) query = query.eq("store_id", sp.local);
  if (sp.cajero) query = query.eq("user_id", sp.cajero);
  if (soloFiscal) query = query.eq("is_fiscal", true);
  if (idsPorMedio) query = query.in("id", idsPorMedio.length ? idsPorMedio : [""]);

  const { data, error } = await query.returns<Venta[]>();
  const ventas = data ?? [];
  const nombres = await getNombresDeUsuarios(ventas.map((v) => v.user_id));

  const hayFiltros = Boolean(
    sp.desde || sp.hasta || sp.local || sp.cajero || sp.medio || sp.fiscal
  );

  return (
    <>
      <PageHeader
        title="Panel de ventas"
        subtitle={`${textoDelRango(rango)} · ${sp.local ? (stores ?? []).find((s) => s.id === sp.local)?.name ?? "un local" : "los dos locales"}`}
      >
        <Link href="/ventas/reportes">
          <Button variant="ghost">Ver reportes</Button>
        </Link>
      </PageHeader>

      {resumen && (
        <Card className="grid grid-cols-2 divide-x divide-line md:grid-cols-5">
          <Dato
            label="Vendido"
            valor={formatMoney(resumen.revenue)}
            tono="text-accent"
            nota={
              Number(resumen.returned) > 0
                ? `neto de ${formatMoney(resumen.returned)} devueltos`
                : undefined
            }
          />
          <Dato label="Tickets" valor={formatNumber(resumen.tickets)} />
          <Dato label="Ticket promedio" valor={formatMoney(resumen.avg_ticket)} />
          <Dato
            label="Margen"
            valor={formatMoney(resumen.margin)}
            tono={Number(resumen.margin) < 0 ? "text-danger" : "text-ok"}
            nota={resumen.margin_pct !== null ? `${resumen.margin_pct}% sobre la venta` : undefined}
          />
          <Dato
            label="Anuladas"
            valor={formatNumber(resumen.cancelled)}
            tono={Number(resumen.cancelled) > 0 ? "text-danger" : undefined}
          />
        </Card>
      )}

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

        <select name="cajero" defaultValue={sp.cajero ?? ""} className={selectCls}>
          <option value="">Cualquier cajero</option>
          {(perfiles ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>

        <select name="medio" defaultValue={sp.medio ?? ""} className={selectCls}>
          <option value="">Cualquier medio</option>
          {(metodos ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <select name="fiscal" defaultValue={sp.fiscal ?? ""} className={selectCls}>
          <option value="">Todo</option>
          <option value="1">Solo fiscal</option>
        </select>

        <Button type="submit" variant="ghost">
          Filtrar
        </Button>

        {hayFiltros && (
          <Link
            href="/ventas"
            className="text-[12.5px] font-medium text-accent hover:text-accent-hover"
          >
            Limpiar filtros
          </Link>
        )}

        <span className="grow" />
        <span className="text-[12.5px] text-muted">
          {ventas.length === 300
            ? "Últimas 300 ventas"
            : `${formatNumber(ventas.length)} ventas`}
        </span>
      </form>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer las ventas"
            description={`La base devolvió: ${error.message}.`}
          />
        ) : ventas.length === 0 ? (
          <EmptyState
            title="Sin ventas en este período"
            description="Cambiá las fechas o los filtros. Las ventas del mostrador aparecen acá apenas se cobran."
          />
        ) : (
          <>
            <div
              className={cn(
                "grid shrink-0 border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint",
                COLS
              )}
            >
              <div>Ticket</div>
              <div>Cuándo</div>
              <div>Local</div>
              <div>Cajero</div>
              <div>Cómo pagó</div>
              <div className="text-right">Total</div>
              <div />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {ventas.map((v) => {
                const anulada = v.status === "anulada";
                const medios = v.sale_payments
                  .map((p) => p.payment_methods?.name)
                  .filter(Boolean)
                  .join(" + ");

                return (
                  <Link
                    key={v.id}
                    href={`/ventas/${v.id}`}
                    className={cn(
                      "grid items-center border-b border-line/60 px-4 py-2.5 text-[13px] transition-colors hover:bg-subtle",
                      COLS
                    )}
                  >
                    <div className="num font-medium">#{v.number}</div>

                    <div className="text-[12px] text-muted">{formatDateTime(v.created_at)}</div>

                    <div className="truncate text-muted">{v.stores?.name ?? "—"}</div>

                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">
                        {(v.user_id && nombres.get(v.user_id)) || "—"}
                      </span>
                      {anulada && <Badge tone="danger">Anulada</Badge>}
                      {!v.is_fiscal && !anulada && <Badge tone="neutral">No fiscal</Badge>}
                    </div>

                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] text-muted">{medios || "—"}</span>
                      <span className="text-[11.5px] text-faint">
                        {v.sale_items.length} {v.sale_items.length === 1 ? "línea" : "líneas"}
                      </span>
                    </div>

                    <div
                      className={cn(
                        "tnum text-right font-medium",
                        anulada && "text-faint line-through"
                      )}
                    >
                      {formatMoney(v.total)}
                    </div>

                    <div className="text-faint">
                      <ChevronRight className="size-4" strokeWidth={1.8} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

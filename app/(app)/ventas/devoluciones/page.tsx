import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getNombresDeUsuarios } from "@/lib/usuarios";
import { formatDateTime, formatMoney, formatNumber, formatQty } from "@/lib/format";
import { diasAtras, rangoDeFechas, textoDelRango } from "@/lib/ventas";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Devolucion = {
  id: string;
  total: number;
  reason: string | null;
  created_at: string;
  user_id: string | null;
  stores: { name: string } | null;
  sales: { id: string; number: number } | null;
  return_items: {
    id: string;
    qty: number;
    subtotal: number;
    products: { name: string; unit_type: "kg" | "unidad" } | null;
  }[];
};

const COLS = "grid-cols-[150px_90px_110px_minmax(0,1fr)_130px_28px]";

const selectCls =
  "h-10 rounded-lg border border-line-strong bg-card px-3 pr-8 text-[13px] outline-none";
const inputCls = "h-10 rounded-lg border border-line-strong bg-card px-3 text-[13px] outline-none";

export default async function DevolucionesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; local?: string; ticket?: string }>;
}) {
  const sp = await searchParams;
  const sb = await createClient();

  /*
   * No hay "nueva devolución" suelta: toda devolución es contra una venta. Acá
   * se busca el ticket y se sigue en su detalle, que es donde están las líneas,
   * los precios cobrados y lo que ya se devolvió.
   */
  let noEncontrado: string | null = null;
  if (sp.ticket) {
    const numero = Number(sp.ticket.replace(/\D/g, ""));
    if (Number.isFinite(numero) && numero > 0) {
      const { data } = await sb
        .from("sales")
        .select("id")
        .eq("number", numero)
        .maybeSingle();
      if (data?.id) redirect(`/ventas/${data.id}`);
    }
    noEncontrado = sp.ticket;
  }

  // Últimos 30 días por defecto: una devolución vieja no se busca por fecha,
  // se busca por ticket.
  const rango = rangoDeFechas(sp, diasAtras(30));

  const { data: stores } = await sb
    .from("stores")
    .select("id, name")
    .eq("active", true)
    .order("name");

  let query = sb
    .from("returns")
    .select(
      "id, total, reason, created_at, user_id, stores(name), sales(id, number), return_items(id, qty, subtotal, products(name, unit_type))"
    )
    .gte("created_at", `${rango.desde}T00:00:00-03:00`)
    .lt("created_at", `${rango.hasta}T23:59:59.999-03:00`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (sp.local) query = query.eq("store_id", sp.local);

  const { data, error } = await query.returns<Devolucion[]>();
  const devoluciones = data ?? [];
  const nombres = await getNombresDeUsuarios(devoluciones.map((d) => d.user_id));
  const totalDevuelto = devoluciones.reduce((a, d) => a + Number(d.total), 0);

  return (
    <>
      <PageHeader
        title="Devoluciones"
        subtitle={`${textoDelRango(rango)} · la plata sale del cajón del turno`}
      >
        {devoluciones.length > 0 && (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[11.5px] text-muted">Devuelto en lo que se ve</span>
            <span className="num text-lg text-danger">{formatMoney(totalDevuelto)}</span>
          </div>
        )}
      </PageHeader>

      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold">Devolver de un ticket</span>
          <span className="text-[11.5px] text-muted">
            Toda devolución va contra su venta: es la única forma de saber a qué precio se cobró.
          </span>
        </div>
        <span className="grow" />
        <form className="flex items-center gap-2">
          <input
            type="text"
            name="ticket"
            inputMode="numeric"
            placeholder="Número de ticket"
            defaultValue=""
            className={cn(inputCls, "num w-44", noEncontrado && "border-danger")}
          />
          <Button type="submit">Buscar</Button>
        </form>
      </Card>

      {noEncontrado && (
        <p className="text-[12.5px] text-danger">
          No encontré el ticket #{noEncontrado}. Fijate el número en el Panel de ventas.
        </p>
      )}

      <form className="flex flex-wrap items-center gap-2.5">
        <input type="date" name="desde" defaultValue={rango.desde} className={inputCls} />
        <span className="text-[12.5px] text-muted">a</span>
        <input type="date" name="hasta" defaultValue={rango.hasta} className={inputCls} />

        <select name="local" defaultValue={sp.local ?? ""} className={selectCls}>
          <option value="">Los dos locales</option>
          {(stores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <Button type="submit" variant="ghost">
          Filtrar
        </Button>

        <span className="grow" />
        <span className="text-[12.5px] text-muted">
          {formatNumber(devoluciones.length)} devoluciones
        </span>
      </form>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer las devoluciones"
            description={`La base devolvió: ${error.message}.`}
          />
        ) : devoluciones.length === 0 ? (
          <EmptyState
            title="Sin devoluciones en este período"
            description="Es una buena noticia. Cuando haya una, va a figurar acá con su ticket, su motivo y quién la hizo."
          />
        ) : (
          <>
            <div
              className={cn(
                "grid shrink-0 border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint",
                COLS
              )}
            >
              <div>Cuándo</div>
              <div>Ticket</div>
              <div>Local</div>
              <div>Qué volvió</div>
              <div className="text-right">Reintegro</div>
              <div />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {devoluciones.map((d) => (
                <Link
                  key={d.id}
                  href={d.sales ? `/ventas/${d.sales.id}` : "/ventas"}
                  className={cn(
                    "grid items-center border-b border-line/60 px-4 py-2.5 text-[13px] transition-colors hover:bg-subtle",
                    COLS
                  )}
                >
                  <div className="flex flex-col">
                    <span className="text-[12px] text-muted">{formatDateTime(d.created_at)}</span>
                    <span className="text-[11.5px] text-faint">
                      {(d.user_id && nombres.get(d.user_id)) || "—"}
                    </span>
                  </div>

                  <div className="num font-medium">
                    {d.sales ? `#${d.sales.number}` : "—"}
                  </div>

                  <div className="truncate text-muted">{d.stores?.name ?? "—"}</div>

                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {d.return_items
                        .map(
                          (ri) =>
                            `${formatQty(ri.qty, ri.products?.unit_type ?? "unidad")} ${ri.products?.name ?? "—"}`
                        )
                        .join(" · ") || "—"}
                    </span>
                    {d.reason && (
                      <span className="truncate text-[11.5px] text-faint">{d.reason}</span>
                    )}
                  </div>

                  <div className="tnum text-right font-medium text-danger">
                    − {formatMoney(d.total)}
                  </div>

                  <div className="text-faint">
                    <ChevronRight className="size-4" strokeWidth={1.8} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>

      <p className="text-[12px] text-faint">
        Sin cuenta corriente no hay saldo a favor:{" "}
        <Badge tone="neutral">se devuelve o no se devuelve</Badge>. Si no hay turno de caja
        abierto, la devolución no se puede registrar.
      </p>
    </>
  );
}

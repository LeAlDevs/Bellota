import { createClient } from "@/lib/supabase/server";
import { getNombresDeUsuarios } from "@/lib/usuarios";
import { formatDateTime, formatKg, formatMoney, formatNumber } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { MOTIVE_LABEL, REASON_LABEL, type Motive, type Reason } from "@/lib/stock";
import { cn } from "@/lib/utils";

type Mov = {
  id: string;
  delta: number;
  reason: Reason;
  motive: Motive | null;
  unit_cost: number | null;
  note: string | null;
  created_at: string;
  user_id: string | null;
  products: { id: string; name: string; plu: number | null; unit_type: "kg" | "unidad" } | null;
  stores: { name: string } | null;
};

const COLS =
  "grid-cols-[140px_minmax(0,1fr)_120px_150px_110px_110px_minmax(0,150px)]";

/** Las salidas se pintan en rojo y las entradas en verde: se lee de un vistazo. */
function tonoDelta(delta: number) {
  return delta < 0 ? "text-danger" : "text-ok";
}

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string; local?: string; motivo?: string }>;
}) {
  const sp = await searchParams;
  const sb = await createClient();

  const [{ data: stores }, { data: producto }] = await Promise.all([
    sb.from("stores").select("id, name").eq("active", true).order("name"),
    sp.producto
      ? sb.from("products").select("name").eq("id", sp.producto).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let query = sb
    .from("stock_movements")
    .select(
      "id, delta, reason, motive, unit_cost, note, created_at, user_id, products(id, name, plu, unit_type), stores(name)"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (sp.producto) query = query.eq("product_id", sp.producto);
  if (sp.local) query = query.eq("store_id", sp.local);
  if (sp.motivo) query = query.eq("reason", sp.motivo);

  const { data, error } = await query.returns<Mov[]>();
  const movs = data ?? [];
  const nombres = await getNombresDeUsuarios(movs.map((m) => m.user_id));

  const perdido = movs
    .filter((m) => m.reason === "merma" || m.reason === "vencimiento")
    .reduce((a, m) => a + Math.abs(Number(m.delta)) * Number(m.unit_cost ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Movimientos de stock"
        subtitle={
          producto?.name
            ? `Historial de ${producto.name}`
            : "Todo lo que entró y salió, con su motivo y quién lo hizo"
        }
      >
        {perdido > 0 && (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[11.5px] text-muted">Perdido en lo que se ve</span>
            <span className="num text-lg text-danger">{formatMoney(perdido)}</span>
          </div>
        )}
      </PageHeader>

      <form className="flex flex-wrap items-center gap-2.5">
        {sp.producto && <input type="hidden" name="producto" value={sp.producto} />}
        <select
          name="local"
          defaultValue={sp.local ?? ""}
          className="h-10 rounded-lg border border-line-strong bg-card px-3 pr-8 text-[13px] outline-none"
        >
          <option value="">Los dos locales</option>
          {(stores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          name="motivo"
          defaultValue={sp.motivo ?? ""}
          className="h-10 rounded-lg border border-line-strong bg-card px-3 pr-8 text-[13px] outline-none"
        >
          <option value="">Todos los motivos</option>
          {Object.entries(REASON_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <Button type="submit" variant="ghost">
          Filtrar
        </Button>

        {(sp.producto || sp.local || sp.motivo) && (
          <a
            href="/stock/movimientos"
            className="text-[12.5px] font-medium text-accent hover:text-accent-hover"
          >
            Limpiar filtros
          </a>
        )}

        <span className="grow" />
        <span className="text-[12.5px] text-muted">
          {movs.length === 300
            ? "Últimos 300 movimientos"
            : `${formatNumber(movs.length)} movimientos`}
        </span>
      </form>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer los movimientos"
            description={`La base devolvió: ${error.message}.`}
          />
        ) : movs.length === 0 ? (
          <EmptyState
            title="Sin movimientos"
            description="Cuando se cargue stock, se venda o se registre una merma, va a aparecer acá."
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
              <div>Producto</div>
              <div>Local</div>
              <div>Motivo</div>
              <div className="text-right">Cantidad</div>
              <div className="text-right">Valor</div>
              <div>Quién</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {movs.map((m) => {
                const delta = Number(m.delta);
                const cant = Math.abs(delta);
                const esKg = m.products?.unit_type === "kg";
                const valor = cant * Number(m.unit_cost ?? 0);

                return (
                  <div
                    key={m.id}
                    className={cn(
                      "grid items-center border-b border-line/60 px-4 py-2.5 text-[13px]",
                      COLS
                    )}
                  >
                    <div className="text-[12px] text-muted">
                      {formatDateTime(m.created_at)}
                    </div>

                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {m.products?.name ?? "—"}
                      </span>
                      {m.note && (
                        <span className="truncate text-[11.5px] text-faint">{m.note}</span>
                      )}
                    </div>

                    <div className="truncate text-muted">{m.stores?.name ?? "—"}</div>

                    <div className="flex items-center gap-1.5">
                      {m.reason === "merma" && m.motive ? (
                        <Badge tone="danger">{MOTIVE_LABEL[m.motive]}</Badge>
                      ) : (
                        <span className="truncate text-[12.5px] text-muted">
                          {REASON_LABEL[m.reason] ?? m.reason}
                        </span>
                      )}
                    </div>

                    <div className={cn("num text-right", tonoDelta(delta))}>
                      {delta > 0 ? "+" : "−"}
                      {esKg ? `${formatKg(cant)} kg` : formatNumber(cant)}
                    </div>

                    <div className="tnum text-right text-muted">
                      {m.unit_cost ? formatMoney(valor) : "—"}
                    </div>

                    <div className="truncate text-[12px] text-muted">
                      {(m.user_id && nombres.get(m.user_id)) || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

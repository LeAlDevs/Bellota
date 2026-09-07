import { createClient } from "@/lib/supabase/server";
import { getNombresDeUsuarios } from "@/lib/usuarios";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Turno = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  declared_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  status: "abierta" | "cerrada";
  note: string | null;
  opened_by: string | null;
  closed_by: string | null;
  stores: { name: string } | null;
};

const COLS = "grid-cols-[150px_110px_minmax(0,1fr)_120px_120px_120px]";

/** Una diferencia chica y constante en el mismo turno no es distracción. */
function tono(dif: number, esperado: number) {
  const abs = Math.abs(dif);
  if (abs < 1) return "ok";
  if (esperado > 0 && abs < esperado * 0.01) return "warn";
  return "danger";
}

export default async function ArqueosPage() {
  const sb = await createClient();

  const { data, error } = await sb
    .from("cash_sessions")
    .select(
      "id, opened_at, closed_at, opening_float, declared_cash, expected_cash, difference, status, note, opened_by, closed_by, stores(name)"
    )
    .order("opened_at", { ascending: false })
    .limit(60)
    .returns<Turno[]>();

  const turnos = data ?? [];
  const nombres = await getNombresDeUsuarios(
    turnos.flatMap((t) => [t.opened_by, t.closed_by])
  );

  const cerrados = turnos.filter((t) => t.status === "cerrada");
  const acumulada = cerrados.reduce((a, t) => a + Number(t.difference ?? 0), 0);
  const conDiferencia = cerrados.filter((t) => Math.abs(Number(t.difference ?? 0)) >= 1);

  return (
    <>
      <PageHeader
        title="Historial de arqueos"
        subtitle="Cada cierre, con lo que se contó contra lo que decía el sistema."
      >
        {cerrados.length > 0 && (
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[11.5px] text-muted">Con diferencia</span>
              <span className="num text-lg">
                {formatNumber(conDiferencia.length)} de {formatNumber(cerrados.length)}
              </span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[11.5px] text-muted">Diferencia acumulada</span>
              <span
                className={cn(
                  "num text-lg",
                  Math.abs(acumulada) < 1
                    ? "text-ok"
                    : acumulada < 0
                      ? "text-danger"
                      : "text-warn"
                )}
              >
                {acumulada > 0 ? "+" : ""}
                {formatMoney(acumulada)}
              </span>
            </div>
          </div>
        )}
      </PageHeader>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer los arqueos"
            description={`La base devolvió: ${error.message}.`}
          />
        ) : turnos.length === 0 ? (
          <EmptyState
            title="Todavía no se cerró ningún turno"
            description="Cuando se abra y se cierre la caja, cada cierre va a quedar acá con su diferencia."
          />
        ) : (
          <>
            <div
              className={cn(
                "grid shrink-0 border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint",
                COLS
              )}
            >
              <div>Abierto</div>
              <div>Local</div>
              <div>Cajero</div>
              <div className="text-right">Esperado</div>
              <div className="text-right">Contado</div>
              <div className="text-right">Diferencia</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {turnos.map((t) => {
                const dif = Number(t.difference ?? 0);
                const esperado = Number(t.expected_cash ?? 0);
                const color = tono(dif, esperado);

                return (
                  <div
                    key={t.id}
                    className={cn(
                      "grid items-center border-b border-line/60 px-4 py-2.5 text-[13px]",
                      COLS
                    )}
                  >
                    <div className="flex flex-col">
                      <span className="text-[12.5px]">{formatDateTime(t.opened_at)}</span>
                      {t.note && (
                        <span className="truncate text-[11px] text-faint">{t.note}</span>
                      )}
                    </div>

                    <div className="text-muted">{t.stores?.name ?? "—"}</div>

                    <div className="truncate text-muted">
                      {(t.opened_by && nombres.get(t.opened_by)) || "—"}
                    </div>

                    {t.status === "abierta" ? (
                      <>
                        <div className="col-span-3 flex justify-end">
                          <Badge tone="warn">Todavía abierto</Badge>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="tnum text-right text-muted">
                          {formatMoney(esperado)}
                        </div>
                        <div className="tnum text-right">
                          {formatMoney(Number(t.declared_cash ?? 0))}
                        </div>
                        <div
                          className={cn(
                            "num text-right",
                            color === "ok" && "text-ok",
                            color === "warn" && "text-warn",
                            color === "danger" && "text-danger"
                          )}
                        >
                          {Math.abs(dif) < 1
                            ? "justo"
                            : `${dif > 0 ? "+" : "−"}${formatMoney(Math.abs(dif))}`}
                        </div>
                      </>
                    )}
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

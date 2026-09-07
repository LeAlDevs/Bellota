"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, LockKeyhole, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Textarea } from "@/components/ui/form";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { abrirTurno, cerrarTurno, registrarMovimientoCaja } from "../actions";

const num = (s: string) => {
  const v = Number((s ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export function AbrirTurno({
  storeId,
  storeName,
}: {
  storeId: string;
  storeName: string;
}) {
  const router = useRouter();
  const [fondo, setFondo] = useState("");
  const [enviando, startEnviar] = useTransition();

  return (
    <Card className="flex max-w-lg flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold">Abrir el turno en {storeName}</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Contá lo que hay en el cajón antes de empezar. Ese número es contra el que
          se compara al cerrar: si arranca mal, la diferencia de la noche no dice
          nada.
        </p>
      </div>

      <Field label="Fondo inicial" hint="Lo que hay en el cajón ahora mismo">
        <Input
          inputMode="decimal"
          value={fondo}
          onChange={(e) => setFondo(e.target.value)}
          placeholder="80.000"
          className="text-lg"
          autoFocus
        />
      </Field>

      <div>
        <Button
          type="button"
          disabled={enviando}
          onClick={() =>
            startEnviar(async () => {
              const res = await abrirTurno(storeId, num(fondo));
              if (res.error) {
                toast.error(res.error);
                return;
              }
              toast.success("Turno abierto.");
              router.push("/pos");
            })
          }
        >
          <LockOpen className="size-4" strokeWidth={1.8} />
          {enviando ? "Abriendo…" : "Abrir turno"}
        </Button>
      </div>
    </Card>
  );
}

export function TurnoAbierto({
  sessionId,
  storeName,
  abiertoDesde,
  fondo,
  esperado,
  ventasEfectivo,
  ventasTotales,
  tickets,
  movimientos,
}: {
  sessionId: string;
  storeName: string;
  abiertoDesde: string;
  fondo: number;
  esperado: number;
  ventasEfectivo: number;
  ventasTotales: number;
  tickets: number;
  movimientos: { id: string; amount: number; kind: string; note: string | null }[];
}) {
  const router = useRouter();
  const [declarado, setDeclarado] = useState("");
  const [nota, setNota] = useState("");
  const [monto, setMonto] = useState("");
  const [notaMov, setNotaMov] = useState("");
  const [enviando, startEnviar] = useTransition();

  const contado = num(declarado);
  const diferencia = declarado.trim() === "" ? null : contado - esperado;

  function movimiento(tipo: "retiro" | "ingreso") {
    const m = num(monto);
    if (m <= 0) {
      toast.error("Poné un monto mayor que cero.");
      return;
    }
    startEnviar(async () => {
      const res = await registrarMovimientoCaja(sessionId, m, tipo, notaMov || undefined);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(tipo === "retiro" ? "Retiro registrado." : "Ingreso registrado.");
      setMonto("");
      setNotaMov("");
      router.refresh();
    });
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-y-auto pb-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Fondo inicial</span>
            <span className="num text-[22px] leading-none">{formatMoney(fondo)}</span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Cobrado en efectivo</span>
            <span className="num text-[22px] leading-none">
              {formatMoney(ventasEfectivo)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Vendido en total</span>
            <span className="num text-[22px] leading-none">
              {formatMoney(ventasTotales)}
            </span>
            <span className="text-[11.5px] text-faint">{tickets} tickets</span>
          </Card>
          <Card className="flex flex-col gap-1 border-accent/30 bg-accent-soft/40 p-4">
            <span className="text-[11.5px] text-accent">Tiene que haber</span>
            <span className="num text-[22px] leading-none text-accent-hover">
              {formatMoney(esperado)}
            </span>
          </Card>
        </div>

        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Retiros e ingresos</h3>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Todo lo que entra o sale del cajón sin ser una venta. Si no se anota,
              la caja va a cerrar mal y nadie va a saber por qué.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2.5">
            <Field label="Monto" className="w-40">
              <Input
                inputMode="decimal"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="20.000"
                className="text-right"
              />
            </Field>
            <Field label="Nota" className="min-w-48 grow">
              <Input
                value={notaMov}
                onChange={(e) => setNotaMov(e.target.value)}
                placeholder="Retiro del dueño, cambio para el turno…"
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              disabled={enviando}
              onClick={() => movimiento("retiro")}
            >
              <ArrowUpRight className="size-4" strokeWidth={1.8} />
              Sale
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={enviando}
              onClick={() => movimiento("ingreso")}
            >
              <ArrowDownLeft className="size-4" strokeWidth={1.8} />
              Entra
            </Button>
          </div>

          {movimientos.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-line pt-3">
              {movimientos.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-[13px]">
                  <span
                    className={cn(
                      "num w-28",
                      Number(m.amount) < 0 ? "text-danger" : "text-ok"
                    )}
                  >
                    {Number(m.amount) > 0 ? "+" : "−"}
                    {formatMoney(Math.abs(Number(m.amount)))}
                  </span>
                  <span className="text-muted">{m.note ?? m.kind}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="flex h-fit flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Cerrar el turno</h3>
          <p className="text-[12.5px] leading-relaxed text-muted">
            {storeName} · abierto desde {formatDateTime(abiertoDesde)}
          </p>
        </div>

        <Field
          label="¿Cuánto contaste en el cajón?"
          hint="Contalo antes de mirar lo esperado, si no el número se contagia"
        >
          <Input
            inputMode="decimal"
            value={declarado}
            onChange={(e) => setDeclarado(e.target.value)}
            placeholder="0"
            className="text-right text-lg"
          />
        </Field>

        {diferencia !== null && (
          <div
            className={cn(
              "flex items-center justify-between rounded-lg px-3.5 py-3",
              Math.abs(diferencia) < 1
                ? "bg-ok-bg"
                : Math.abs(diferencia) < esperado * 0.01
                  ? "bg-warn-bg"
                  : "bg-danger-bg"
            )}
          >
            <span
              className={cn(
                "text-[12.5px] font-medium",
                Math.abs(diferencia) < 1
                  ? "text-ok"
                  : Math.abs(diferencia) < esperado * 0.01
                    ? "text-warn"
                    : "text-danger"
              )}
            >
              {Math.abs(diferencia) < 1
                ? "Cierra justo"
                : diferencia < 0
                  ? "Falta"
                  : "Sobra"}
            </span>
            <span
              className={cn(
                "num text-lg",
                Math.abs(diferencia) < 1
                  ? "text-ok"
                  : Math.abs(diferencia) < esperado * 0.01
                    ? "text-warn"
                    : "text-danger"
              )}
            >
              {formatMoney(Math.abs(diferencia))}
            </span>
          </div>
        )}

        <Field label="Nota" hint="Opcional. Si hay diferencia, conviene explicarla.">
          <Textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            className="min-h-16"
          />
        </Field>

        <Button
          type="button"
          disabled={enviando || declarado.trim() === ""}
          onClick={() =>
            startEnviar(async () => {
              const res = await cerrarTurno(sessionId, contado, nota || undefined);
              if (res.error) {
                toast.error(res.error);
                return;
              }
              const d = res.diferencia ?? 0;
              toast.success(
                Math.abs(d) < 1
                  ? "Turno cerrado y la caja cierra justo."
                  : `Turno cerrado con ${formatMoney(Math.abs(d))} ${d < 0 ? "de menos" : "de más"}.`
              );
              router.push("/pos/arqueos");
            })
          }
        >
          <LockKeyhole className="size-4" strokeWidth={1.8} />
          {enviando ? "Cerrando…" : "Cerrar turno"}
        </Button>
      </Card>
    </div>
  );
}

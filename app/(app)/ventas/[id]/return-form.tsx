"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Input, Textarea } from "@/components/ui/form";
import { formatMoney, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { registrarDevolucion } from "../actions";

export type LineaDevolvible = {
  id: string;
  nombre: string;
  unitType: "kg" | "unidad";
  qty: number;
  unitPrice: number;
  subtotal: number;
  devuelto: number;
};

/**
 * Cuánta plata sale del cajón por devolver `qty` de una línea.
 *
 * Es proporcional al importe COBRADO, no a cantidad × precio: en una línea que
 * entró por etiqueta de balanza se cobró el importe del papel, y si acá
 * multiplicara de nuevo devolvería unos pesos de más o de menos.
 */
function reintegro(l: LineaDevolvible, qty: number): number {
  if (qty <= 0 || l.qty <= 0) return 0;
  return Math.round(l.subtotal * (qty / l.qty) * 100) / 100;
}

export function FormularioDevolucion({
  saleId,
  numero,
  lineas,
}: {
  saleId: string;
  numero: number;
  lineas: LineaDevolvible[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [enviando, startEnviar] = useTransition();

  const disponibles = lineas.filter((l) => l.qty - l.devuelto > 0.0005);

  const total = useMemo(
    () =>
      disponibles.reduce((a, l) => a + reintegro(l, Number(cantidades[l.id] ?? 0) || 0), 0),
    [disponibles, cantidades]
  );

  if (disponibles.length === 0) {
    return (
      <Card className="px-4 py-3 text-[13px] text-muted">
        De este ticket ya se devolvió todo.
      </Card>
    );
  }

  if (!abierto) {
    return (
      <Button type="button" variant="ghost" onClick={() => setAbierto(true)}>
        <Undo2 className="size-4" strokeWidth={1.8} />
        Devolver mercadería
      </Button>
    );
  }

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-sm font-semibold">Devolver del ticket #{numero}</span>
        <span className="grow" />
        <span className="text-[11.5px] text-muted">
          Repone el stock y saca la plata del cajón del turno
        </span>
      </div>

      <div className="flex flex-col divide-y divide-line/60">
        {disponibles.map((l) => {
          const resta = l.qty - l.devuelto;
          const qty = Number(cantidades[l.id] ?? 0) || 0;
          const excede = qty - resta > 0.0005;

          return (
            <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex min-w-0 grow flex-col">
                <span className="truncate text-[13px] font-medium">{l.nombre}</span>
                <span className="text-[11.5px] text-faint">
                  Quedan {formatQty(resta, l.unitType)} de {formatQty(l.qty, l.unitType)}
                  {l.devuelto > 0 && ` · ya devolviste ${formatQty(l.devuelto, l.unitType)}`}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setCantidades((c) => ({ ...c, [l.id]: String(resta) }))}
                className="shrink-0 text-[12px] font-medium text-accent hover:text-accent-hover"
              >
                Todo
              </button>

              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={resta}
                step={l.unitType === "kg" ? 0.001 : 1}
                value={cantidades[l.id] ?? ""}
                onChange={(e) =>
                  setCantidades((c) => ({ ...c, [l.id]: e.target.value }))
                }
                placeholder="0"
                className={cn("num w-32 shrink-0 text-right", excede && "border-danger")}
              />

              <span className="tnum w-28 shrink-0 text-right text-[13px] text-muted">
                {qty > 0 ? formatMoney(reintegro(l, Math.min(qty, resta))) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
        <Textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Por qué lo devuelve (opcional): vino cortado, se equivocó de producto…"
          className="min-h-16 text-[13px]"
        />

        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-[0.05em] text-faint">
              Sale del cajón
            </span>
            <span className="num text-lg text-danger">{formatMoney(total)}</span>
          </div>

          <span className="grow" />

          <Button
            type="button"
            variant="ghost"
            disabled={enviando}
            onClick={() => {
              setAbierto(false);
              setCantidades({});
            }}
          >
            Cancelar
          </Button>

          <Button
            type="button"
            disabled={enviando || total <= 0}
            onClick={() => {
              const items = disponibles
                .map((l) => ({
                  sale_item_id: l.id,
                  qty: Math.min(Number(cantidades[l.id] ?? 0) || 0, l.qty - l.devuelto),
                }))
                .filter((i) => i.qty > 0);

              if (items.length === 0) {
                toast.error("No marcaste nada para devolver.");
                return;
              }

              const ok = confirm(
                `Vas a devolver ${formatMoney(total)} del ticket #${numero}.\n\n` +
                  "La mercadería vuelve al stock y la plata sale de la caja del turno. ¿Confirmás?"
              );
              if (!ok) return;

              startEnviar(async () => {
                const res = await registrarDevolucion(saleId, items, motivo);
                if (res.error) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`Devolución de ${formatMoney(total)} registrada.`);
                setAbierto(false);
                setCantidades({});
                setMotivo("");
                router.refresh();
              });
            }}
          >
            Confirmar devolución
          </Button>
        </div>
      </div>
    </Card>
  );
}

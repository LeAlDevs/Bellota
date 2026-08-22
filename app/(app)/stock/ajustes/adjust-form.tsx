"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Textarea } from "@/components/ui/form";
import { ProductPicker, type PickerProduct } from "@/components/ui/product-picker";
import { formatKg, formatMoney, formatNumber } from "@/lib/format";
import { MOTIVES, type Motive } from "@/lib/stock";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/auth";
import { registrarAjuste } from "../actions";

type Store = { id: string; name: string };
type Modo = "merma" | "conteo";

const initial: ActionState = {};

export function AdjustForm({
  stores,
  products,
  storeIdPropio,
}: {
  stores: Store[];
  products: PickerProduct[];
  /** El local del usuario, para que arranque elegido el suyo. */
  storeIdPropio: string | null;
}) {
  const [state, action, pending] = useActionState(registrarAjuste, initial);
  const [modo, setModo] = useState<Modo>("merma");
  const [store, setStore] = useState(storeIdPropio ?? stores[0]?.id ?? "");
  const [producto, setProducto] = useState<PickerProduct | null>(null);
  const [qty, setQty] = useState("");
  const [motivo, setMotivo] = useState<Motive | "">("");

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) {
      toast.success(modo === "merma" ? "Merma registrada." : "Stock ajustado.");
      setProducto(null);
      setQty("");
      setMotivo("");
    }
    // modo queda fuera a propósito: si cambia no hay que volver a avisar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const actual = producto ? (producto.stock[store] ?? 0) : null;
  const cantidad = Number(qty.replace(/\./g, "").replace(",", "."));
  const cantidadOk = Number.isFinite(cantidad) && cantidad >= 0;

  const fmt = (n: number) =>
    producto?.unit_type === "kg" ? `${formatKg(n)} kg` : formatNumber(n);

  const resultado =
    producto && actual !== null && cantidadOk
      ? modo === "merma"
        ? actual - cantidad
        : cantidad
      : null;

  const diferencia =
    modo === "conteo" && actual !== null && cantidadOk ? cantidad - actual : null;

  const err = state.fieldErrors;

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-3.5">
      <input type="hidden" name="mode" value={modo} />

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setModo("merma")}
            className={cn(
              "flex flex-1 flex-col gap-0.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
              modo === "merma"
                ? "border-accent bg-accent-soft"
                : "border-line-strong bg-card hover:bg-canvas"
            )}
          >
            <span className="text-[13px] font-semibold">Registrar merma</span>
            <span className="text-[11.5px] text-muted">
              Se perdió mercadería y sabés por qué
            </span>
          </button>
          <button
            type="button"
            onClick={() => setModo("conteo")}
            className={cn(
              "flex flex-1 flex-col gap-0.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
              modo === "conteo"
                ? "border-accent bg-accent-soft"
                : "border-line-strong bg-card hover:bg-canvas"
            )}
          >
            <span className="text-[13px] font-semibold">Ajustar por conteo</span>
            <span className="text-[11.5px] text-muted">
              Contaste la góndola y no coincide
            </span>
          </button>
        </div>

        <Field label="Local" error={err?.store_id?.[0]}>
          <div className="flex gap-2">
            {stores.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStore(s.id)}
                className={cn(
                  "h-10 flex-1 rounded-lg border text-[13px] font-medium transition-colors",
                  store === s.id
                    ? "border-accent bg-accent-soft text-accent-hover"
                    : "border-line-strong bg-card hover:bg-canvas"
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
          <input type="hidden" name="store_id" value={store} />
        </Field>

        <Field label="Producto" error={err?.product_id?.[0]}>
          <ProductPicker
            products={products}
            name="product_id"
            value={producto}
            onChange={setProducto}
            autoFocus
          />
        </Field>

        {producto && (
          <div className="flex items-center justify-between rounded-lg bg-canvas px-3.5 py-2.5">
            <span className="text-xs font-medium text-muted">
              Hoy hay en {stores.find((s) => s.id === store)?.name}
            </span>
            <span className="num text-sm">{fmt(actual ?? 0)}</span>
          </div>
        )}

        <Field
          label={
            modo === "merma"
              ? producto?.unit_type === "unidad"
                ? "¿Cuántas unidades se perdieron?"
                : "¿Cuántos kilos se perdieron?"
              : producto?.unit_type === "unidad"
                ? "¿Cuántas unidades contaste?"
                : "¿Cuántos kilos contaste?"
          }
          error={err?.qty?.[0]}
          hint={
            modo === "conteo"
              ? "Poné lo que hay de verdad. El sistema calcula la diferencia solo."
              : undefined
          }
        >
          <Input
            name="qty"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder={producto?.unit_type === "unidad" ? "3" : "1,250"}
          />
        </Field>

        {modo === "merma" && (
          <Field label="¿Por qué se perdió?" error={err?.motive?.[0]}>
            <input type="hidden" name="motive" value={motivo} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MOTIVES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMotivo(m.key)}
                  title={m.hint}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    motivo === m.key
                      ? "border-accent bg-accent-soft"
                      : "border-line-strong bg-card hover:bg-canvas"
                  )}
                >
                  <span className="text-[12.5px] font-medium">{m.label}</span>
                  <span className="text-[11px] leading-snug text-muted">{m.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Nota" hint="Opcional, queda en el historial">
          <Textarea
            name="note"
            placeholder={
              modo === "merma"
                ? "Vinieron con la cadena de frío cortada"
                : "Conteo de fin de mes"
            }
          />
        </Field>
      </Card>

      {producto && resultado !== null && (
        <Card
          className={cn(
            "flex items-center gap-4 p-4",
            modo === "merma" ? "border-danger/25 bg-danger-bg/40" : "bg-subtle"
          )}
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-[11.5px] text-muted">Queda en stock</span>
            <span className="num text-lg">{fmt(resultado)}</span>
          </div>

          {modo === "merma" && cantidad > 0 && (
            <div className="flex flex-col gap-0.5 border-l border-danger/20 pl-4">
              <span className="text-[11.5px] text-muted">Plata perdida</span>
              <span className="num text-lg text-danger">
                {formatMoney(cantidad * (producto.cost ?? 0))}
              </span>
            </div>
          )}

          {modo === "conteo" && diferencia !== null && diferencia !== 0 && (
            <div className="flex flex-col gap-0.5 border-l border-line pl-4">
              <span className="text-[11.5px] text-muted">Diferencia</span>
              <span
                className={cn(
                  "num text-lg",
                  diferencia < 0 ? "text-danger" : "text-ok"
                )}
              >
                {diferencia > 0 ? "+" : ""}
                {fmt(diferencia)}
              </span>
            </div>
          )}

          {modo === "conteo" && diferencia === 0 && (
            <span className="text-[13px] text-muted">
              Coincide con lo que dice el sistema: no se registra nada.
            </span>
          )}
        </Card>
      )}

      <div className="flex items-center gap-2.5">
        <Button
          type="submit"
          disabled={pending || !producto || !cantidadOk || (modo === "merma" && !motivo)}
        >
          {pending
            ? "Guardando…"
            : modo === "merma"
              ? "Registrar merma"
              : "Ajustar stock"}
        </Button>
        <span className="text-xs text-faint">
          Queda en el historial con tu nombre y la hora.
        </span>
      </div>
    </form>
  );
}

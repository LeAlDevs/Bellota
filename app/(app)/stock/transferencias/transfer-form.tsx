"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Textarea } from "@/components/ui/form";
import { ProductPicker, type PickerProduct } from "@/components/ui/product-picker";
import { formatKg, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { crearTransferencia } from "../actions";

type Store = { id: string; name: string };
type Linea = { producto: PickerProduct; qty: number };

export function TransferForm({
  stores,
  products,
  storeIdPropio,
}: {
  stores: Store[];
  products: PickerProduct[];
  storeIdPropio: string | null;
}) {
  const inicial = storeIdPropio ?? stores[0]?.id ?? "";
  const [origen, setOrigen] = useState(inicial);
  const [destino, setDestino] = useState(
    stores.find((s) => s.id !== inicial)?.id ?? ""
  );
  const [nota, setNota] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [producto, setProducto] = useState<PickerProduct | null>(null);
  const [qty, setQty] = useState("");
  const [enviando, startEnviar] = useTransition();

  const disponible = producto ? (producto.stock[origen] ?? 0) : null;
  // Lo ya cargado en el carrito también reserva stock: si no, alguien pone dos
  // líneas del mismo producto y recién falla al confirmar.
  const yaEnCarrito = producto
    ? lineas
        .filter((l) => l.producto.id === producto.id)
        .reduce((a, l) => a + l.qty, 0)
    : 0;
  const libre = disponible === null ? null : disponible - yaEnCarrito;

  const cantidad = Number(qty.replace(/\./g, "").replace(",", "."));
  const cantidadOk = Number.isFinite(cantidad) && cantidad > 0;
  const alcanza = libre === null || !cantidadOk || cantidad <= libre;

  const fmt = (n: number, t: "kg" | "unidad") =>
    t === "kg" ? `${formatKg(n)} kg` : formatNumber(n);

  const valorTotal = lineas.reduce(
    (a, l) => a + l.qty * Number(l.producto.cost),
    0
  );

  function agregar() {
    if (!producto || !cantidadOk || !alcanza) return;
    setLineas((ls) => [...ls, { producto, qty: cantidad }]);
    setProducto(null);
    setQty("");
  }

  function confirmar() {
    if (lineas.length === 0) return;
    startEnviar(async () => {
      const res = await crearTransferencia(
        origen,
        destino,
        lineas.map((l) => ({ product_id: l.producto.id, qty: l.qty })),
        nota || undefined
      );
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Transferencia registrada. El stock ya se movió.");
      setLineas([]);
      setNota("");
    });
  }

  const nombreOrigen = stores.find((s) => s.id === origen)?.name ?? "";
  const nombreDestino = stores.find((s) => s.id === destino)?.name ?? "";

  return (
    <div className="flex max-w-3xl flex-col gap-3.5">
      <Card className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
          <Field label="Sale de">
            <div className="flex gap-2">
              {stores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setOrigen(s.id);
                    if (destino === s.id) {
                      setDestino(stores.find((o) => o.id !== s.id)?.id ?? "");
                    }
                    setLineas([]);
                  }}
                  className={cn(
                    "h-10 flex-1 rounded-lg border text-[13px] font-medium transition-colors",
                    origen === s.id
                      ? "border-accent bg-accent-soft text-accent-hover"
                      : "border-line-strong bg-card hover:bg-canvas"
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </Field>

          <ArrowRight className="mb-2.5 size-5 text-faint" strokeWidth={1.8} />

          <Field label="Entra en">
            <div className="flex gap-2">
              {stores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={s.id === origen}
                  onClick={() => setDestino(s.id)}
                  className={cn(
                    "h-10 flex-1 rounded-lg border text-[13px] font-medium transition-colors disabled:opacity-40",
                    destino === s.id
                      ? "border-accent bg-accent-soft text-accent-hover"
                      : "border-line-strong bg-card hover:bg-canvas"
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_140px_auto] items-end gap-2.5">
          <Field label="Producto">
            <ProductPicker
              products={products}
              value={producto}
              onChange={(p) => {
                setProducto(p);
                setQty("");
              }}
            />
          </Field>

          <Field
            label={producto?.unit_type === "unidad" ? "Unidades" : "Kilos"}
            error={!alcanza ? "No alcanza" : undefined}
          >
            <Input
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregar();
                }
              }}
              placeholder={producto?.unit_type === "unidad" ? "3" : "1,250"}
            />
          </Field>

          <Button
            type="button"
            variant="ghost"
            onClick={agregar}
            disabled={!producto || !cantidadOk || !alcanza}
          >
            <Plus className="size-4" strokeWidth={2} />
            Agregar
          </Button>
        </div>

        {producto && libre !== null && (
          <p
            className={cn(
              "text-[12.5px]",
              alcanza ? "text-muted" : "font-medium text-danger"
            )}
          >
            En {nombreOrigen} hay {fmt(disponible ?? 0, producto.unit_type)}
            {yaEnCarrito > 0 && (
              <> · ya cargaste {fmt(yaEnCarrito, producto.unit_type)} en esta transferencia</>
            )}
            {!alcanza && <> · te estás pasando por {fmt(cantidad - libre, producto.unit_type)}</>}
          </p>
        )}

        <Field label="Nota" hint="Opcional. Queda en el historial.">
          <Textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Reposición del sábado"
          />
        </Field>
      </Card>

      <Card className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <p className="text-sm font-semibold">
            {lineas.length === 0
              ? "Todavía no cargaste nada"
              : `${lineas.length} ${lineas.length === 1 ? "producto" : "productos"} para mandar`}
          </p>
          <span className="grow" />
          {valorTotal > 0 && (
            <span className="text-[12.5px] text-muted">
              Valor a costo <span className="num">{formatMoney(valorTotal)}</span>
            </span>
          )}
        </div>

        {lineas.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-muted">
            Buscá un producto arriba, poné la cantidad y agregalo.
          </p>
        ) : (
          lineas.map((l, i) => (
            <div
              key={`${l.producto.id}-${i}`}
              className="flex items-center gap-3 border-t border-line/60 px-4 py-2.5 text-[13px]"
            >
              <span className="tnum w-14 shrink-0 text-faint">
                {l.producto.plu ?? "—"}
              </span>
              <span className="truncate font-medium">{l.producto.name}</span>
              <span className="grow" />
              <span className="num">{fmt(l.qty, l.producto.unit_type)}</span>
              <span className="tnum w-24 text-right text-muted">
                {formatMoney(l.qty * Number(l.producto.cost))}
              </span>
              <button
                type="button"
                aria-label={`Sacar ${l.producto.name}`}
                onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 className="size-4" strokeWidth={1.8} />
              </button>
            </div>
          ))
        )}
      </Card>

      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          onClick={confirmar}
          disabled={enviando || lineas.length === 0 || !destino || origen === destino}
        >
          {enviando
            ? "Registrando…"
            : `Mandar de ${nombreOrigen} a ${nombreDestino}`}
        </Button>
        <span className="text-xs text-faint">
          El stock se mueve en el momento: no hay estado &quot;en tránsito&quot;.
        </span>
      </div>
    </div>
  );
}

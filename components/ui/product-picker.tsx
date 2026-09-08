"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Una forma de vender el producto: fraccionado, horma entera, media horma.
 * Cada una tiene su PLU en la balanza y su propio $/kg; todas descuentan del
 * mismo stock, con el mismo costo.
 */
export type Presentacion = {
  id: string;
  name: string;
  /** El de la balanza para ESTE precio. */
  plu: number | null;
  price: number;
  /** Desde cuánto tiene sentido. Una horma no son 200 g. */
  min_qty: number | null;
  is_default: boolean;
};

export type PickerProduct = {
  id: string;
  name: string;
  /** El de la presentación principal. Null en lo que no se pesa. */
  plu: number | null;
  /** El EAN de fábrica de los envasados. */
  barcode: string | null;
  unit_type: "kg" | "unidad";
  price: number;
  /** Si lleva control de vencimiento, la recepción va a pedir la fecha. */
  track_expiry: boolean;
  /** Cuántos días dura normalmente. Solo sirve para prellenar esa fecha. */
  shelf_life_days: number | null;
  /** Costo promedio ponderado, para mostrar cuánta plata se pierde en una merma. */
  cost: number;
  /** Todas las formas de venderlo. Siempre trae al menos la principal. */
  presentations: Presentacion[];
  /** { store_id: cantidad } */
  stock: Record<string, number>;
};

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Buscador de productos para el mostrador y la trastienda: se tipea nombre o
 * PLU y se elige de la lista. Un <select> con 400 opciones es inusable de pie
 * y con las manos ocupadas.
 */
export function ProductPicker({
  products,
  name,
  value,
  onChange,
  placeholder = "Buscar por nombre o PLU",
  autoFocus,
}: {
  products: PickerProduct[];
  /** Nombre del input oculto que viaja en el form. */
  name?: string;
  value: PickerProduct | null;
  onChange: (p: PickerProduct | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resultados = useMemo(() => {
    const t = norm(texto.trim());
    if (!t) return products.slice(0, 30);
    return products
      .filter(
        (p) => norm(p.name).includes(t) || (p.plu != null && String(p.plu).startsWith(t))
      )
      .slice(0, 30);
  }, [products, texto]);

  if (value) {
    return (
      <div className="flex h-10 items-center gap-2.5 rounded-lg border border-accent bg-accent-soft px-3.5">
        {name && <input type="hidden" name={name} value={value.id} />}
        <Check className="size-4 shrink-0 text-accent" strokeWidth={2} />
        <span className="truncate text-sm font-medium">{value.name}</span>
        <span className="tnum shrink-0 text-xs text-muted">
          {value.plu != null ? `PLU ${value.plu}` : "sin PLU"}
        </span>
        <span className="grow" />
        <button
          type="button"
          aria-label="Cambiar producto"
          onClick={() => {
            onChange(null);
            setTexto("");
            setAbierto(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="shrink-0 text-muted transition-colors hover:text-ink"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value="" />}
      <div className="flex h-10 items-center gap-2.5 rounded-lg border border-line-strong bg-card px-3.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
        <Search className="size-4 shrink-0 text-faint" strokeWidth={1.7} />
        <input
          ref={inputRef}
          value={texto}
          autoFocus={autoFocus}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>

      {abierto && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line-strong bg-card shadow-lg">
          {resultados.length === 0 ? (
            <p className="px-3.5 py-3 text-[13px] text-muted">
              Ningún producto coincide.
            </p>
          ) : (
            resultados.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p);
                  setAbierto(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[13px] transition-colors last:border-b-0 hover:bg-subtle"
                )}
              >
                <span className="tnum w-14 shrink-0 text-faint">{p.plu ?? "—"}</span>
                <span className="truncate font-medium">{p.name}</span>
                <span className="grow" />
                <span className="shrink-0 text-[11.5px] text-muted">
                  {p.unit_type === "kg" ? "por kg" : "unidad"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

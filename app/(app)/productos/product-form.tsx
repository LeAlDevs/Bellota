"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/auth";

export type ProductFormValues = {
  id?: string;
  plu?: number;
  name: string;
  description: string | null;
  category_id: string | null;
  unit_type: "kg" | "unidad";
  kind: "simple" | "elaborado" | "combo";
  price: number;
  cost: number;
  min_stock: number;
  track_expiry: boolean;
  shelf_life_days: number | null;
  barcode: string | null;
  sku: string | null;
  is_active: boolean;
};

const EMPTY: ProductFormValues = {
  name: "",
  description: null,
  category_id: null,
  unit_type: "kg",
  kind: "simple",
  price: 0,
  cost: 0,
  min_stock: 0,
  track_expiry: false,
  shelf_life_days: null,
  barcode: null,
  sku: null,
  is_active: true,
};

const initial: ActionState = {};

export function ProductForm({
  action,
  categories,
  product,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  categories: { id: string; name: string }[];
  product?: ProductFormValues;
}) {
  const p = product ?? EMPTY;
  const isEdit = Boolean(product?.id);

  const [state, formAction, pending] = useActionState(action, initial);
  const [unitType, setUnitType] = useState<"kg" | "unidad">(p.unit_type);
  const [trackExpiry, setTrackExpiry] = useState(p.track_expiry);
  const [price, setPrice] = useState(String(p.price));

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success("Producto guardado.");
  }, [state]);

  const priceNumber = Number(price.replace(/\./g, "").replace(",", "."));
  const margin =
    p.cost > 0 && priceNumber > 0
      ? ((priceNumber - p.cost) / priceNumber) * 100
      : null;

  const err = state.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Columna principal */}
        <div className="flex flex-col gap-3.5">
          <Card className="flex flex-col gap-4 p-5">
            <Field label="Nombre" error={err?.name?.[0]}>
              <Input
                name="name"
                defaultValue={p.name}
                autoFocus={!isEdit}
                placeholder="Jamón crudo estacionado"
              />
            </Field>

            {/* Se pesa o se cuenta: la decisión que atraviesa todo el sistema */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink/70">
                ¿Se pesa o se cuenta?
              </span>
              <input type="hidden" name="unit_type" value={unitType} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setUnitType("kg")}
                  className={cn(
                    "flex flex-1 flex-col gap-0.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                    unitType === "kg"
                      ? "border-accent bg-accent-soft"
                      : "border-line-strong bg-card hover:bg-canvas"
                  )}
                >
                  <span className="text-[13px] font-semibold">Se pesa · por kg</span>
                  <span className="text-[11.5px] text-muted">
                    Lleva PLU en la balanza y precio por kilo
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setUnitType("unidad")}
                  className={cn(
                    "flex flex-1 flex-col gap-0.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                    unitType === "unidad"
                      ? "border-accent bg-accent-soft"
                      : "border-line-strong bg-card hover:bg-canvas"
                  )}
                >
                  <span className="text-[13px] font-semibold">Se cuenta · por unidad</span>
                  <span className="text-[11.5px] text-muted">
                    Envasados, bandejas, bebidas
                  </span>
                </button>
              </div>
              {err?.unit_type && (
                <span className="text-xs text-danger">{err.unit_type[0]}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Categoría">
                <Select name="category_id" defaultValue={p.category_id ?? ""}>
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Tipo de producto"
                hint="El elaborado se produce; el combo descuenta sus componentes"
              >
                <Select name="kind" defaultValue={p.kind}>
                  <option value="simple">Simple — se compra y se vende</option>
                  <option value="elaborado">Elaborado — se produce</option>
                  <option value="combo">Combo — promoción</option>
                </Select>
              </Field>
            </div>

            <Field label="Descripción" hint="Opcional">
              <Textarea
                name="description"
                defaultValue={p.description ?? ""}
                placeholder="Notas internas sobre el producto"
              />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <p className="text-sm font-semibold">Identificación</p>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Código de barras del fabricante"
                hint="Solo para envasados que ya vienen con EAN"
              >
                <Input name="barcode" defaultValue={p.barcode ?? ""} inputMode="numeric" />
              </Field>
              <Field label="SKU interno" hint="Opcional">
                <Input name="sku" defaultValue={p.sku ?? ""} />
              </Field>
            </div>
          </Card>
        </div>

        {/* Columna lateral */}
        <div className="flex flex-col gap-3.5">
          <Card className="flex flex-col gap-4 p-5">
            <p className="text-sm font-semibold">Precio y costo</p>

            <Field
              label={unitType === "kg" ? "Precio de venta por kg" : "Precio de venta por unidad"}
              error={err?.price?.[0]}
              hint="Precio final. Monotributo: no se discrimina IVA."
            >
              <Input
                name="price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>

            {isEdit ? (
              <div className="flex flex-col gap-1.5 rounded-lg bg-canvas p-3.5">
                <span className="text-xs font-medium text-muted">
                  Costo promedio ponderado
                </span>
                <span className="num text-lg">{formatMoney(p.cost)}</span>
                <span className="text-[11.5px] leading-relaxed text-faint">
                  Lo recalcula cada recepción de compra. No se edita a mano.
                </span>
              </div>
            ) : (
              <Field
                label="Costo inicial"
                error={err?.cost?.[0]}
                hint="Punto de partida. Después lo maneja el promedio ponderado."
              >
                <Input name="cost" inputMode="decimal" defaultValue={String(p.cost)} />
              </Field>
            )}

            {margin !== null && (
              <div className="flex items-center justify-between rounded-lg bg-ok-bg px-3.5 py-2.5">
                <span className="text-xs font-medium text-ok">Margen</span>
                <span className="num text-sm text-ok">{margin.toFixed(1)}%</span>
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <p className="text-sm font-semibold">Reposición y vencimiento</p>

            <Field
              label={unitType === "kg" ? "Stock mínimo (kg)" : "Stock mínimo (unidades)"}
              error={err?.min_stock?.[0]}
              hint="Por debajo de esto aparece en el Inicio"
            >
              <Input name="min_stock" inputMode="decimal" defaultValue={String(p.min_stock)} />
            </Field>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                name="track_expiry"
                checked={trackExpiry}
                onChange={(e) => setTrackExpiry(e.target.checked)}
                className="mt-0.5 size-4 accent-[#7b4a17]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">Controlar vencimiento</span>
                <span className="text-[11.5px] leading-relaxed text-muted">
                  Activa el manejo por lotes y el aviso en el Inicio
                </span>
              </span>
            </label>

            {trackExpiry && (
              <Field
                label="Días de vida útil"
                error={err?.shelf_life_days?.[0]}
                hint="Desde que entra o se produce"
              >
                <Input
                  name="shelf_life_days"
                  inputMode="numeric"
                  defaultValue={p.shelf_life_days ?? ""}
                />
              </Field>
            )}
          </Card>

          {isEdit && (
            <Card className="flex flex-col gap-4 p-5">
              <p className="text-sm font-semibold">Estado</p>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={p.is_active}
                  className="mt-0.5 size-4 accent-[#7b4a17]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium">Producto activo</span>
                  <span className="text-[11.5px] leading-relaxed text-muted">
                    Si lo desactivás deja de aparecer en el mostrador. El PLU{" "}
                    {p.plu} queda reservado para siempre.
                  </span>
                </span>
              </label>

              <Field label="Motivo del cambio de precio" hint="Opcional, queda en el historial">
                <Input name="price_reason" placeholder="Aumento del proveedor" />
              </Field>
            </Card>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear producto"}
        </Button>
        <Link href="/productos">
          <Button type="button" variant="ghost">
            Cancelar
          </Button>
        </Link>
        {!isEdit && (
          <span className="text-xs text-faint">
            El PLU se asigna solo al crearlo.
          </span>
        )}
      </div>
    </form>
  );
}

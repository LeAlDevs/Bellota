"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/auth";
import { sugerirPlu } from "./actions";

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
  const [costo, setCosto] = useState(String(p.cost));
  const [plu, setPlu] = useState(p.plu != null ? String(p.plu) : "");
  const [sugiriendo, startSugerir] = useTransition();

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success("Producto guardado.");
  }, [state]);

  const priceNumber = Number(price.replace(/\./g, "").replace(",", "."));
  const costNumber = Number(costo.replace(/\./g, "").replace(",", "."));
  const margin =
    costNumber > 0 && priceNumber > 0
      ? ((priceNumber - costNumber) / priceNumber) * 100
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
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">Identificación</p>
              <p className="text-[12.5px] leading-relaxed text-muted">
                Un producto se identifica por su <strong>PLU</strong> si se pesa en
                la balanza, o por su <strong>código de barras</strong> si viene
                envasado de fábrica. Puede tener uno, el otro, o los dos.
              </p>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5">
              <Field
                label="PLU de balanza"
                error={err?.plu?.[0]}
                hint="El número que ya tiene cargado la balanza para este producto"
              >
                <Input
                  name="plu"
                  inputMode="numeric"
                  value={plu}
                  onChange={(e) => setPlu(e.target.value.replace(/\D/g, ""))}
                  placeholder="Vacío si no pasa por balanza"
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                disabled={sugiriendo}
                onClick={() =>
                  startSugerir(async () => {
                    const r = await sugerirPlu();
                    if (r.error) toast.error(r.error);
                    else if (r.plu) {
                      setPlu(String(r.plu));
                      toast.success(
                        `Te propongo el ${r.plu}. Cargalo con ese número en las cuatro balanzas.`
                      );
                    }
                  })
                }
              >
                <Sparkles className="size-4" strokeWidth={1.8} />
                Sugerir libre
              </Button>
            </div>

            {unitType === "kg" && plu.trim() === "" && (
              <p className="flex items-start gap-2.5 rounded-lg bg-warn-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                <span>
                  Este producto se pesa, así que casi seguro tiene un PLU en la
                  balanza. Sin él, el mostrador no va a poder leer su etiqueta:
                  hay que buscarlo por nombre y tipear el peso a mano.
                </span>
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Código de barras del fabricante"
                hint="El EAN que ya trae el paquete"
              >
                <Input name="barcode" defaultValue={p.barcode ?? ""} inputMode="numeric" />
              </Field>
              <Field label="SKU interno" hint="Opcional">
                <Input name="sku" defaultValue={p.sku ?? ""} />
              </Field>
            </div>

            {isEdit && p.plu != null && (
              <p className="text-[12px] leading-relaxed text-faint">
                Si cambiás el PLU, las etiquetas ya impresas con el {p.plu} van a
                escanear otra cosa. Cambialo solo si lo cargaste mal.
              </p>
            )}
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

            <Field
              label="Costo"
              error={err?.cost?.[0]}
              hint="Lo ponés vos. Al recibir una compra el sistema avisa si el proveedor facturó distinto, pero no lo cambia solo."
            >
              <Input
                name="cost"
                inputMode="decimal"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
              />
            </Field>

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
                  Al recibir mercadería de este producto se va a pedir la fecha, y
                  cada entrada va a quedar como un lote aparte
                </span>
              </span>
            </label>

            {trackExpiry && (
              <Field
                label="¿Cuántos días dura normalmente?"
                error={err?.shelf_life_days?.[0]}
                hint="Opcional. Solo sirve para proponerte la fecha al recibir; la que vale es la que ponés ahí."
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
                    Si lo desactivás deja de aparecer en el mostrador
                    {p.plu != null
                      ? `, pero el PLU ${p.plu} queda reservado: nunca se le da a otro producto.`
                      : "."}
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
            El PLU sale de la balanza. Si es un producto nuevo que todavía no
            está cargada, pedí uno libre.
          </span>
        )}
      </div>
    </form>
  );
}

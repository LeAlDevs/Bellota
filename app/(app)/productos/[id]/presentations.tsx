"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Field, Input } from "@/components/ui/form";
import { formatMoney, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Presentacion } from "@/components/ui/product-picker";
import {
  borrarPresentacion,
  guardarPresentacion,
  marcarPresentacionPrincipal,
} from "../actions";

type Props = {
  productId: string;
  unitType: "kg" | "unidad";
  presentaciones: Presentacion[];
  puedeEditar: boolean;
};

function Formulario({
  productId,
  unitType,
  actual,
  orden,
  onCerrar,
}: {
  productId: string;
  unitType: "kg" | "unidad";
  actual: Presentacion | null;
  orden: number;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [enviando, startEnviar] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 border-t border-line bg-subtle px-4 py-3.5"
      action={(fd) => {
        fd.set("sort_order", String(orden));
        startEnviar(async () => {
          const res = await guardarPresentacion(productId, actual?.id ?? null, {}, fd);
          if (res.fieldErrors) {
            setErrores(res.fieldErrors);
            return;
          }
          if (res.error) {
            toast.error(res.error);
            return;
          }
          toast.success(actual ? "Presentación actualizada." : "Presentación agregada.");
          setErrores({});
          onCerrar();
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Cómo se vende" error={errores.name?.[0]}>
          <Input
            name="name"
            defaultValue={actual?.name ?? ""}
            placeholder="Horma entera"
            required
          />
        </Field>

        <Field
          label={unitType === "kg" ? "Precio por kilo" : "Precio por unidad"}
          error={errores.price?.[0]}
        >
          <Input
            name="price"
            inputMode="decimal"
            defaultValue={actual ? String(actual.price) : ""}
            placeholder="22000"
            required
          />
        </Field>

        <Field
          label="PLU en la balanza"
          hint="El número que imprime esta etiqueta"
          error={errores.plu?.[0]}
        >
          <Input
            name="plu"
            inputMode="numeric"
            defaultValue={actual?.plu != null ? String(actual.plu) : ""}
            placeholder="—"
          />
        </Field>

        <Field
          label={unitType === "kg" ? "Mínimo en kg" : "Mínimo en unidades"}
          hint="Debajo de esto, el mostrador avisa"
          error={errores.min_qty?.[0]}
        >
          <Input
            name="min_qty"
            inputMode="decimal"
            defaultValue={actual?.min_qty != null ? String(actual.min_qty) : ""}
            placeholder="sin mínimo"
          />
        </Field>
      </div>

      {actual && (
        <Field label="Por qué cambia el precio" hint="Queda en el historial">
          <Input name="reason" placeholder="Aumento del proveedor" />
        </Field>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={enviando}>
          {actual ? "Guardar cambios" : "Agregar presentación"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCerrar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Las formas de vender un mismo producto.
 *
 * Existe porque el mismo queso vale distinto según cómo se lo lleven: la horma
 * entera es más barata por kilo que el fraccionado. No es un descuento por
 * cantidad —3 kg feteados no tienen ese precio— así que cada forma lleva su
 * propio PLU y la balanza imprime la etiqueta con el precio que corresponde.
 */
export function Presentaciones({
  productId,
  unitType,
  presentaciones,
  puedeEditar,
}: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [ocupado, startOcupado] = useTransition();

  const siguienteOrden = presentaciones.length;

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Formas de venderlo</span>
          <span className="text-[11.5px] text-muted">
            Cada una con su PLU y su precio. Todas descuentan del mismo stock.
          </span>
        </div>
        <span className="grow" />
        {puedeEditar && !agregando && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditando(null);
              setAgregando(true);
            }}
          >
            <Plus className="size-4" strokeWidth={1.8} />
            Agregar
          </Button>
        )}
      </div>

      {presentaciones.map((p) => (
        <div key={p.id}>
          <div className="flex items-center gap-3 border-t border-line/60 px-4 py-2.5 text-[13px]">
            <div className="tnum w-16 shrink-0 text-faint">{p.plu ?? "—"}</div>

            <div className="flex min-w-0 grow items-center gap-2">
              <span className="truncate font-medium">{p.name}</span>
              {p.is_default && <Badge tone="accent">Principal</Badge>}
              {p.min_qty != null && (
                <span className="shrink-0 text-[11.5px] text-faint">
                  desde {formatQty(p.min_qty, unitType)}
                </span>
              )}
            </div>

            <div className="tnum shrink-0 font-medium">
              {formatMoney(p.price)}
              <span className="text-[11.5px] text-faint">
                {unitType === "kg" ? " /kg" : " c/u"}
              </span>
            </div>

            {puedeEditar && (
              <div className="flex shrink-0 items-center gap-1">
                {!p.is_default && (
                  <button
                    type="button"
                    disabled={ocupado}
                    title="Marcar como principal: es la que se usa al buscar por nombre"
                    aria-label={`Marcar ${p.name} como principal`}
                    onClick={() =>
                      startOcupado(async () => {
                        const res = await marcarPresentacionPrincipal(productId, p.id);
                        if (res.error) {
                          toast.error(res.error);
                          return;
                        }
                        toast.success(`"${p.name}" es ahora la principal.`);
                        router.refresh();
                      })
                    }
                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-accent disabled:opacity-50"
                  >
                    <Star className="size-4" strokeWidth={1.8} />
                  </button>
                )}

                <button
                  type="button"
                  aria-label={`Editar ${p.name}`}
                  onClick={() => {
                    setAgregando(false);
                    setEditando(editando === p.id ? null : p.id);
                  }}
                  className={cn(
                    "rounded-lg p-1.5 transition-colors hover:bg-canvas",
                    editando === p.id ? "text-accent" : "text-muted"
                  )}
                >
                  {editando === p.id ? (
                    <X className="size-4" strokeWidth={1.8} />
                  ) : (
                    <Pencil className="size-4" strokeWidth={1.8} />
                  )}
                </button>

                {!p.is_default && (
                  <button
                    type="button"
                    disabled={ocupado}
                    aria-label={`Borrar ${p.name}`}
                    onClick={() => {
                      if (!confirm(`¿Borrar la presentación "${p.name}"?`)) return;
                      startOcupado(async () => {
                        const res = await borrarPresentacion(productId, p.id);
                        if (res.error) {
                          toast.error(res.error);
                          return;
                        }
                        toast.success(`"${p.name}" borrada.`);
                        router.refresh();
                      });
                    }}
                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger-bg hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-4" strokeWidth={1.8} />
                  </button>
                )}
              </div>
            )}
          </div>

          {editando === p.id && (
            <Formulario
              productId={productId}
              unitType={unitType}
              actual={p}
              orden={presentaciones.indexOf(p)}
              onCerrar={() => setEditando(null)}
            />
          )}
        </div>
      ))}

      {agregando && (
        <Formulario
          productId={productId}
          unitType={unitType}
          actual={null}
          orden={siguienteOrden}
          onCerrar={() => setAgregando(false)}
        />
      )}

      {presentaciones.length === 1 && !agregando && (
        <p className="border-t border-line/60 px-4 py-2.5 text-[12px] text-faint">
          Si este producto también se vende de otra forma —una horma entera, media
          horma— agregala acá: cada una necesita su propio PLU cargado en las
          balanzas.
        </p>
      )}
    </Card>
  );
}

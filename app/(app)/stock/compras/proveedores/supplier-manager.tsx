"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Textarea } from "@/components/ui/form";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/auth";
import { guardarProveedor } from "../actions";

export type Proveedor = {
  id: string;
  name: string;
  cuit: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  saldo: number;
  compras: number;
};

const initial: ActionState = {};

export function SupplierManager({
  proveedores,
  puedeEditar,
}: {
  proveedores: Proveedor[];
  puedeEditar: boolean;
}) {
  const [state, action, pending] = useActionState(guardarProveedor, initial);
  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) {
      toast.success("Proveedor guardado.");
      setEditando(null);
      setAbierto(false);
    }
  }, [state]);

  const mostrarForm = abierto || editando !== null;
  const err = state.fieldErrors;

  return (
    <div className="flex flex-col gap-3.5">
      {puedeEditar && !mostrarForm && (
        <div>
          <Button type="button" onClick={() => setAbierto(true)}>
            <Plus className="size-4" strokeWidth={2} />
            Nuevo proveedor
          </Button>
        </div>
      )}

      {mostrarForm && (
        <Card className="p-5">
          <form action={action} className="flex flex-col gap-4">
            <div className="flex items-center">
              <p className="text-sm font-semibold">
                {editando ? `Editar ${editando.name}` : "Nuevo proveedor"}
              </p>
              <span className="grow" />
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => {
                  setEditando(null);
                  setAbierto(false);
                }}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>

            <input type="hidden" name="id" value={editando?.id ?? ""} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nombre" error={err?.name?.[0]}>
                <Input
                  name="name"
                  defaultValue={editando?.name ?? ""}
                  autoFocus
                  placeholder="Frigorífico del Sur"
                />
              </Field>
              <Field label="CUIT" hint="Opcional">
                <Input name="cuit" defaultValue={editando?.cuit ?? ""} inputMode="numeric" />
              </Field>
              <Field label="Teléfono" hint="Opcional">
                <Input name="phone" defaultValue={editando?.phone ?? ""} />
              </Field>
              <Field label="Correo" hint="Opcional">
                <Input name="email" defaultValue={editando?.email ?? ""} type="email" />
              </Field>
            </div>

            <Field label="Notas" hint="Días de reparto, contacto, lo que sirva">
              <Textarea name="notes" defaultValue={editando?.notes ?? ""} />
            </Field>

            <div>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Guardar proveedor"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="flex flex-col overflow-hidden">
        {proveedores.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            Todavía no hay proveedores cargados.
          </p>
        ) : (
          proveedores.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 border-b border-line/60 px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13.5px] font-medium">{p.name}</span>
                <span className="truncate text-[11.5px] text-muted">
                  {[p.cuit, p.phone, p.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                </span>
              </div>

              <span className="grow" />

              <div className="flex flex-col items-end gap-0.5">
                <span
                  className={cn(
                    "num text-[13.5px]",
                    p.saldo > 0 ? "text-warn" : "text-muted"
                  )}
                >
                  {p.saldo > 0 ? formatMoney(p.saldo) : "Sin deuda"}
                </span>
                <span className="text-[11px] text-faint">
                  {p.compras === 0
                    ? "sin compras"
                    : `${p.compras} ${p.compras === 1 ? "compra" : "compras"}`}
                </span>
              </div>

              {puedeEditar && (
                <button
                  type="button"
                  aria-label={`Editar ${p.name}`}
                  onClick={() => {
                    setEditando(p);
                    setAbierto(false);
                  }}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-canvas hover:text-ink"
                >
                  <Pencil className="size-[15px]" strokeWidth={1.8} />
                </button>
              )}
            </div>
          ))
        )}
      </Card>

      {proveedores.some((p) => p.saldo > 0) && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          El saldo es lo que le debés a cada proveedor por compras a cuenta
          corriente. Los pagos se cargan desde <strong>Pagos y gastos</strong>.
        </p>
      )}
    </div>
  );
}

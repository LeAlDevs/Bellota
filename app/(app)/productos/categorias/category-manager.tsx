"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Input } from "@/components/ui/form";
import type { ActionState } from "@/lib/auth";
import { borrarCategoria, guardarCategoria } from "./actions";

export type Categoria = { id: string; name: string; productos: number };

const initial: ActionState = {};

export function CategoryManager({
  categorias,
  puedeEditar,
}: {
  categorias: Categoria[];
  puedeEditar: boolean;
}) {
  const [state, action, pending] = useActionState(guardarCategoria, initial);
  const [editando, setEditando] = useState<string | null>(null);
  const [borrando, startBorrar] = useTransition();

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) {
      toast.success("Categoría guardada.");
      setEditando(null);
    }
  }, [state]);

  function borrar(c: Categoria) {
    const aviso =
      c.productos > 0
        ? `"${c.name}" tiene ${c.productos} producto${c.productos === 1 ? "" : "s"}. Se van a quedar sin categoría, no se borran. ¿Sigo?`
        : `¿Borro la categoría "${c.name}"?`;
    if (!confirm(aviso)) return;

    startBorrar(async () => {
      const res = await borrarCategoria(c.id);
      if (res.error) toast.error(res.error);
      else toast.success("Categoría borrada.");
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3.5">
      {puedeEditar && (
        <Card className="p-4">
          <form action={action} className="flex items-start gap-2.5">
            <input type="hidden" name="id" value="" />
            <div className="flex grow flex-col gap-1.5">
              <Input name="name" placeholder="Nombre de la categoría nueva" />
              {state.fieldErrors?.name && (
                <span className="text-xs text-danger">{state.fieldErrors.name[0]}</span>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              <Plus className="size-4" strokeWidth={2} />
              Agregar
            </Button>
          </form>
        </Card>
      )}

      <Card className="flex flex-col overflow-hidden">
        {categorias.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            Todavía no hay categorías.
          </p>
        ) : (
          categorias.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-b-0"
            >
              {editando === c.id ? (
                <form action={action} className="flex grow items-center gap-2.5">
                  <input type="hidden" name="id" value={c.id} />
                  <Input
                    name="name"
                    defaultValue={c.name}
                    autoFocus
                    className="h-9 grow"
                  />
                  <button
                    type="submit"
                    disabled={pending}
                    aria-label="Guardar"
                    className="flex size-9 items-center justify-center rounded-lg text-ok transition-colors hover:bg-ok-bg"
                  >
                    <Check className="size-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditando(null)}
                    aria-label="Cancelar"
                    className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-canvas"
                  >
                    <X className="size-4" strokeWidth={2} />
                  </button>
                </form>
              ) : (
                <>
                  <span className="grow text-[13px] font-medium">{c.name}</span>
                  <span className="tnum text-[12px] text-faint">
                    {c.productos} {c.productos === 1 ? "producto" : "productos"}
                  </span>
                  {puedeEditar && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditando(c.id)}
                        aria-label={`Renombrar ${c.name}`}
                        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-canvas hover:text-ink"
                      >
                        <Pencil className="size-[15px]" strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={() => borrar(c)}
                        disabled={borrando}
                        aria-label={`Borrar ${c.name}`}
                        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-bg hover:text-danger"
                      >
                        <Trash2 className="size-[15px]" strokeWidth={1.8} />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

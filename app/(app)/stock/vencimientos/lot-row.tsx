"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatKg, formatMoney, formatNumber } from "@/lib/format";
import { darDeBajaLote } from "./actions";

export function BotonDarDeBaja({
  lotId,
  producto,
  cantidad,
  unitType,
  perdida,
}: {
  lotId: string;
  producto: string;
  cantidad: number;
  unitType: "kg" | "unidad";
  perdida: number;
}) {
  const router = useRouter();
  const [enviando, startEnviar] = useTransition();

  const cant = unitType === "kg" ? `${formatKg(cantidad)} kg` : formatNumber(cantidad);

  return (
    <button
      type="button"
      disabled={enviando}
      aria-label={`Dar de baja ${producto}`}
      title="Dar de baja: sale como merma con motivo vencido"
      onClick={() => {
        const ok = confirm(
          `Vas a dar de baja ${cant} de ${producto}.\n\nSale como merma con motivo "vencido" y son ${formatMoney(perdida)} de pérdida. ¿Confirmás?`
        );
        if (!ok) return;
        startEnviar(async () => {
          const res = await darDeBajaLote(lotId);
          if (res.error) {
            toast.error(res.error);
            return;
          }
          toast.success(`${cant} de ${producto} dados de baja.`);
          router.refresh();
        });
      }}
      className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger-bg hover:text-danger disabled:opacity-50"
    >
      <Trash2 className="size-4" strokeWidth={1.8} />
    </button>
  );
}

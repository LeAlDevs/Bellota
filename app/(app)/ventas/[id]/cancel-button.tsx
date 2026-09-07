"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/form";
import { formatMoney } from "@/lib/format";
import { anularVenta } from "../actions";

/**
 * Anular es entero y no se deshace: repone TODO el stock y saca TODA la plata.
 * Por eso pide motivo y confirmación, y por eso está solo para el admin.
 * Para devolver una parte está la devolución, que es otra cosa.
 */
export function BotonAnular({
  saleId,
  numero,
  total,
}: {
  saleId: string;
  numero: number;
  total: number;
}) {
  const router = useRouter();
  const [enviando, startEnviar] = useTransition();

  return (
    <Button
      type="button"
      variant="danger"
      disabled={enviando}
      onClick={() => {
        const motivo = prompt(
          `Vas a ANULAR el ticket #${numero} por ${formatMoney(total)}.\n\n` +
            "Vuelve todo el stock y sale toda la plata de la caja del turno. No se puede deshacer.\n\n" +
            "¿Por qué la anulás?"
        );
        if (motivo === null) return;

        startEnviar(async () => {
          const res = await anularVenta(saleId, motivo);
          if (res.error) {
            toast.error(res.error);
            return;
          }
          toast.success(`Ticket #${numero} anulado.`);
          router.refresh();
        });
      }}
    >
      <Ban className="size-4" strokeWidth={1.8} />
      Anular venta
    </Button>
  );
}

import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Devoluciones"
      description="Devolver mercadería y plata."
      phase={5}
      items={[
        "Repone el stock y devuelve el efectivo de la caja del turno",
        "Sin cuenta corriente no hay saldo a favor: se devuelve o no se devuelve",
      ]}
    />
  );
}

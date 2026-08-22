import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Transferencias"
      description="Mercadería que pasa de un local al otro."
      phase={2}
      items={[
        "Valida el stock en origen antes de mover nada",
        "Deja los dos movimientos en una sola transacción",
      ]}
    />
  );
}

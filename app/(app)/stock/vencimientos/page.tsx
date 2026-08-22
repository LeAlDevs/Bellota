import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Vencimientos"
      description="Lotes que están por vencer."
      phase={8}
      items={[
        "Lotes opcionales, solo en los productos que lo necesitan",
        "Sin FEFO obligatorio en el mostrador: es inusable con fila",
        "Baja de lo vencido con un clic, que va derecho a merma",
      ]}
    />
  );
}

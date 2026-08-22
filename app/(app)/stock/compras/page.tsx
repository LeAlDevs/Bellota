import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Compras"
      description="Recepción de mercadería y costo."
      phase={3}
      items={[
        "Recepción por peso real: se piden 10 kg, llegan 9,8 y manda lo que llegó",
        "Una compra se reparte entre los dos locales por línea, no por documento",
        "Al confirmar recalcula el costo promedio ponderado sobre el total recibido",
        "Si es a cuenta corriente, genera la deuda con el proveedor",
      ]}
    />
  );
}

import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Stock"
      description="Existencias por local, a costo promedio ponderado."
      phase={2}
      items={[
        "Existencias por local, con decimales de verdad (numeric 12,3)",
        "Stock valorizado y productos bajo el mínimo",
        "Ficha de producto con su historial de movimientos",
      ]}
    />
  );
}

import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Pagos y gastos"
      description="En qué se va la plata del local."
      phase={6}
      items={[
        "Cada gasto sale de la caja o del banco, y lo dice",
        "Los de caja exigen turno abierto y descuentan del arqueo",
        "Comprobante adjunto y categoría",
        "Gastos recurrentes precargados, para que no se olvide el alquiler",
      ]}
    />
  );
}

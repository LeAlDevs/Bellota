import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Balanzas y código de barras"
      description="Las cuatro Systel Cuora."
      phase={9}
      items={[
        "Formato del EAN-13 configurable: posiciones y largo de cada tramo",
        "Prefijo 20 pesable, 21 por unidad, con el peso embebido y no el importe",
        "Exportación del catálogo en el formato que consume Qendra",
      ]}
    />
  );
}

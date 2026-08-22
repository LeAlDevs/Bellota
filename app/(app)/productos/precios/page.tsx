import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Precios y cartelería"
      description="Un solo lugar donde se carga el precio."
      phase={8}
      items={[
        "Recálculo masivo por porcentaje, categoría o proveedor",
        "Historial de quién cambió qué precio y cuándo",
        "Cartelería de góndola imprimible",
        "Exportación del catálogo a las cuatro balanzas",
      ]}
    />
  );
}

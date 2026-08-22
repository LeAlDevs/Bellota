import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Productos"
      description="El catálogo: PLU, precio y costo."
      phase={1}
      items={[
        "Tipo kg o unidad: la decisión que atraviesa todo el sistema",
        "PLU asignado por Bellota, único y estable, nunca reutilizado",
        "Costo promedio ponderado calculado, no editable a mano",
        "Stock mínimo para la alerta de reposición",
      ]}
    />
  );
}

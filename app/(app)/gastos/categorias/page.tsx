import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Categorías de gasto"
      description="Cómo se agrupan los gastos."
      phase={6}
      items={[
        "Alquiler, servicios, sueldos, fletes, limpieza, mantenimiento, impuestos, insumos",
        "Editables: el reporte por categoría vale lo que valga esta lista",
      ]}
    />
  );
}

import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Categorías"
      description="Cómo se agrupa el catálogo."
      phase={1}
      items={[
        "Fiambres, quesos, elaborados, envasados, bebidas",
        "Se usan en el punto de venta y en los reportes por categoría",
      ]}
    />
  );
}

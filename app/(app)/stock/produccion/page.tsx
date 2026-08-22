import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Producción"
      description="Despiece y elaborados."
      phase={7}
      items={[
        "Despiece: una pieza entra, salen fetas, puntas y merma",
        "Elaborados: picadas y bandejas, con su propio stock y vencimiento",
        "Costo repartido por peso y editable: la merma encarece lo que sí se vende",
        "Rinde real contra esperado, por orden y por empleado",
      ]}
    />
  );
}

import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Reportes"
      description="Qué se vende y cuánto deja."
      phase={5}
      items={[
        "Kilos vendidos por producto y por categoría",
        "Margen por producto, con el costo del momento de cada venta",
        "Merma por producto y por motivo",
        "Rinde real contra esperado en los despieces",
        "Ventas por hora, comparativa entre locales y resultado del local",
      ]}
    />
  );
}

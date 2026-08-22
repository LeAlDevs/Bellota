import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Pagos a proveedores"
      description="Lo que se le debe a cada uno."
      phase={6}
      items={[
        "La compra a cuenta corriente suma deuda, el pago la baja",
        "Imputación del pago a las compras que cancela",
      ]}
    />
  );
}

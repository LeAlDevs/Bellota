import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Medios de pago"
      description="Efectivo, débito, crédito, QR, transferencia."
      phase={4}
      items={[
        "Recargo por medio de pago",
        "Marca de si afecta la caja: el efectivo sí, la tarjeta no",
      ]}
    />
  );
}

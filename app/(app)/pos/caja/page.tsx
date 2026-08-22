import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Caja del turno"
      description="Apertura, arqueo y cierre del cajón."
      phase={4}
      items={[
        "Apertura con fondo declarado",
        "Esperado = fondo + ventas en efectivo − devoluciones − gastos de caja − retiros",
        "Cierre con declarado contra esperado, y la diferencia a la vista",
      ]}
    />
  );
}

import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Panel de ventas"
      description="Las ventas de los dos locales."
      phase={5}
      items={[
        "Historial con filtros por local, fecha, cajero y medio de pago",
        "Detalle de cada venta con sus líneas y sus pagos",
        "Anulación (solo administrador), que repone el stock",
        "Selector Todo / Solo fiscal, con Todo por defecto",
      ]}
    />
  );
}

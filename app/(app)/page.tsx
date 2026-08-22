import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Inicio"
      description="Cómo viene el día en Ramos y en Mosconi."
      phase={0}
      items={[
        "Ventas de hoy por local, con la variación contra ayer",
        "Ticket promedio, margen del día y merma de la semana",
        "Ventas por hora, comparadas contra el mismo día de la semana pasada",
        "Artículos bajo el mínimo y próximos vencimientos, por local",
        "Aviso de cajas sin cerrar",
      ]}
    />
  );
}

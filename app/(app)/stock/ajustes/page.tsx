import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Ajustes y merma"
      description="Lo que se pierde, con nombre y apellido."
      phase={2}
      items={[
        "Motivo obligatorio: vencido, roto, mal estado, degustación, error de carga, robo",
        "Guarda el costo del momento, así el reporte dice cuánta plata se perdió",
      ]}
    />
  );
}

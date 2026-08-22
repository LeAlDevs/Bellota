import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Importar desde Excel"
      description="La carga inicial del catálogo."
      phase={1}
      items={[
        "Plantilla descargable con Nombre, PLU, Tipo, Costo, Precio, stock por local",
        "Vista previa antes de confirmar: qué crea, qué actualiza, qué está mal",
        "Idempotente por PLU: se puede volver a correr sin duplicar nada",
      ]}
    />
  );
}

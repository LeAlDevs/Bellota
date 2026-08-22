import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Historial de arqueos"
      description="Todos los cierres, con sus diferencias."
      phase={4}
      items={[
        "Cierres por local y por cajero",
        "Diferencias acumuladas, para detectar un problema antes de que sea grande",
      ]}
    />
  );
}

import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Movimientos de stock"
      description="Todo lo que entró y salió, y por qué."
      phase={2}
      items={[
        "Cada movimiento con su motivo, su documento de origen y su usuario",
        "Ningún camino escribe el stock directo: todo pasa por adjust_stock()",
      ]}
    />
  );
}

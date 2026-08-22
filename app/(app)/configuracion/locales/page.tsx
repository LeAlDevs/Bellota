import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Locales"
      description="Ramos y Mosconi."
      phase={0}
      items={[
        "Nombre, correo del local y si tiene punto de venta",
        "Un depósito central futuro entra acá con el punto de venta apagado",
      ]}
    />
  );
}

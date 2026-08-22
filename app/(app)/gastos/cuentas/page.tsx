import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Cuentas y saldos"
      description="Caja de cada local, banco y billeteras."
      phase={6}
      items={[
        "Caja Ramos, Caja Mosconi, banco y billeteras virtuales",
        "La caja es del local; el banco es de la empresa",
      ]}
    />
  );
}

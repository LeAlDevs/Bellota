import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Usuarios y roles"
      description="Quién puede hacer qué."
      phase={0}
      items={[
        "Permisos por módulo, no por nombre de rol",
        "Cada usuario con su local asignado: ve los dos, opera el suyo",
        "Las acciones destructivas quedan reservadas al administrador",
      ]}
    />
  );
}

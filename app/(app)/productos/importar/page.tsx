import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/form";
import { Importer, type Existente, type Store } from "./importer";

export default async function ImportarPage() {
  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);

  const [{ data: stores }, { data: productos }] = await Promise.all([
    sb.from("stores").select("id, name").eq("active", true).order("name"),
    // Para la vista previa: saber qué fila crea y qué fila actualiza.
    sb.from("products").select("id, plu, name"),
  ]);

  const existentes: Existente[] = (productos ?? []).map((p) => ({
    id: p.id,
    plu: p.plu,
    nombre: p.name,
  }));

  return (
    <>
      <PageHeader
        title="Importar productos"
        subtitle="Carga inicial del catálogo y altas masivas, desde Excel o CSV."
      />
      <Importer
        stores={(stores ?? []) as Store[]}
        existentes={existentes}
        puedeEditar={canEdit(perms, "productos")}
      />
    </>
  );
}

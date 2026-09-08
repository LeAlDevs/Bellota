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
    // El PLU vive en las presentaciones: la planilla puede matchear tanto el
    // fraccionado como la horma, así que se miran todas.
    sb
      .from("products")
      .select("id, barcode, name, product_presentations(plu, is_default)"),
  ]);

  const existentes: Existente[] = (productos ?? []).flatMap<Existente>((p) => {
    const pres = (p.product_presentations ?? []) as {
      plu: number | null;
      is_default: boolean;
    }[];
    const plus = pres.map((x) => x.plu).filter((x): x is number => x !== null);
    if (plus.length === 0) {
      return [{ id: p.id, plu: null, barcode: p.barcode, nombre: p.name }];
    }
    return plus.map((plu) => ({
      id: p.id,
      plu,
      barcode: p.barcode,
      nombre: p.name,
    }));
  });

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

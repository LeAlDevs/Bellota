import { redirect } from "next/navigation";
import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/form";
import { ProductForm } from "../product-form";
import { crearProducto } from "../actions";

export default async function NuevoProductoPage() {
  const perms = await getPermissions();
  if (!canEdit(perms, "productos")) redirect("/productos");

  const sb = await createClient();
  const { data: categories } = await sb
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <>
      <PageHeader
        title="Nuevo producto"
        subtitle="El PLU se asigna solo y no se reutiliza nunca."
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <ProductForm action={crearProducto} categories={categories ?? []} />
      </div>
    </>
  );
}

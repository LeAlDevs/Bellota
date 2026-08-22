import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/form";
import { CategoryManager, type Categoria } from "./category-manager";

export default async function CategoriasPage() {
  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);

  const { data } = await sb
    .from("categories")
    .select("id, name, products(count)")
    .order("name")
    .returns<{ id: string; name: string; products: { count: number }[] }[]>();

  const categorias: Categoria[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    productos: c.products?.[0]?.count ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Categorías"
        subtitle="Se usan en el mostrador y en los reportes por categoría."
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <CategoryManager
          categorias={categorias}
          puedeEditar={canEdit(perms, "productos")}
        />
      </div>
    </>
  );
}

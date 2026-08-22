import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatKg, formatMoney, formatNumber } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  plu: number | null;
  unit_type: "kg" | "unidad";
  kind: "simple" | "elaborado" | "combo";
  price: number;
  cost: number;
  min_stock: number;
  is_active: boolean;
  categories: { name: string } | null;
  stock: { qty: number }[] | null;
};

const COLS =
  "grid-cols-[64px_minmax(0,1fr)_74px_120px_112px_112px_64px_96px]";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; estado?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const cat = sp.cat ?? "";
  const estado = sp.estado ?? "activos";

  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);
  const puedeEditar = canEdit(perms, "productos");

  const { data: categories } = await sb
    .from("categories")
    .select("id, name")
    .order("name");

  let query = sb
    .from("products")
    .select(
      "id, name, plu, unit_type, kind, price, cost, min_stock, is_active, categories(name), stock(qty)"
    )
    .order("name");

  if (estado === "activos") query = query.eq("is_active", true);
  if (estado === "inactivos") query = query.eq("is_active", false);
  if (cat) query = query.eq("category_id", cat);

  if (q) {
    // Buscar por nombre o por PLU. En el mostrador se tipea el número.
    const asPlu = Number(q);
    query = Number.isInteger(asPlu)
      ? query.or(`name.ilike.%${q}%,plu.eq.${asPlu}`)
      : query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query.returns<Row[]>();
  const rows = data ?? [];

  const totalStock = (r: Row) =>
    (r.stock ?? []).reduce((acc, s) => acc + Number(s.qty), 0);

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle={
          error
            ? "No pude leer el catálogo."
            : `${formatNumber(rows.length)} ${rows.length === 1 ? "producto" : "productos"}`
        }
      >
        {puedeEditar && (
          <Link href="/productos/nuevo">
            <Button>
              <Plus className="size-4" strokeWidth={2} />
              Nuevo producto
            </Button>
          </Link>
        )}
      </PageHeader>

      <form className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-10 w-full max-w-96 items-center gap-2.5 rounded-lg border border-line-strong bg-card px-3.5">
          <Search className="size-4 shrink-0 text-faint" strokeWidth={1.7} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre o PLU"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>

        <select
          name="cat"
          defaultValue={cat}
          className="h-10 rounded-lg border border-line-strong bg-card px-3 pr-8 text-[13px] outline-none"
        >
          <option value="">Todas las categorías</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          name="estado"
          defaultValue={estado}
          className="h-10 rounded-lg border border-line-strong bg-card px-3 pr-8 text-[13px] outline-none"
        >
          <option value="activos">Solo activos</option>
          <option value="inactivos">Solo dados de baja</option>
          <option value="todos">Todos</option>
        </select>

        <Button type="submit" variant="ghost">
          Filtrar
        </Button>
      </form>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer el catálogo"
            description={`La base devolvió: ${error.message}. Si todavía no corriste la migración 0003_productos.sql, es eso.`}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={q || cat ? "Ningún producto coincide" : "Todavía no hay productos"}
            description={
              q || cat
                ? "Probá con otro nombre, otro PLU o sacando los filtros."
                : "Podés cargarlos de a uno o traer todo el catálogo de una desde un Excel."
            }
          >
            {puedeEditar && !q && !cat && (
              <div className="flex gap-2.5">
                <Link href="/productos/nuevo">
                  <Button>Cargar el primero</Button>
                </Link>
                <Link href="/productos/importar">
                  <Button variant="ghost">Importar desde Excel</Button>
                </Link>
              </div>
            )}
          </EmptyState>
        ) : (
          <>
            <div
              className={cn(
                "grid shrink-0 gap-0 border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint",
                COLS
              )}
            >
              <div>PLU</div>
              <div>Producto</div>
              <div>Tipo</div>
              <div>Categoría</div>
              <div className="text-right">Precio</div>
              <div className="text-right">Costo</div>
              <div className="text-right">Margen</div>
              <div className="text-right">Stock</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((r) => {
                const margen =
                  Number(r.price) > 0
                    ? ((Number(r.price) - Number(r.cost)) / Number(r.price)) * 100
                    : null;
                const stock = totalStock(r);
                const bajo = stock < Number(r.min_stock);

                return (
                  <Link
                    key={r.id}
                    href={`/productos/${r.id}`}
                    className={cn(
                      "grid items-center gap-0 border-b border-line/60 px-4 py-2.5 text-[13px] transition-colors hover:bg-subtle",
                      COLS,
                      !r.is_active && "opacity-55"
                    )}
                  >
                    {/* Un producto que se pesa sin PLU no se puede escanear:
                        hay que buscarlo por nombre y tipear el peso. Se marca. */}
                    <div
                      className={cn(
                        "tnum",
                        r.plu != null
                          ? "text-faint"
                          : r.unit_type === "kg"
                            ? "font-semibold text-warn"
                            : "text-faint"
                      )}
                      title={
                        r.plu == null && r.unit_type === "kg"
                          ? "Se pesa pero no tiene PLU: el mostrador no puede leer su etiqueta"
                          : undefined
                      }
                    >
                      {r.plu ?? (r.unit_type === "kg" ? "falta" : "—")}
                    </div>

                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{r.name}</span>
                      {r.kind === "elaborado" && <Badge tone="accent">Elaborado</Badge>}
                      {r.kind === "combo" && <Badge tone="accent">Combo</Badge>}
                      {!r.is_active && <Badge>De baja</Badge>}
                    </div>

                    <div className="text-muted">
                      {r.unit_type === "kg" ? "por kg" : "unidad"}
                    </div>

                    <div className="truncate text-muted">
                      {r.categories?.name ?? "—"}
                    </div>

                    <div className="tnum text-right font-medium">
                      {formatMoney(r.price)}
                    </div>

                    <div className="tnum text-right text-muted">
                      {Number(r.cost) > 0 ? formatMoney(r.cost) : "—"}
                    </div>

                    <div
                      className={cn(
                        "tnum text-right font-semibold",
                        margen === null
                          ? "text-faint"
                          : margen >= 25
                            ? "text-ok"
                            : margen >= 15
                              ? "text-warn"
                              : "text-danger"
                      )}
                    >
                      {margen === null ? "—" : `${margen.toFixed(0)}%`}
                    </div>

                    <div
                      className={cn(
                        "tnum text-right",
                        bajo ? "font-semibold text-danger" : "text-muted"
                      )}
                    >
                      {r.unit_type === "kg" ? formatKg(stock) : formatNumber(stock)}
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

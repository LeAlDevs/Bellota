import Link from "next/link";
import { ArrowLeftRight, Search, SlidersHorizontal } from "lucide-react";
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
  cost: number;
  min_stock: number;
  categories: { name: string } | null;
  stock: { qty: number; store_id: string }[] | null;
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; bajo?: string; local?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const cat = sp.cat ?? "";
  const soloBajo = sp.bajo === "1";

  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);
  const puedeEditar = canEdit(perms, "stock");

  const [{ data: stores }, { data: categories }] = await Promise.all([
    sb.from("stores").select("id, name").eq("active", true).order("name"),
    sb.from("categories").select("id, name").order("name"),
  ]);
  const locales = stores ?? [];

  let query = sb
    .from("products")
    .select(
      "id, name, plu, unit_type, cost, min_stock, categories(name), stock(qty, store_id)"
    )
    .eq("is_active", true)
    .order("name");

  if (cat) query = query.eq("category_id", cat);
  if (q) {
    const asPlu = Number(q);
    query = Number.isInteger(asPlu)
      ? query.or(`name.ilike.%${q}%,plu.eq.${asPlu}`)
      : query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query.returns<Row[]>();

  const filas = (data ?? [])
    .map((r) => {
      const porLocal = new Map<string, number>(
        (r.stock ?? []).map((s) => [s.store_id, Number(s.qty)])
      );
      const total = [...porLocal.values()].reduce((a, b) => a + b, 0);
      return {
        ...r,
        porLocal,
        total,
        valorizado: total * Number(r.cost),
        bajo: total < Number(r.min_stock),
      };
    })
    .filter((r) => !soloBajo || r.bajo);

  const totalValorizado = filas.reduce((a, r) => a + r.valorizado, 0);
  const totalKg = filas
    .filter((r) => r.unit_type === "kg")
    .reduce((a, r) => a + r.total, 0);
  const bajoMinimo = filas.filter((r) => r.bajo).length;

  const fmt = (n: number, t: "kg" | "unidad") =>
    t === "kg" ? formatKg(n) : formatNumber(n);

  const gridCols = {
    gridTemplateColumns: `64px minmax(0,1fr) 120px ${locales
      .map(() => "104px")
      .join(" ")} 104px 116px`,
  };

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={
          error
            ? "No pude leer las existencias."
            : `${formatNumber(filas.length)} productos activos en los dos locales`
        }
      >
        {puedeEditar && (
          <div className="flex items-center gap-2.5">
            <Link href="/stock/ajustes">
              <Button variant="ghost">
                <SlidersHorizontal className="size-4" strokeWidth={1.8} />
                Ajuste / merma
              </Button>
            </Link>
            <Link href="/stock/transferencias">
              <Button variant="ghost">
                <ArrowLeftRight className="size-4" strokeWidth={1.8} />
                Transferir
              </Button>
            </Link>
          </div>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[11.5px] text-muted">Stock valorizado</span>
          <span className="num text-[26px] leading-none">{formatMoney(totalValorizado)}</span>
          <span className="text-[11.5px] text-faint">a costo promedio ponderado</span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[11.5px] text-muted">Kilos en góndola</span>
          <span className="num text-[26px] leading-none">{formatKg(totalKg)} kg</span>
          <span className="text-[11.5px] text-faint">
            {locales
              .map(
                (s) =>
                  `${s.name} ${formatKg(
                    filas
                      .filter((r) => r.unit_type === "kg")
                      .reduce((a, r) => a + (r.porLocal.get(s.id) ?? 0), 0)
                  )}`
              )
              .join(" · ")}
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[11.5px] text-muted">Bajo mínimo</span>
          <span
            className={cn(
              "num text-[26px] leading-none",
              bajoMinimo > 0 && "text-danger"
            )}
          >
            {formatNumber(bajoMinimo)}
          </span>
          <span className="text-[11.5px] text-faint">
            {bajoMinimo === 0 ? "nada para reponer" : "productos para reponer"}
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[11.5px] text-muted">Movimientos</span>
          <Link
            href="/stock/movimientos"
            className="text-[15px] font-medium text-accent hover:text-accent-hover"
          >
            Ver el historial
          </Link>
          <span className="text-[11.5px] text-faint">
            todo lo que entró y salió, con su motivo
          </span>
        </Card>
      </div>

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
        <label
          className={cn(
            "flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-[13px] transition-colors",
            soloBajo
              ? "border-accent-soft bg-accent-soft font-medium text-accent-hover"
              : "border-line-strong bg-card"
          )}
        >
          <input
            type="checkbox"
            name="bajo"
            value="1"
            defaultChecked={soloBajo}
            className="size-4 accent-[#7b4a17]"
          />
          Solo bajo mínimo
        </label>
        <Button type="submit" variant="ghost">
          Filtrar
        </Button>
      </form>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer las existencias"
            description={`La base devolvió: ${error.message}. Si todavía no corriste las migraciones de Stock, es eso.`}
          />
        ) : filas.length === 0 ? (
          <EmptyState
            title={soloBajo ? "Nada bajo el mínimo" : "Sin productos que mostrar"}
            description={
              soloBajo
                ? "Todos los productos están por encima de su stock mínimo."
                : "Cargá el catálogo desde Productos y después vas a ver acá las existencias."
            }
          />
        ) : (
          <>
            <div
              style={gridCols}
              className="grid shrink-0 border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint"
            >
              <div>PLU</div>
              <div>Producto</div>
              <div>Categoría</div>
              {locales.map((s) => (
                <div key={s.id} className="text-right">
                  {s.name}
                </div>
              ))}
              <div className="text-right">Total</div>
              <div className="text-right">Valorizado</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {filas.map((r) => (
                <Link
                  key={r.id}
                  href={`/stock/movimientos?producto=${r.id}`}
                  style={gridCols}
                  className={cn(
                    "grid items-center border-b border-line/60 px-4 py-2.5 text-[13px] transition-colors hover:bg-subtle",
                    r.bajo && "bg-danger-bg/35"
                  )}
                >
                  <div className="tnum text-faint">{r.plu ?? "—"}</div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    {r.bajo && <Badge tone="danger">Bajo mínimo</Badge>}
                  </div>
                  <div className="truncate text-muted">{r.categories?.name ?? "—"}</div>
                  {locales.map((s) => {
                    const v = r.porLocal.get(s.id) ?? 0;
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "tnum text-right",
                          v <= 0 ? "text-faint" : "text-muted"
                        )}
                      >
                        {fmt(v, r.unit_type)}
                      </div>
                    );
                  })}
                  <div className="tnum text-right font-medium">
                    {fmt(r.total, r.unit_type)}
                  </div>
                  <div className="tnum text-right text-muted">
                    {formatMoney(r.valorizado)}
                  </div>
                </Link>
              ))}
            </div>

            <div
              style={gridCols}
              className="grid shrink-0 border-t border-line bg-subtle px-4 py-2.5 text-[12.5px] font-semibold"
            >
              <div />
              <div>Total {formatNumber(filas.length)} productos</div>
              <div />
              {locales.map((s) => (
                <div key={s.id} className="tnum text-right">
                  {formatKg(
                    filas
                      .filter((r) => r.unit_type === "kg")
                      .reduce((a, r) => a + (r.porLocal.get(s.id) ?? 0), 0)
                  )}
                </div>
              ))}
              <div className="tnum text-right">{formatKg(totalKg)}</div>
              <div className="tnum text-right">{formatMoney(totalValorizado)}</div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

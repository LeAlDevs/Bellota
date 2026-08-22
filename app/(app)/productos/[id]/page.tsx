import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatKg, formatMoney, formatNumber } from "@/lib/format";
import { Badge, Card, PageHeader } from "@/components/ui/form";
import { ProductForm, type ProductFormValues } from "../product-form";
import { editarProducto } from "../actions";

type Producto = ProductFormValues & {
  id: string;
  plu: number;
  stock: { qty: number; store_id: string }[] | null;
};

export default async function ProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ alta?: string }>;
}) {
  const { id } = await params;
  const { alta } = await searchParams;

  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);
  const puedeEditar = canEdit(perms, "productos");

  const [{ data: producto }, { data: categories }, { data: stores }, { data: precios }] =
    await Promise.all([
      sb
        .from("products")
        .select(
          "id, plu, name, description, category_id, unit_type, kind, price, cost, min_stock, track_expiry, shelf_life_days, barcode, sku, is_active, stock(qty, store_id)"
        )
        .eq("id", id)
        .maybeSingle<Producto>(),
      sb.from("categories").select("id, name").order("name"),
      sb.from("stores").select("id, name").eq("active", true).order("name"),
      sb
        .from("price_history")
        .select("old_price, new_price, reason, created_at")
        .eq("product_id", id)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  if (!producto) notFound();

  const stockPorLocal = new Map(
    (producto.stock ?? []).map((s) => [s.store_id, Number(s.qty)])
  );
  const totalStock = [...stockPorLocal.values()].reduce((a, b) => a + b, 0);

  const fmtQty = (n: number) =>
    producto.unit_type === "kg" ? formatKg(n) + " kg" : formatNumber(n);

  return (
    <>
      <PageHeader title={producto.name} subtitle={`PLU ${producto.plu}`}>
        <div className="flex items-center gap-2.5">
          {!producto.is_active && <Badge>De baja</Badge>}
          <Link
            href="/productos"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-card px-4 text-[13px] font-medium transition-colors hover:bg-canvas"
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
            Volver
          </Link>
        </div>
      </PageHeader>

      {alta === "1" && (
        <div className="flex items-center gap-3 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3">
          <CheckCircle2 className="size-[18px] shrink-0 text-ok" strokeWidth={1.8} />
          <p className="text-[13px] leading-relaxed text-ok">
            Producto creado. Le tocó el <strong className="num">PLU {producto.plu}</strong> —
            cargalo con ese mismo número en las cuatro balanzas, si no la etiqueta
            va a escanear otra cosa.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Stock total</span>
            <span className="num text-xl">{fmtQty(totalStock)}</span>
            <span className="text-[11.5px] text-faint">
              mínimo {fmtQty(Number(producto.min_stock))}
            </span>
          </Card>

          {(stores ?? []).map((s) => (
            <Card key={s.id} className="flex flex-col gap-1 p-4">
              <span className="text-[11.5px] text-muted">{s.name}</span>
              <span className="num text-xl">{fmtQty(stockPorLocal.get(s.id) ?? 0)}</span>
              <span className="text-[11.5px] text-faint">
                {formatMoney((stockPorLocal.get(s.id) ?? 0) * Number(producto.cost))} a costo
              </span>
            </Card>
          ))}
        </div>

        {puedeEditar ? (
          <ProductForm
            action={editarProducto.bind(null, id)}
            categories={categories ?? []}
            product={producto}
          />
        ) : (
          <Card className="p-5">
            <p className="text-[13px] text-muted">
              Podés consultar este producto, pero no editarlo. Pedile a un
              encargado que haga el cambio.
            </p>
          </Card>
        )}

        {precios && precios.length > 0 && (
          <Card className="mt-3.5 flex flex-col overflow-hidden">
            <p className="px-5 pb-3 pt-4 text-sm font-semibold">Historial de precios</p>
            {precios.map((h, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-line/60 px-5 py-2.5 text-[13px]"
              >
                <span className="tnum text-muted">
                  {h.old_price === null ? "—" : formatMoney(h.old_price)}
                </span>
                <span className="text-faint">→</span>
                <span className="tnum font-medium">{formatMoney(h.new_price)}</span>
                {h.reason && <span className="text-muted">· {h.reason}</span>}
                <span className="grow" />
                <span className="text-[11.5px] text-faint">
                  {formatDateTime(h.created_at)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}

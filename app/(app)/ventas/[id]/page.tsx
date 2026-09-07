import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMe, getPermissions } from "@/lib/auth";
import { getNombresDeUsuarios } from "@/lib/usuarios";
import { canEdit } from "@/lib/permissions";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { SCALE_CHECK_LABEL } from "@/lib/ventas";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { BotonAnular } from "./cancel-button";
import { FormularioDevolucion, type LineaDevolvible } from "./return-form";

export const dynamic = "force-dynamic";

type Item = {
  id: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  cost_snapshot: number;
  source: "etiqueta" | "codigo" | "busqueda" | "manual";
  scale_code: string | null;
  products: { name: string; plu: number | null; unit_type: "kg" | "unidad" } | null;
};

type Venta = {
  id: string;
  number: number;
  created_at: string;
  subtotal: number;
  discount: number;
  surcharge: number;
  total: number;
  status: "completada" | "anulada";
  is_fiscal: boolean;
  channel: string;
  scale_check: string;
  note: string | null;
  user_id: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  store_id: string;
  stores: { name: string } | null;
  customers: { name: string | null; phone: string | null } | null;
  sale_items: Item[];
  sale_payments: {
    id: string;
    amount: number;
    surcharge: number;
    payment_methods: { name: string } | null;
  }[];
};

type Devolucion = {
  id: string;
  total: number;
  reason: string | null;
  created_at: string;
  user_id: string | null;
  return_items: { id: string; sale_item_id: string; qty: number; subtotal: number }[];
};

const SOURCE_LABEL: Record<Item["source"], string> = {
  etiqueta: "Etiqueta de balanza",
  codigo: "Código de barras",
  busqueda: "Buscado",
  manual: "Cargado a mano",
};

const COLS = "grid-cols-[minmax(0,1fr)_140px_120px_120px]";

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const { data, error } = await sb
    .from("sales")
    .select(
      "id, number, created_at, subtotal, discount, surcharge, total, status, is_fiscal, channel, scale_check, note, user_id, cancelled_by, cancelled_at, store_id, stores(name), customers(name, phone), sale_items(id, qty, unit_price, subtotal, cost_snapshot, source, scale_code, products(name, plu, unit_type)), sale_payments(id, amount, surcharge, payment_methods(name))"
    )
    .eq("id", id)
    .maybeSingle<Venta>();

  if (error) {
    return (
      <Card>
        <EmptyState
          title="No pude leer la venta"
          description={`La base devolvió: ${error.message}.`}
        />
      </Card>
    );
  }
  if (!data) notFound();

  const venta = data;
  const anulada = venta.status === "anulada";

  const [me, perms, devolucionesRes] = await Promise.all([
    getMe(),
    getPermissions(),
    sb
      .from("returns")
      .select("id, total, reason, created_at, user_id, return_items(id, sale_item_id, qty, subtotal)")
      .eq("sale_id", venta.id)
      .order("created_at", { ascending: false })
      .returns<Devolucion[]>(),
  ]);

  const devoluciones = devolucionesRes.data ?? [];
  const nombres = await getNombresDeUsuarios([
    venta.user_id,
    venta.cancelled_by,
    ...devoluciones.map((d) => d.user_id),
  ]);

  /* Cuánto se devolvió ya de cada línea, para no ofrecer devolverlo dos veces. */
  const devueltoPorLinea = new Map<string, number>();
  for (const d of devoluciones) {
    for (const ri of d.return_items) {
      devueltoPorLinea.set(
        ri.sale_item_id,
        (devueltoPorLinea.get(ri.sale_item_id) ?? 0) + Number(ri.qty)
      );
    }
  }
  const totalDevuelto = devoluciones.reduce((a, d) => a + Number(d.total), 0);

  const costo = venta.sale_items.reduce(
    (a, i) => a + Number(i.qty) * Number(i.cost_snapshot),
    0
  );
  const margen = Number(venta.total) - costo;

  // Devolver es del local: un cajero de Ramos no devuelve una venta de Mosconi.
  const puedeDevolver =
    !anulada &&
    canEdit(perms, "devoluciones") &&
    (me?.isAdmin || me?.storeId === venta.store_id);

  const lineasDevolvibles: LineaDevolvible[] = venta.sale_items.map((i) => ({
    id: i.id,
    nombre: i.products?.name ?? "Producto",
    unitType: i.products?.unit_type ?? "unidad",
    qty: Number(i.qty),
    unitPrice: Number(i.unit_price),
    subtotal: Number(i.subtotal),
    devuelto: devueltoPorLinea.get(i.id) ?? 0,
  }));

  return (
    <>
      <div>
        <Link
          href="/ventas"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.9} />
          Volver al panel
        </Link>
      </div>

      <PageHeader
        title={`Ticket #${venta.number}`}
        subtitle={`${formatDateTime(venta.created_at)} · ${venta.stores?.name ?? "—"} · ${(venta.user_id && nombres.get(venta.user_id)) || "—"}`}
      >
        <div className="flex items-center gap-2">
          {anulada && <Badge tone="danger">Anulada</Badge>}
          {!venta.is_fiscal && <Badge tone="neutral">No fiscal</Badge>}
          {venta.scale_check !== "sin_balanza" && (
            <Badge tone={venta.scale_check === "verificado" ? "ok" : "warn"}>
              {SCALE_CHECK_LABEL[venta.scale_check]}
            </Badge>
          )}
          {totalDevuelto > 0 && !anulada && (
            <Badge tone="warn">Devuelto {formatMoney(totalDevuelto)}</Badge>
          )}
          {me?.isAdmin && !anulada && (
            <BotonAnular
              saleId={venta.id}
              numero={venta.number}
              total={Number(venta.total)}
            />
          )}
        </div>
      </PageHeader>

      {anulada && (
        <Card className="border-danger/30 bg-danger-bg px-4 py-3 text-[13px] text-danger">
          Anulada el {venta.cancelled_at ? formatDateTime(venta.cancelled_at) : "—"}
          {venta.cancelled_by && ` por ${nombres.get(venta.cancelled_by) ?? "—"}`}
          {venta.note && ` · ${venta.note}`}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div
          className={cn(
            "grid border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint",
            COLS
          )}
        >
          <div>Producto</div>
          <div className="text-right">Cantidad</div>
          <div className="text-right">Precio</div>
          <div className="text-right">Importe</div>
        </div>

        {venta.sale_items.map((i) => {
          const unit = i.products?.unit_type ?? "unidad";
          const dev = devueltoPorLinea.get(i.id) ?? 0;

          return (
            <div
              key={i.id}
              className={cn("grid items-center border-b border-line/60 px-4 py-2.5 text-[13px]", COLS)}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{i.products?.name ?? "—"}</span>
                <span className="truncate text-[11.5px] text-faint">
                  {i.products?.plu ? `PLU ${i.products.plu} · ` : ""}
                  {SOURCE_LABEL[i.source]}
                  {i.scale_code ? ` · ${i.scale_code}` : ""}
                  {dev > 0 ? ` · devuelto ${formatQty(dev, unit)}` : ""}
                </span>
              </div>
              <div className="num text-right">{formatQty(i.qty, unit)}</div>
              <div className="tnum text-right text-muted">{formatMoney(i.unit_price)}</div>
              <div className="tnum text-right font-medium">{formatMoney(i.subtotal)}</div>
            </div>
          );
        })}

        <div className="flex flex-col items-end gap-1 px-4 py-3 text-[13px]">
          {Number(venta.discount) > 0 && (
            <div className="flex w-64 justify-between text-muted">
              <span>Descuento</span>
              <span className="tnum">− {formatMoney(venta.discount)}</span>
            </div>
          )}
          {Number(venta.surcharge) > 0 && (
            <div className="flex w-64 justify-between text-muted">
              <span>Recargo</span>
              <span className="tnum">+ {formatMoney(venta.surcharge)}</span>
            </div>
          )}
          <div className="flex w-64 justify-between font-semibold">
            <span>Total</span>
            <span className={cn("tnum text-[15px]", anulada && "text-faint line-through")}>
              {formatMoney(venta.total)}
            </span>
          </div>
          <div className="flex w-64 justify-between text-[12px] text-muted">
            <span>Costo</span>
            <span className="tnum">{formatMoney(costo)}</span>
          </div>
          <div className="flex w-64 justify-between text-[12px]">
            <span className="text-muted">Margen</span>
            <span className={cn("tnum", margen < 0 ? "text-danger" : "text-ok")}>
              {formatMoney(margen)}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid gap-3.5 md:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint">
            Cómo pagó
          </div>
          {venta.sale_payments.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-muted">Sin pagos registrados.</div>
          ) : (
            venta.sale_payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-b border-line/60 px-4 py-2.5 text-[13px] last:border-0"
              >
                <span>{p.payment_methods?.name ?? "—"}</span>
                <span className="tnum">
                  {formatMoney(p.amount)}
                  {Number(p.surcharge) > 0 && (
                    <span className="text-muted"> + {formatMoney(p.surcharge)} rec.</span>
                  )}
                </span>
              </div>
            ))
          )}
          {venta.customers?.name && (
            <div className="border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
              Cliente: {venta.customers.name}
              {venta.customers.phone ? ` · ${venta.customers.phone}` : ""}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint">
            Devoluciones
          </div>
          {devoluciones.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-muted">
              De este ticket no se devolvió nada.
            </div>
          ) : (
            devoluciones.map((d) => (
              <div key={d.id} className="border-b border-line/60 px-4 py-2.5 last:border-0">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted">{formatDateTime(d.created_at)}</span>
                  <span className="tnum text-danger">− {formatMoney(d.total)}</span>
                </div>
                <div className="text-[11.5px] text-faint">
                  {(d.user_id && nombres.get(d.user_id)) || "—"}
                  {d.reason ? ` · ${d.reason}` : ""}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      {puedeDevolver && (
        <FormularioDevolucion
          saleId={venta.id}
          numero={venta.number}
          lineas={lineasDevolvibles}
        />
      )}
    </>
  );
}

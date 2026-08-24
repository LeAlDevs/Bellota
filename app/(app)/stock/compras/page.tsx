import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getNombresDeUsuarios } from "@/lib/usuarios";
import { formatCalendarDate, formatKg, formatMoney, formatNumber } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Compra = {
  id: string;
  received_on: string;
  has_invoice: boolean;
  invoice_number: string | null;
  payment_terms: "contado" | "cuenta_corriente";
  total: number;
  note: string | null;
  user_id: string | null;
  suppliers: { name: string } | null;
  purchase_items: {
    qty_ordered: number | null;
    qty_received: number;
    unit_cost: number;
    products: { name: string; unit_type: "kg" | "unidad" } | null;
  }[];
};

export default async function ComprasPage() {
  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);
  const puedeEditar = canEdit(perms, "compras");

  const { data, error } = await sb
    .from("purchases")
    .select(
      "id, received_on, has_invoice, invoice_number, payment_terms, total, note, user_id, suppliers(name), purchase_items(qty_ordered, qty_received, unit_cost, products(name, unit_type))"
    )
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Compra[]>();

  const compras = data ?? [];
  const nombres = await getNombresDeUsuarios(compras.map((c) => c.user_id));

  const totalPeriodo = compras.reduce((a, c) => a + Number(c.total), 0);
  const enCuenta = compras
    .filter((c) => c.payment_terms === "cuenta_corriente")
    .reduce((a, c) => a + Number(c.total), 0);

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle={
          error
            ? "No pude leer las compras."
            : "Recepciones de mercadería. Lo que manda es lo que llegó."
        }
      >
        <div className="flex items-center gap-2.5">
          <Link href="/stock/compras/proveedores">
            <Button variant="ghost">
              <Users className="size-4" strokeWidth={1.8} />
              Proveedores
            </Button>
          </Link>
          {puedeEditar && (
            <Link href="/stock/compras/nueva">
              <Button>
                <Plus className="size-4" strokeWidth={2} />
                Recibir compra
              </Button>
            </Link>
          )}
        </div>
      </PageHeader>

      {compras.length > 0 && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Comprado (últimas 50)</span>
            <span className="num text-[26px] leading-none">
              {formatMoney(totalPeriodo)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">A cuenta corriente</span>
            <span
              className={cn(
                "num text-[26px] leading-none",
                enCuenta > 0 && "text-warn"
              )}
            >
              {formatMoney(enCuenta)}
            </span>
            <span className="text-[11.5px] text-faint">deuda generada</span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Recepciones</span>
            <span className="num text-[26px] leading-none">
              {formatNumber(compras.length)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-[11.5px] text-muted">Con factura</span>
            <span className="num text-[26px] leading-none">
              {formatNumber(compras.filter((c) => c.has_invoice).length)}
            </span>
            <span className="text-[11.5px] text-faint">
              de {formatNumber(compras.length)}
            </span>
          </Card>
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <EmptyState
            title="No pude leer las compras"
            description={`La base devolvió: ${error.message}. Si todavía no corriste 0007_compras.sql, es eso.`}
          />
        ) : compras.length === 0 ? (
          <EmptyState
            title="Todavía no se registró ninguna compra"
            description="Cuando recibas mercadería, cargala acá con el peso real. Eso es lo que actualiza el stock y el costo promedio ponderado de cada producto."
          >
            {puedeEditar && (
              <Link href="/stock/compras/nueva">
                <Button>Recibir la primera</Button>
              </Link>
            )}
          </EmptyState>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {compras.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2 border-b border-line/60 px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[14px] font-semibold">
                    {c.suppliers?.name ?? "—"}
                  </span>
                  {c.has_invoice ? (
                    <Badge tone="neutral">
                      {c.invoice_number ? `Factura ${c.invoice_number}` : "Con factura"}
                    </Badge>
                  ) : (
                    <Badge tone="warn">Sin factura</Badge>
                  )}
                  {c.payment_terms === "cuenta_corriente" && (
                    <Badge tone="warn">Cuenta corriente</Badge>
                  )}
                  <span className="grow" />
                  <span className="num text-[15px]">{formatMoney(c.total)}</span>
                </div>

                <div className="flex flex-col gap-0.5">
                  {c.purchase_items.map((i, k) => {
                    const dif =
                      i.qty_ordered != null
                        ? Number(i.qty_received) - Number(i.qty_ordered)
                        : null;
                    const esKg = i.products?.unit_type === "kg";
                    return (
                      <div key={k} className="flex items-baseline gap-2 text-[12.5px]">
                        <span className="truncate text-muted">
                          {i.products?.name ?? "—"}
                        </span>
                        {dif !== null && Math.abs(dif) > 0.0005 && (
                          <span
                            className={cn(
                              "shrink-0 text-[11px]",
                              dif < 0 ? "text-danger" : "text-ok"
                            )}
                            title="Diferencia contra lo pedido"
                          >
                            {dif > 0 ? "+" : ""}
                            {esKg ? formatKg(dif) : formatNumber(dif)}
                          </span>
                        )}
                        <span className="grow border-b border-dotted border-line" />
                        <span className="tnum shrink-0 text-muted">
                          {esKg
                            ? `${formatKg(i.qty_received)} kg`
                            : formatNumber(i.qty_received)}
                          {" × "}
                          {formatMoney(i.unit_cost)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {c.note && (
                  <p className="text-[11.5px] leading-snug text-muted">{c.note}</p>
                )}

                <div className="flex items-center gap-2 text-[11px] text-faint">
                  <span>{formatCalendarDate(c.received_on)}</span>
                  <span>·</span>
                  <span>{(c.user_id && nombres.get(c.user_id)) || "—"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

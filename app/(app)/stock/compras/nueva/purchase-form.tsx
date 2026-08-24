"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/form";
import { ProductPicker, type PickerProduct } from "@/components/ui/product-picker";
import { formatKg, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recibirCompra } from "../actions";

type Store = { id: string; name: string };
type Supplier = { id: string; name: string };

type Linea = {
  producto: PickerProduct;
  pedido: string;
  recibido: string;
  costo: string;
  /** { store_id: texto } — se guarda como texto para no pelear con la coma. */
  reparto: Record<string, string>;
};

const n = (s: string) => {
  const v = Number((s ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export function PurchaseForm({
  suppliers,
  stores,
  products,
  storeIdPropio,
  hoy,
}: {
  suppliers: Supplier[];
  stores: Store[];
  products: PickerProduct[];
  storeIdPropio: string | null;
  hoy: string;
}) {
  const router = useRouter();
  const [enviando, startEnviar] = useTransition();

  const [supplier, setSupplier] = useState(suppliers[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy);
  const [conFactura, setConFactura] = useState(true);
  const [numero, setNumero] = useState("");
  const [condicion, setCondicion] = useState<"contado" | "cuenta_corriente">("contado");
  const [nota, setNota] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);

  const [producto, setProducto] = useState<PickerProduct | null>(null);

  const destinoPorDefecto = storeIdPropio ?? stores[0]?.id ?? "";

  function agregar() {
    if (!producto) return;
    setLineas((ls) => [
      ...ls,
      {
        producto,
        pedido: "",
        recibido: "",
        costo: String(producto.cost || ""),
        reparto: Object.fromEntries(stores.map((s) => [s.id, ""])),
      },
    ]);
    setProducto(null);
  }

  function setLinea(i: number, patch: Partial<Linea>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  /** Todo lo recibido va a un solo local: es el caso más común. */
  function repartirTodoA(i: number, storeId: string) {
    setLineas((ls) =>
      ls.map((l, j) =>
        j === i
          ? {
              ...l,
              reparto: Object.fromEntries(
                stores.map((s) => [s.id, s.id === storeId ? l.recibido : ""])
              ),
            }
          : l
      )
    );
  }

  const resumen = useMemo(() => {
    return lineas.map((l) => {
      const recibido = n(l.recibido);
      const repartido = stores.reduce((a, s) => a + n(l.reparto[s.id] ?? ""), 0);
      const subtotal = recibido * n(l.costo);
      const cierra = Math.abs(repartido - recibido) < 0.0005 && recibido > 0;
      const diferenciaPedido =
        l.pedido.trim() !== "" ? recibido - n(l.pedido) : null;
      return { recibido, repartido, subtotal, cierra, diferenciaPedido };
    });
  }, [lineas, stores]);

  const total = resumen.reduce((a, r) => a + r.subtotal, 0);
  const todoCierra = resumen.length > 0 && resumen.every((r) => r.cierra);

  function confirmar() {
    startEnviar(async () => {
      const res = await recibirCompra({
        supplier_id: supplier,
        received_on: fecha,
        has_invoice: conFactura,
        invoice_number: conFactura ? numero || undefined : undefined,
        payment_terms: condicion,
        note: nota || undefined,
        items: lineas.map((l) => ({
          product_id: l.producto.id,
          qty_ordered: l.pedido.trim() !== "" ? n(l.pedido) : undefined,
          qty_received: n(l.recibido),
          unit_cost: n(l.costo),
          allocations: Object.fromEntries(
            stores
              .map((s) => [s.id, n(l.reparto[s.id] ?? "")] as const)
              .filter(([, v]) => v > 0)
          ),
        })),
      });

      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Compra recibida. El stock y los costos ya se actualizaron.");
      router.push("/stock/compras");
    });
  }

  const fmt = (v: number, t: "kg" | "unidad") =>
    t === "kg" ? `${formatKg(v)} kg` : formatNumber(v);

  const gridCols = {
    gridTemplateColumns: `minmax(0,1fr) 96px 104px 120px ${stores
      .map(() => "104px")
      .join(" ")} 116px 40px`,
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Card className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4">
        <Field label="Proveedor">
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            {suppliers.length === 0 && <option value="">Sin proveedores cargados</option>}
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Fecha de recepción">
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>

        <Field label="Comprobante">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConFactura(true)}
              className={cn(
                "h-10 flex-1 rounded-lg border text-[13px] font-medium transition-colors",
                conFactura
                  ? "border-accent bg-accent-soft text-accent-hover"
                  : "border-line-strong bg-card hover:bg-canvas"
              )}
            >
              Con factura
            </button>
            <button
              type="button"
              onClick={() => setConFactura(false)}
              className={cn(
                "h-10 flex-1 rounded-lg border text-[13px] font-medium transition-colors",
                !conFactura
                  ? "border-accent bg-accent-soft text-accent-hover"
                  : "border-line-strong bg-card hover:bg-canvas"
              )}
            >
              Sin factura
            </button>
          </div>
        </Field>

        <Field label="Cómo se paga">
          <Select
            value={condicion}
            onChange={(e) =>
              setCondicion(e.target.value as "contado" | "cuenta_corriente")
            }
          >
            <option value="contado">Contado — se paga ahora</option>
            <option value="cuenta_corriente">Cuenta corriente — queda debiendo</option>
          </Select>
        </Field>

        {conFactura && (
          <Field label="Número de comprobante" hint="Opcional">
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="A-0001-00012345"
            />
          </Field>
        )}

        <Field label="Nota" className="col-span-2 lg:col-span-3">
          <Textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            className="min-h-10"
            placeholder="Vino con el reparto del martes"
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-end gap-2.5">
          <Field label="Agregar producto" className="grow">
            <ProductPicker
              products={products}
              value={producto}
              onChange={setProducto}
              placeholder="Buscar por nombre o PLU"
            />
          </Field>
          <Button type="button" variant="ghost" onClick={agregar} disabled={!producto}>
            <Plus className="size-4" strokeWidth={2} />
            Agregar
          </Button>
        </div>

        {lineas.length === 0 ? (
          <p className="rounded-lg bg-canvas px-3.5 py-6 text-center text-[13px] text-muted">
            Buscá los productos que llegaron y cargalos con el{" "}
            <strong>peso real de la balanza</strong>, no con lo que decía el pedido.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div
                style={gridCols}
                className="grid border-b border-line px-2 pb-2 text-[10.5px] uppercase tracking-[0.055em] text-faint"
              >
                <div>Producto</div>
                <div className="text-right">Pedido</div>
                <div className="text-right">Recibido</div>
                <div className="text-right">Costo unit.</div>
                {stores.map((s) => (
                  <div key={s.id} className="text-right">
                    {s.name}
                  </div>
                ))}
                <div className="text-right">Subtotal</div>
                <div />
              </div>

              {lineas.map((l, i) => {
                const r = resumen[i];
                return (
                  <div
                    key={`${l.producto.id}-${i}`}
                    style={gridCols}
                    className={cn(
                      "grid items-center gap-1 border-b border-line/60 px-2 py-2",
                      !r.cierra && l.recibido !== "" && "bg-warn-bg/40"
                    )}
                  >
                    <div className="flex min-w-0 flex-col pr-2">
                      <span className="truncate text-[13px] font-medium">
                        {l.producto.name}
                      </span>
                      <span className="text-[11px] text-faint">
                        {l.producto.plu != null ? `PLU ${l.producto.plu}` : "sin PLU"} ·{" "}
                        {l.producto.unit_type === "kg" ? "por kg" : "por unidad"}
                      </span>
                    </div>

                    <Input
                      inputMode="decimal"
                      value={l.pedido}
                      onChange={(e) => setLinea(i, { pedido: e.target.value })}
                      className="h-9 text-right"
                      placeholder="—"
                    />

                    <Input
                      inputMode="decimal"
                      value={l.recibido}
                      onChange={(e) => setLinea(i, { recibido: e.target.value })}
                      className="h-9 border-accent/40 text-right font-medium"
                      placeholder="0,000"
                    />

                    <Input
                      inputMode="decimal"
                      value={l.costo}
                      onChange={(e) => setLinea(i, { costo: e.target.value })}
                      className="h-9 text-right"
                    />

                    {stores.map((s) => (
                      <Input
                        key={s.id}
                        inputMode="decimal"
                        value={l.reparto[s.id] ?? ""}
                        onChange={(e) =>
                          setLinea(i, {
                            reparto: { ...l.reparto, [s.id]: e.target.value },
                          })
                        }
                        onDoubleClick={() => repartirTodoA(i, s.id)}
                        title="Doble clic: mandar todo a este local"
                        className="h-9 text-right"
                        placeholder="0"
                      />
                    ))}

                    <div className="num pr-1 text-right text-[13px]">
                      {r.subtotal > 0 ? formatMoney(r.subtotal) : "—"}
                    </div>

                    <button
                      type="button"
                      aria-label={`Sacar ${l.producto.name}`}
                      onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                      className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger-bg hover:text-danger"
                    >
                      <Trash2 className="size-4" strokeWidth={1.8} />
                    </button>

                    {/* Avisos de la línea, debajo y ocupando el ancho */}
                    {(!r.cierra || r.diferenciaPedido) && (
                      <div className="col-span-full flex flex-wrap items-center gap-3 pt-1 text-[11.5px]">
                        {!r.cierra && l.recibido !== "" && (
                          <span className="flex items-center gap-1.5 font-medium text-warn">
                            <TriangleAlert className="size-3.5" strokeWidth={2} />
                            Llegaron {fmt(r.recibido, l.producto.unit_type)} y estás
                            repartiendo {fmt(r.repartido, l.producto.unit_type)}
                          </span>
                        )}
                        {r.diferenciaPedido !== null && r.diferenciaPedido !== 0 && (
                          <span className="text-muted">
                            Contra el pedido:{" "}
                            <span
                              className={
                                r.diferenciaPedido < 0 ? "text-danger" : "text-ok"
                              }
                            >
                              {r.diferenciaPedido > 0 ? "+" : ""}
                              {fmt(r.diferenciaPedido, l.producto.unit_type)}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] text-muted">Total de la compra</span>
          <span className="num text-2xl">{formatMoney(total)}</span>
        </div>

        {condicion === "cuenta_corriente" && total > 0 && (
          <div className="flex flex-col gap-0.5 border-l border-line pl-4">
            <span className="text-[11.5px] text-muted">Queda debiendo</span>
            <span className="num text-lg text-warn">{formatMoney(total)}</span>
          </div>
        )}

        <span className="grow" />

        <Button
          type="button"
          onClick={confirmar}
          disabled={enviando || !supplier || !todoCierra}
        >
          {enviando ? "Recibiendo…" : "Recibir la compra"}
        </Button>
      </Card>

      <p className="text-[12.5px] leading-relaxed text-muted">
        Al recibirla, la mercadería entra en cada local según el reparto y se
        recalcula el <strong>costo promedio ponderado</strong> de cada producto
        sobre el total recibido. El costo no se edita a mano en ningún otro lado:
        sale de acá.
      </p>
    </div>
  );
}

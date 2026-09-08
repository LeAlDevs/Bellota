"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Barcode,
  Check,
  CircleAlert,
  Mail,
  Phone,
  Scale,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Input } from "@/components/ui/form";
import {
  ProductPicker,
  type PickerProduct,
  type Presentacion,
} from "@/components/ui/product-picker";
import { formatKg, formatMoney, formatNumber, formatQty } from "@/lib/format";
import { leerEtiqueta, pesoDesdeImporte } from "@/lib/balanza";
import { cn } from "@/lib/utils";
import { cobrar, type LineaVenta, type PagoVenta } from "./actions";

export type MedioPago = {
  id: string;
  name: string;
  surcharge_pct: number;
  affects_cash: boolean;
};

type Linea = {
  key: string;
  producto: PickerProduct;
  /** Con qué precio se está cobrando: fraccionado, horma entera, etc. */
  presentacion: Presentacion;
  qty: number;
  precio: number;
  source: LineaVenta["source"];
  scaleCode?: string;
  /** El importe que traía la etiqueta, para el control contra el total. */
  importeEtiqueta?: number;
};

type Pago = { metodo: MedioPago; monto: number };

const num = (s: string) => {
  const v = Number((s ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export function PosTerminal({
  storeId,
  storeName,
  sessionId,
  products,
  metodos,
  ventasDelTurno,
  ticketsDelTurno,
}: {
  storeId: string;
  storeName: string;
  sessionId: string;
  products: PickerProduct[];
  metodos: MedioPago[];
  ventasDelTurno: number;
  ticketsDelTurno: number;
}) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [fiscal, setFiscal] = useState(true);
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [scan, setScan] = useState("");
  const [pendiente, setPendiente] = useState<PickerProduct | null>(null);
  const [peso, setPeso] = useState("");
  const [enviando, startEnviar] = useTransition();

  /** Importe de balanza cargado desde el último código de total. */
  const [balanzaSinVerificar, setBalanzaSinVerificar] = useState(0);
  const [balanzaVerificada, setBalanzaVerificada] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const pesoRef = useRef<HTMLInputElement>(null);

  /*
   * El PLU ya no identifica un producto: identifica una FORMA de venderlo. El
   * mismo queso tiene un PLU para el fraccionado y otro para la horma, con
   * precios distintos. Sin esto, una etiqueta de horma se dividiría por el
   * precio del fraccionado y el peso saldría mal.
   */
  const porPlu = useMemo(() => {
    const m = new Map<number, { producto: PickerProduct; presentacion: Presentacion }>();
    for (const producto of products) {
      for (const presentacion of producto.presentations) {
        if (presentacion.plu != null) m.set(presentacion.plu, { producto, presentacion });
      }
    }
    return m;
  }, [products]);

  /** La forma de venderlo que se usa cuando no hay etiqueta que lo diga. */
  const principalDe = (p: PickerProduct): Presentacion =>
    p.presentations.find((x) => x.is_default) ??
    p.presentations[0] ?? {
      id: "",
      name: "",
      plu: p.plu,
      price: p.price,
      min_qty: null,
      is_default: true,
    };
  const porBarcode = useMemo(
    () => new Map(products.filter((p) => p.barcode).map((p) => [p.barcode as string, p])),
    [products]
  );

  /**
   * Lo que se cobra de cada línea. Si vino de una etiqueta, manda el importe
   * del ticket: el cliente ya lo leyó en el papel, y reconstruirlo como
   * cantidad × precio lo corre por el redondeo del peso.
   */
  const importeDe = (l: Linea) => l.importeEtiqueta ?? l.qty * l.precio;

  const subtotal = lineas.reduce((a, l) => a + importeDe(l), 0);
  const pagado = pagos.reduce((a, p) => a + p.monto, 0);
  const recargo = pagos.reduce((a, p) => a + (p.monto * p.metodo.surcharge_pct) / 100, 0);
  const total = subtotal + recargo;
  const falta = Math.round((subtotal - pagado) * 100) / 100;

  // La lectora escribe como un teclado: el foco tiene que estar siempre acá o
  // el escaneo se pierde en cualquier otro campo.
  useEffect(() => {
    if (!pendiente) scanRef.current?.focus();
  }, [pendiente, lineas.length]);

  useEffect(() => {
    if (pendiente) pesoRef.current?.focus();
  }, [pendiente]);

  function agregar(
    producto: PickerProduct,
    qty: number,
    source: Linea["source"],
    extra?: {
      scaleCode?: string;
      importeEtiqueta?: number;
      precio?: number;
      presentacion?: Presentacion;
    }
  ) {
    const presentacion = extra?.presentacion ?? principalDe(producto);

    /* Una horma no son 200 g. Si la etiqueta trae el PLU de horma por una
       cantidad chica, casi seguro se eligió mal el PLU en la balanza y se está
       cobrando de menos. Se avisa y se sigue: frenar la cola es peor, y el
       cajero puede sacar la línea. */
    if (presentacion.min_qty != null && qty < presentacion.min_qty - 0.0005) {
      toast.warning(
        `${producto.name}: "${presentacion.name}" es desde ${formatQty(presentacion.min_qty, producto.unit_type)} y esto son ${formatQty(qty, producto.unit_type)}. Fijate si en la balanza se eligió el PLU correcto.`,
        { duration: 9000 }
      );
    }

    setLineas((ls) => [
      ...ls,
      {
        key: `${producto.id}-${Date.now()}-${ls.length}`,
        producto,
        presentacion,
        qty,
        precio: extra?.precio ?? presentacion.price,
        source,
        scaleCode: extra?.scaleCode,
        importeEtiqueta: extra?.importeEtiqueta,
      },
    ]);
    if (extra?.importeEtiqueta) {
      setBalanzaSinVerificar((v) => v + extra.importeEtiqueta!);
      setBalanzaVerificada(false);
    }
  }

  function procesarEscaneo(crudo: string) {
    const codigo = crudo.trim();
    if (!codigo) return;

    const et = leerEtiqueta(codigo);

    // ── Código del total del ticket de balanza ──────────────
    if (et.tipo === "total") {
      if (balanzaSinVerificar === 0) {
        toast.error(
          "Escaneaste el total del ticket pero no cargaste ninguna línea todavía."
        );
        return;
      }
      const dif = Math.round((balanzaSinVerificar - et.importe) * 100) / 100;
      if (Math.abs(dif) < 0.5) {
        setBalanzaVerificada(true);
        setBalanzaSinVerificar(0);
        toast.success(`Ticket verificado: ${formatMoney(et.importe)} coincide.`);
      } else if (dif < 0) {
        toast.error(
          `El ticket dice ${formatMoney(et.importe)} y cargaste ${formatMoney(balanzaSinVerificar)}. Falta escanear ${formatMoney(-dif)}.`,
          { duration: 8000 }
        );
      } else {
        toast.error(
          `Cargaste ${formatMoney(balanzaSinVerificar)} y el ticket dice ${formatMoney(et.importe)}. Escaneaste ${formatMoney(dif)} de más.`,
          { duration: 8000 }
        );
      }
      return;
    }

    // ── Línea del ticket de balanza ─────────────────────────
    if (et.tipo === "linea") {
      const match = porPlu.get(et.plu);
      if (!match) {
        toast.error(
          `El PLU ${et.plu} no está cargado en Bellota. Buscá el producto y cargalo a mano.`,
          { duration: 8000 }
        );
        return;
      }
      const { producto, presentacion } = match;

      /* El precio que se usa para despejar la cantidad es el de ESTA
         presentación, que es el que tiene cargado la balanza para este PLU. */
      if (producto.unit_type === "unidad") {
        // La balanza lo vendió por unidad: la cantidad sale del importe.
        const unidades = Math.round(et.importe / presentacion.price);
        agregar(producto, Math.max(unidades, 1), "etiqueta", {
          scaleCode: et.codigo,
          importeEtiqueta: et.importe,
          presentacion,
        });
        return;
      }
      const r = pesoDesdeImporte(et.importe, presentacion.price);
      if ("error" in r) {
        toast.error(`${producto.name}: ${r.error}`, { duration: 8000 });
        return;
      }
      agregar(producto, r.kg, "etiqueta", {
        scaleCode: et.codigo,
        importeEtiqueta: et.importe,
        presentacion,
      });
      return;
    }

    // ── Código de fábrica de un envasado ────────────────────
    const porEan = porBarcode.get(codigo.replace(/\D/g, ""));
    if (porEan) {
      agregar(porEan, 1, "codigo");
      return;
    }

    toast.error(`No reconozco el código ${codigo}. ${et.motivo ?? ""}`, {
      duration: 7000,
    });
  }

  function elegirDeBusqueda(p: PickerProduct | null) {
    if (!p) return;
    if (p.unit_type === "kg") {
      setPendiente(p);
      setPeso("");
    } else {
      agregar(p, 1, "busqueda");
    }
  }

  function confirmarPeso() {
    if (!pendiente) return;
    const kg = num(peso);
    if (kg <= 0) {
      toast.error("Poné cuántos kilos.");
      return;
    }
    agregar(pendiente, kg, "manual");
    setPendiente(null);
    setPeso("");
  }

  function pagarCon(m: MedioPago) {
    if (falta <= 0) return;
    setPagos((ps) => {
      const existe = ps.find((p) => p.metodo.id === m.id);
      if (existe) {
        return ps.map((p) =>
          p.metodo.id === m.id ? { ...p, monto: p.monto + falta } : p
        );
      }
      return [...ps, { metodo: m, monto: falta }];
    });
  }

  function limpiar() {
    setLineas([]);
    setPagos([]);
    setEmail("");
    setTelefono("");
    setBalanzaSinVerificar(0);
    setBalanzaVerificada(false);
    setFiscal(true);
  }

  function confirmar() {
    if (lineas.length === 0) return;
    if (Math.abs(falta) > 0.5) {
      toast.error(
        falta > 0
          ? `Falta cubrir ${formatMoney(falta)}.`
          : `Los pagos se pasan por ${formatMoney(-falta)}.`
      );
      return;
    }

    const hayBalanza = lineas.some((l) => l.source === "etiqueta");
    const scaleCheck = !hayBalanza
      ? ("sin_balanza" as const)
      : balanzaSinVerificar === 0 && balanzaVerificada
        ? ("verificado" as const)
        : ("sin_verificar" as const);

    if (scaleCheck === "sin_verificar") {
      const ok = confirm(
        `Quedaron ${formatMoney(balanzaSinVerificar)} de balanza sin contrastar contra el total del ticket. ¿Cobrás igual?`
      );
      if (!ok) return;
    }

    startEnviar(async () => {
      const items: LineaVenta[] = lineas.map((l) => ({
        product_id: l.producto.id,
        presentation_id: l.presentacion.id || undefined,
        qty: l.qty,
        unit_price: l.precio,
        subtotal: l.importeEtiqueta,
        source: l.source,
        scale_code: l.scaleCode,
      }));
      const payments: PagoVenta[] = pagos.map((p) => ({
        payment_method_id: p.metodo.id,
        amount: p.monto,
      }));

      const res = await cobrar({
        store_id: storeId,
        items,
        payments,
        is_fiscal: fiscal,
        scale_check: scaleCheck,
        email: email || undefined,
        phone: telefono || undefined,
      });

      if (res.error) {
        toast.error(res.error, { duration: 8000 });
        return;
      }
      toast.success(`Venta #${res.numero} cobrada · ${formatMoney(res.total ?? 0)}`);
      limpiar();
    });
  }

  const fmtQty = (l: Linea) =>
    l.producto.unit_type === "kg" ? `${formatKg(l.qty)} kg` : formatNumber(l.qty);

  return (
    <div className="flex min-h-0 flex-1 gap-3.5">
      {/* ── Izquierda: entrada ───────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <Card className="flex items-center gap-3 border-2 border-accent p-4">
          <Barcode className="size-6 shrink-0 text-accent" strokeWidth={1.6} />
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                procesarEscaneo(scan);
                setScan("");
              }
            }}
            placeholder="Escaneá el ticket de la balanza o el código del paquete"
            className="w-full bg-transparent text-[17px] outline-none placeholder:text-faint"
          />
          <kbd className="shrink-0 rounded border border-line-strong px-2 py-1 text-[11px] text-faint">
            lectora
          </kbd>
        </Card>

        {pendiente ? (
          <Card className="flex flex-wrap items-end gap-4 border-accent/40 bg-accent-soft/50 p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11.5px] text-muted">Pesando</span>
              <span className="text-[15px] font-semibold">{pendiente.name}</span>
              <span className="text-[12px] text-muted">
                {formatMoney(pendiente.price)} / kg
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink/70">Kilos</span>
              <Input
                ref={pesoRef}
                inputMode="decimal"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirmarPeso();
                  }
                  if (e.key === "Escape") setPendiente(null);
                }}
                placeholder="0,250"
                className="w-32 text-right text-lg"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11.5px] text-muted">Importe</span>
              <span className="num text-xl">
                {formatMoney(num(peso) * pendiente.price)}
              </span>
            </div>
            <span className="grow" />
            <Button type="button" onClick={confirmarPeso}>
              Agregar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPendiente(null)}>
              Cancelar
            </Button>
          </Card>
        ) : (
          <Card className="flex items-end gap-3 p-4">
            <div className="flex grow flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
                <Search className="size-3.5" strokeWidth={2} />
                Buscar a mano
              </span>
              <ProductPicker
                products={products}
                value={null}
                onChange={elegirDeBusqueda}
                placeholder="Nombre o PLU, para lo que no tiene código"
              />
            </div>
          </Card>
        )}

        {/* Control del ticket de balanza */}
        {(balanzaSinVerificar > 0 || balanzaVerificada) && (
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-3",
              balanzaSinVerificar > 0
                ? "border-warn/30 bg-warn-bg"
                : "border-ok/30 bg-ok-bg"
            )}
          >
            {balanzaSinVerificar > 0 ? (
              <Scale className="size-[18px] shrink-0 text-warn" strokeWidth={1.8} />
            ) : (
              <Check className="size-[18px] shrink-0 text-ok" strokeWidth={2} />
            )}
            <p
              className={cn(
                "text-[13px] leading-relaxed",
                balanzaSinVerificar > 0 ? "text-warn" : "text-ok"
              )}
            >
              {balanzaSinVerificar > 0 ? (
                <>
                  Llevás <strong className="num">{formatMoney(balanzaSinVerificar)}</strong>{" "}
                  de balanza. Escaneá el código del total, abajo del ticket, para
                  confirmar que no quedó ninguna línea.
                </>
              ) : (
                <>Ticket de balanza verificado contra su total.</>
              )}
            </p>
          </div>
        )}

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {lineas.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <Barcode className="size-8 text-faint" strokeWidth={1.3} />
              <p className="text-sm font-semibold">Esperando el primer código</p>
              <p className="max-w-sm text-[13px] leading-relaxed text-muted">
                Pasá la lectora por las líneas del ticket, de arriba hacia abajo, y
                terminá con el código del total.
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {lineas.map((l) => (
                <div
                  key={l.key}
                  className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[14px] font-medium">
                      {l.producto.name}
                    </span>
                    <span className="flex items-center gap-2 text-[11.5px] text-muted">
                      {l.source === "etiqueta" && <Badge tone="ok">Etiqueta</Badge>}
                      {l.source === "codigo" && <Badge tone="neutral">Código</Badge>}
                      {l.source === "manual" && <Badge tone="neutral">Peso a mano</Badge>}
                      {l.source === "busqueda" && <Badge tone="neutral">Buscado</Badge>}

                      {/* Si el producto se vende de una sola forma no hay nada
                          que elegir y el selector sería ruido. Si se vende de
                          varias, el cajero tiene que poder corregir sin sacar
                          la línea y volver a escanear. */}
                      {l.producto.presentations.length > 1 && (
                        <select
                          value={l.presentacion.id}
                          onChange={(e) => {
                            const nueva = l.producto.presentations.find(
                              (x) => x.id === e.target.value
                            );
                            if (!nueva) return;
                            setLineas((ls) =>
                              ls.map((x) =>
                                x.key === l.key
                                  ? {
                                      ...x,
                                      presentacion: nueva,
                                      precio: nueva.price,
                                      /* Cambiar la forma de venta cambia el
                                         precio: el importe del papel deja de
                                         valer y hay que recalcular. */
                                      importeEtiqueta: undefined,
                                    }
                                  : x
                              )
                            );
                            if (l.importeEtiqueta) {
                              setBalanzaSinVerificar((v) =>
                                Math.max(0, v - l.importeEtiqueta!)
                              );
                            }
                          }}
                          className="h-6 rounded border border-line-strong bg-card px-1 pr-5 text-[11.5px] outline-none"
                        >
                          {l.producto.presentations.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.name}
                            </option>
                          ))}
                        </select>
                      )}

                      <span>
                        {fmtQty(l)} × {formatMoney(l.precio)}
                      </span>
                    </span>
                  </div>
                  <span className="grow" />
                  <span className="num text-[15px]">{formatMoney(importeDe(l))}</span>
                  <button
                    type="button"
                    aria-label={`Sacar ${l.producto.name}`}
                    onClick={() => {
                      if (l.importeEtiqueta) {
                        setBalanzaSinVerificar((v) => Math.max(0, v - l.importeEtiqueta!));
                      }
                      setLineas((ls) => ls.filter((x) => x.key !== l.key));
                    }}
                    className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger-bg hover:text-danger"
                  >
                    <Trash2 className="size-4" strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Derecha: cobro ──────────────────────────────── */}
      <div className="flex w-[400px] shrink-0 flex-col gap-3.5">
        <Card className="flex items-center gap-2.5 p-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11.5px] text-muted">{storeName}</span>
            <span className="text-[13px] font-semibold">
              {formatNumber(ticketsDelTurno)} tickets · {formatMoney(ventasDelTurno)}
            </span>
          </div>
          <span className="grow" />
          <div className="flex overflow-hidden rounded-lg border border-line-strong">
            <button
              type="button"
              onClick={() => setFiscal(true)}
              className={cn(
                "px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                fiscal ? "bg-accent text-accent-fg" : "hover:bg-canvas"
              )}
            >
              Fiscal
            </button>
            <button
              type="button"
              onClick={() => setFiscal(false)}
              className={cn(
                "border-l border-line-strong px-3 py-1.5 text-[12.5px] transition-colors",
                !fiscal ? "bg-accent text-accent-fg" : "hover:bg-canvas"
              )}
            >
              No fiscal
            </button>
          </div>
        </Card>

        <Card className="flex flex-1 flex-col gap-3.5 p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] text-muted">
              {formatNumber(lineas.length)}{" "}
              {lineas.length === 1 ? "artículo" : "artículos"}
            </span>
            <span className="grow" />
            <span className="text-[13px] text-muted">Total</span>
            <span className="num text-[34px] leading-none">{formatMoney(total)}</span>
          </div>

          {recargo > 0 && (
            <p className="text-[12px] text-muted">
              Incluye {formatMoney(recargo)} de recargo por medio de pago.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {metodos.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pagarCon(m)}
                disabled={falta <= 0}
                className={cn(
                  "flex h-12 items-center justify-center rounded-[10px] border text-[13px] font-medium transition-colors disabled:opacity-40",
                  pagos.some((p) => p.metodo.id === m.id)
                    ? "border-accent bg-accent-soft text-accent-hover"
                    : "border-line-strong bg-card hover:bg-canvas"
                )}
              >
                {m.name}
                {m.surcharge_pct > 0 && (
                  <span className="ml-1 text-[11px] text-muted">
                    +{m.surcharge_pct}%
                  </span>
                )}
              </button>
            ))}
          </div>

          {pagos.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg bg-subtle p-3">
              {pagos.map((p) => (
                <div key={p.metodo.id} className="flex items-center gap-2 text-[13px]">
                  <span>{p.metodo.name}</span>
                  <span className="grow" />
                  <span className="num">{formatMoney(p.monto)}</span>
                  <button
                    type="button"
                    aria-label={`Sacar ${p.metodo.name}`}
                    onClick={() =>
                      setPagos((ps) => ps.filter((x) => x.metodo.id !== p.metodo.id))
                    }
                    className="text-muted transition-colors hover:text-danger"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {falta > 0.5 && lineas.length > 0 && (
            <p className="flex items-center gap-2 text-[13px] font-medium text-warn">
              <CircleAlert className="size-4" strokeWidth={1.8} />
              Falta cubrir {formatMoney(falta)}
            </p>
          )}
          {falta < -0.5 && (
            <p className="flex items-center gap-2 text-[13px] font-medium text-danger">
              <TriangleAlert className="size-4" strokeWidth={1.8} />
              Los pagos se pasan por {formatMoney(-falta)}
            </p>
          )}

          {/* Los dos son opcionales y no bloquean el cobro. El teléfono suele
              ser el que más sirve: es el que después sirve para avisar por
              WhatsApp cuando llega mercadería. */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-line-strong">
            <div className="flex items-center gap-2.5 px-3 py-2">
              <Mail className="size-3.5 shrink-0 text-faint" strokeWidth={1.8} />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Mail, para el ticket"
                inputMode="email"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
            </div>
            <div className="flex items-center gap-2.5 border-t border-line px-3 py-2">
              <Phone className="size-3.5 shrink-0 text-faint" strokeWidth={1.8} />
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Teléfono"
                inputMode="tel"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
            </div>
          </div>

          <span className="grow" />

          <button
            type="button"
            onClick={confirmar}
            disabled={enviando || lineas.length === 0 || Math.abs(falta) > 0.5}
            className="flex h-16 items-center justify-center gap-3 rounded-xl bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <span className="text-[17px] font-semibold">
              {enviando ? "Cobrando…" : "Cobrar"}
            </span>
            {!enviando && lineas.length > 0 && (
              <span className="num text-[24px]">{formatMoney(total)}</span>
            )}
          </button>

          {lineas.length > 0 && (
            <button
              type="button"
              onClick={limpiar}
              className="text-[12.5px] text-muted transition-colors hover:text-danger"
            >
              Cancelar la venta
            </button>
          )}
        </Card>

        <input type="hidden" value={sessionId} readOnly />
      </div>
    </div>
  );
}

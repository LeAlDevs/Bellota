"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState } from "@/components/ui/form";
import { formatKg, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { importarProductos, type FilaImportable } from "./actions";

export type Store = { id: string; name: string };
export type Existente = {
  id: string;
  plu: number | null;
  barcode: string | null;
  nombre: string;
};

type Estado = "nuevo" | "actualiza" | "error";

type FilaPreview = {
  linea: number;
  estado: Estado;
  problema?: string;
  nombre: string;
  plu?: number;
  barcode?: string;
  sku?: string;
  tipo?: "kg" | "unidad";
  precio?: number;
  costo?: number;
  categoria?: string;
  minimo?: number;
  vence?: boolean;
  vida_util?: number;
  stock: Record<string, number>;
};

/** Saca acentos y normaliza para comparar encabezados y valores. */
function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas de acento sueltas tras el NFD
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Acepta "1.234,56", "1234.56", "$ 1.234" y el número crudo que devuelve Excel.
 * En una planilla armada a mano conviven los tres.
 */
function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.NaN;

  let s = String(v).replace(/[^\d.,-]/g, "").trim();
  if (!s) return undefined;

  const coma = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");

  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toTipo(v: unknown): "kg" | "unidad" | undefined {
  const s = norm(v);
  if (!s) return undefined;
  if (["kg", "kilo", "kilos", "peso", "pesable", "por kg", "k"].includes(s)) return "kg";
  if (["unidad", "unidades", "u", "un", "por unidad", "uni"].includes(s)) return "unidad";
  return undefined;
}

function toBool(v: unknown): boolean {
  const s = norm(v);
  return ["si", "s", "x", "true", "1", "verdadero", "sí"].includes(s);
}

const ALIAS: Record<string, string> = {
  nombre: "nombre",
  producto: "nombre",
  articulo: "nombre",
  detalle: "nombre",
  plu: "plu",
  "plu balanza": "plu",
  "codigo balanza": "plu",
  "codigo de barras": "barcode",
  "codigo de barra": "barcode",
  ean: "barcode",
  barcode: "barcode",
  sku: "sku",
  "codigo interno": "sku",
  tipo: "tipo",
  unidad: "tipo",
  "se vende por": "tipo",
  "tipo de venta": "tipo",
  costo: "costo",
  "costo inicial": "costo",
  precio: "precio",
  "precio de venta": "precio",
  "precio venta": "precio",
  venta: "precio",
  categoria: "categoria",
  rubro: "categoria",
  minimo: "minimo",
  "stock minimo": "minimo",
  "minimo de stock": "minimo",
  vence: "vence",
  vencimiento: "vence",
  "controla vencimiento": "vence",
  "vida util": "vida_util",
  "dias de vida util": "vida_util",
  dias: "vida_util",
};

export function Importer({
  stores,
  existentes,
  puedeEditar,
}: {
  stores: Store[];
  existentes: Existente[];
  puedeEditar: boolean;
}) {
  const [filas, setFilas] = useState<FilaPreview[] | null>(null);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [enviando, startEnviar] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const porPlu = new Map(
    existentes.filter((e) => e.plu != null).map((e) => [e.plu as number, e])
  );
  const porBarcode = new Map(
    existentes.filter((e) => e.barcode).map((e) => [e.barcode as string, e])
  );
  const porNombre = new Map(existentes.map((e) => [norm(e.nombre), e]));

  function descargarPlantilla() {
    const encabezados = [
      "Nombre",
      "PLU",
      "Código de barras",
      "SKU",
      "Tipo",
      "Costo",
      "Precio de venta",
      "Categoría",
      "Stock mínimo",
      "Vence",
      ...stores.map((s) => `Stock ${s.name}`),
    ];
    // Los tres casos reales: lo que se pesa lleva PLU, lo envasado lleva EAN,
    // y lo que se arma acá adentro puede no llevar ninguno de los dos.
    const ejemplo = [
      ["Jamón crudo estacionado", 412, "", "", "kg", 28314, 42900, "Fiambres", 5, "no", ...stores.map(() => 0)],
      ["Aceitunas verdes 350 g", "", "7791234567890", "ACE350", "unidad", 4100, 6400, "Envasados", 6, "no", ...stores.map(() => 0)],
      ["Picada Ibérico 800 g", 3302, "", "", "unidad", 27730, 47000, "Elaborados", 4, "sí", ...stores.map(() => 0)],
    ];

    const ws = XLSX.utils.aoa_to_sheet([encabezados, ...ejemplo]);
    ws["!cols"] = encabezados.map((h) => ({ wch: Math.max(14, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, "plantilla-productos-bellota.xlsx");
  }

  async function leerArchivo(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const crudas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

      if (crudas.length === 0) {
        toast.error("La primera hoja está vacía.");
        return;
      }

      // Mapa encabezado del archivo -> campo nuestro
      const campos = new Map<string, string>();
      const stockPorColumna = new Map<string, string>();

      for (const encabezado of Object.keys(crudas[0])) {
        const n = norm(encabezado);
        if (ALIAS[n]) {
          campos.set(encabezado, ALIAS[n]);
          continue;
        }
        const store = stores.find(
          (s) => n === `stock ${norm(s.name)}` || n === norm(s.name)
        );
        if (store) stockPorColumna.set(encabezado, store.id);
      }

      if (![...campos.values()].includes("nombre")) {
        toast.error(
          "No encontré la columna Nombre. Bajate la plantilla y usá esos encabezados."
        );
        return;
      }

      const preview: FilaPreview[] = crudas.map((cruda, i) => {
        const v: Record<string, unknown> = {};
        for (const [col, campo] of campos) v[campo] = cruda[col];

        const stock: Record<string, number> = {};
        for (const [col, storeId] of stockPorColumna) {
          const n = toNumber(cruda[col]);
          if (n !== undefined && !Number.isNaN(n)) stock[storeId] = n;
        }

        const nombre = String(v.nombre ?? "").trim();
        const tipo = toTipo(v.tipo);
        const precio = toNumber(v.precio);
        const costo = toNumber(v.costo);
        const plu = toNumber(v.plu);
        const barcode = String(v.barcode ?? "").trim() || undefined;
        const sku = String(v.sku ?? "").trim() || undefined;
        const minimo = toNumber(v.minimo);
        const vidaUtil = toNumber(v.vida_util);
        const categoria = String(v.categoria ?? "").trim() || undefined;
        const vence = toBool(v.vence);

        const base = {
          linea: i + 2, // +2: la fila 1 son los encabezados
          nombre,
          plu: plu !== undefined && !Number.isNaN(plu) ? Math.trunc(plu) : undefined,
          barcode,
          sku,
          tipo,
          precio,
          costo: costo !== undefined && !Number.isNaN(costo) ? costo : undefined,
          categoria,
          minimo: minimo !== undefined && !Number.isNaN(minimo) ? minimo : undefined,
          vence,
          vida_util:
            vidaUtil !== undefined && !Number.isNaN(vidaUtil)
              ? Math.trunc(vidaUtil)
              : undefined,
          stock,
        };

        const problema =
          nombre.length < 2
            ? "Falta el nombre."
            : !tipo
              ? 'El tipo tiene que decir "kg" o "unidad".'
              : precio === undefined
                ? "Falta el precio de venta."
                : Number.isNaN(precio) || precio < 0
                  ? "El precio no es un número válido."
                  : costo !== undefined && Number.isNaN(v.costo as number)
                    ? "El costo no es un número válido."
                    : Object.values(stock).some((n) => n < 0)
                      ? "El stock no puede ser negativo."
                      : undefined;

        if (problema) return { ...base, estado: "error" as Estado, problema };

        // Mismo orden de confianza que usa la base: PLU, después código de
        // barras, y recién después el nombre.
        const existente =
          (base.plu !== undefined ? porPlu.get(base.plu) : undefined) ??
          (barcode ? porBarcode.get(barcode) : undefined) ??
          porNombre.get(norm(nombre));

        return {
          ...base,
          estado: (existente ? "actualiza" : "nuevo") as Estado,
        };
      });

      setFilas(preview);
      setArchivo(file.name);
    } catch {
      toast.error("No pude leer el archivo. ¿Es un Excel o un CSV?");
    }
  }

  function confirmar() {
    if (!filas) return;
    const validas: FilaImportable[] = filas
      .filter((f) => f.estado !== "error")
      .map((f) => ({
        nombre: f.nombre,
        tipo: f.tipo!,
        precio: f.precio!,
        costo: f.costo,
        plu: f.plu,
        barcode: f.barcode,
        sku: f.sku,
        categoria: f.categoria,
        minimo: f.minimo,
        vence: f.vence,
        vida_util: f.vence ? f.vida_util : undefined,
        stock: Object.keys(f.stock).length > 0 ? f.stock : undefined,
      }));

    startEnviar(async () => {
      const res = await importarProductos(validas);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${res.creados} nuevos, ${res.actualizados} actualizados, ${res.ajustes_stock} ajustes de stock.`
      );
      if (res.sin_plu) {
        toast.warning(
          `${res.sin_plu} ${res.sin_plu === 1 ? "producto quedó" : "productos quedaron"} sin PLU. Buscalos en la balanza y completalos, o no se van a poder escanear.`,
          { duration: 8000 }
        );
      }
      setFilas(null);
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  const nuevos = filas?.filter((f) => f.estado === "nuevo").length ?? 0;
  const actualiza = filas?.filter((f) => f.estado === "actualiza").length ?? 0;
  const errores = filas?.filter((f) => f.estado === "error").length ?? 0;

  // Tailwind no puede ver una clase armada en runtime, y la cantidad de
  // columnas depende de cuántos locales haya: la grilla va por style.
  const gridCols = {
    gridTemplateColumns: `56px 88px minmax(0,1fr) 64px 72px 110px 110px ${stores
      .map(() => "96px")
      .join(" ")}`,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex min-w-64 grow flex-col gap-1">
          <p className="text-sm font-semibold">1. Bajate la plantilla</p>
          <p className="text-[13px] leading-relaxed text-muted">
            Trae los encabezados que el sistema entiende y una columna de stock
            por cada local. Si ya tenés tu lista, alcanza con que los encabezados
            se llamen igual.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={descargarPlantilla}>
          <Download className="size-4" strokeWidth={1.8} />
          Descargar plantilla
        </Button>
      </Card>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex min-w-64 grow flex-col gap-1">
          <p className="text-sm font-semibold">2. Subí el archivo</p>
          <p className="text-[13px] leading-relaxed text-muted">
            Excel o CSV. Te muestro qué va a pasar <strong>antes</strong> de tocar nada.
            {archivo && (
              <>
                {" "}
                Ahora estás mirando <strong>{archivo}</strong>.
              </>
            )}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) leerArchivo(f);
          }}
        />
        <Button type="button" variant="ghost" onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" strokeWidth={1.8} />
          {archivo ? "Elegir otro archivo" : "Elegir archivo"}
        </Button>
      </Card>

      {filas && (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge tone="ok">{nuevos} nuevos</Badge>
            <Badge tone="accent">{actualiza} se actualizan</Badge>
            {errores > 0 && <Badge tone="danger">{errores} con problemas</Badge>}
            <span className="grow" />
            {errores > 0 && (
              <span className="text-[12.5px] text-muted">
                Las filas con problemas se saltean.
              </span>
            )}
            {puedeEditar && (
              <Button
                type="button"
                onClick={confirmar}
                disabled={enviando || nuevos + actualiza === 0}
              >
                {enviando
                  ? "Importando…"
                  : `Importar ${nuevos + actualiza} ${nuevos + actualiza === 1 ? "producto" : "productos"}`}
              </Button>
            )}
          </div>

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              style={gridCols}
              className="grid shrink-0 border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] uppercase tracking-[0.055em] text-faint"
            >
              <div>Fila</div>
              <div>Estado</div>
              <div>Producto</div>
              <div>Tipo</div>
              <div className="text-right">PLU</div>
              <div className="text-right">Precio</div>
              <div className="text-right">Costo</div>
              {stores.map((s) => (
                <div key={s.id} className="text-right">
                  {s.name}
                </div>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {filas.map((f) => (
                <div
                  key={f.linea}
                  style={gridCols}
                  className={cn(
                    "grid items-center border-b border-line/60 px-4 py-2 text-[13px]",
                    f.estado === "error" && "bg-danger-bg/40"
                  )}
                >
                  <div className="tnum text-faint">{f.linea}</div>
                  <div>
                    {f.estado === "nuevo" && <Badge tone="ok">Nuevo</Badge>}
                    {f.estado === "actualiza" && <Badge tone="accent">Actualiza</Badge>}
                    {f.estado === "error" && <Badge tone="danger">Problema</Badge>}
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{f.nombre || "—"}</span>
                    {f.problema && (
                      <span className="truncate text-[11.5px] text-danger">{f.problema}</span>
                    )}
                    {!f.problema && f.categoria && (
                      <span className="truncate text-[11.5px] text-faint">{f.categoria}</span>
                    )}
                  </div>
                  <div className="text-muted">
                    {f.tipo === "kg" ? "kg" : f.tipo === "unidad" ? "unidad" : "—"}
                  </div>
                  {/* Sin PLU no se inventa ninguno: se marca para que lo
                      busquen en la balanza y lo completen. */}
                  <div
                    className={cn(
                      "tnum text-right",
                      f.plu === undefined && f.tipo === "kg" && f.estado !== "error"
                        ? "font-semibold text-warn"
                        : "text-muted"
                    )}
                    title={
                      f.plu === undefined && f.tipo === "kg"
                        ? "Se pesa pero la planilla no trae PLU: va a quedar sin etiqueta escaneable"
                        : undefined
                    }
                  >
                    {f.plu ?? (f.tipo === "kg" ? "falta" : "—")}
                  </div>
                  <div className="tnum text-right">
                    {f.precio !== undefined && !Number.isNaN(f.precio)
                      ? formatMoney(f.precio)
                      : "—"}
                  </div>
                  <div className="tnum text-right text-muted">
                    {f.costo !== undefined ? formatMoney(f.costo) : "—"}
                  </div>
                  {stores.map((s) => (
                    <div key={s.id} className="tnum text-right text-muted">
                      {f.stock[s.id] === undefined
                        ? "—"
                        : f.tipo === "kg"
                          ? formatKg(f.stock[s.id])
                          : formatNumber(f.stock[s.id])}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {!filas && (
        <Card className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            title="Todavía no subiste nada"
            description="Cuando elijas el archivo te voy a mostrar fila por fila qué se crea, qué se actualiza y qué está mal, antes de escribir nada en la base."
          >
            <Link href="/productos">
              <Button variant="ghost">Volver a Productos</Button>
            </Link>
          </EmptyState>
        </Card>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-card px-4 py-3">
        {filas && errores === 0 ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={1.8} />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.8} />
        )}
        <p className="text-[12.5px] leading-relaxed text-muted">
          <strong>El PLU sale de la balanza.</strong> Si la columna viene vacía el
          producto queda sin PLU: el sistema nunca inventa uno, porque un número
          inventado haría que la etiqueta escanee otro producto en el mostrador.
          {" · "}
          Las columnas de stock dicen <strong>cuánto hay</strong>, no cuánto sumar,
          así que reimportar la misma planilla no duplica nada.
          {" · "}
          El costo de la planilla solo se aplica mientras el producto nunca haya
          recibido una compra; después manda el promedio ponderado.
        </p>
      </div>
    </div>
  );
}

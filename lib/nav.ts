// Mapa de navegación. Archivo NEUTRO: lo importan el layout (servidor) y el
// sidebar (cliente), así que no puede traer nada de "server-only".
//
// El sidebar tiene 7 entradas, las que pidió el dueño. Compras y Producción
// viven adentro de Stock; Caja adentro del Punto de venta; Reportes adentro
// del Panel de ventas.

export type NavChild = {
  href: string;
  label: string;
  /** Permiso propio del sub-módulo, si difiere del padre. */
  module?: string;
};

export type NavItem = {
  href: string;
  label: string;
  /** Clave del permiso que lo habilita (ver lib/permissions.ts). */
  module: string;
  /** Nombre del icono de lucide-react, resuelto en el sidebar. */
  icon: "home" | "cart" | "chart" | "boxes" | "wallet" | "tag" | "sliders";
  children?: NavChild[];
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const NAV: NavSection[] = [
  {
    label: "Operación",
    items: [
      { href: "/", label: "Inicio", module: "inicio", icon: "home" },
      {
        href: "/pos",
        label: "Punto de venta",
        module: "pos",
        icon: "cart",
        children: [
          { href: "/pos", label: "Mostrador" },
          { href: "/pos/caja", label: "Caja del turno", module: "caja" },
          { href: "/pos/arqueos", label: "Historial de arqueos", module: "caja" },
        ],
      },
      {
        href: "/ventas",
        label: "Panel de ventas",
        module: "ventas",
        icon: "chart",
        children: [
          { href: "/ventas", label: "Ventas por local" },
          { href: "/ventas/devoluciones", label: "Devoluciones", module: "devoluciones" },
          { href: "/ventas/reportes", label: "Reportes", module: "reportes" },
        ],
      },
      {
        href: "/stock",
        label: "Stock",
        module: "stock",
        icon: "boxes",
        children: [
          { href: "/stock", label: "Existencias" },
          { href: "/stock/movimientos", label: "Movimientos" },
          { href: "/stock/ajustes", label: "Ajustes y merma" },
          { href: "/stock/transferencias", label: "Transferencias" },
          { href: "/stock/compras", label: "Compras", module: "compras" },
          { href: "/stock/produccion", label: "Producción", module: "produccion" },
          { href: "/stock/vencimientos", label: "Vencimientos" },
        ],
      },
    ],
  },
  {
    label: "Administración",
    items: [
      {
        href: "/gastos",
        label: "Pagos y gastos",
        module: "gastos",
        icon: "wallet",
        children: [
          { href: "/gastos", label: "Gastos del local" },
          { href: "/gastos/proveedores", label: "Pagos a proveedores" },
          { href: "/gastos/cuentas", label: "Cuentas y saldos" },
          { href: "/gastos/categorias", label: "Categorías de gasto" },
        ],
      },
      {
        href: "/productos",
        label: "Productos",
        module: "productos",
        icon: "tag",
        children: [
          { href: "/productos", label: "Listado" },
          { href: "/productos/categorias", label: "Categorías" },
          { href: "/productos/importar", label: "Importar desde Excel" },
          { href: "/productos/precios", label: "Precios y cartelería", module: "precios" },
        ],
      },
      {
        href: "/configuracion",
        label: "Configuración",
        module: "configuracion",
        icon: "sliders",
        children: [
          { href: "/configuracion", label: "Usuarios y roles" },
          { href: "/configuracion/locales", label: "Locales" },
          { href: "/configuracion/pagos", label: "Medios de pago" },
          { href: "/configuracion/balanzas", label: "Balanzas y código de barras" },
        ],
      },
    ],
  },
];

/** Todas las rutas del mapa, para chequear que exista la página. */
export function allHrefs(): string[] {
  const out: string[] = [];
  for (const section of NAV) {
    for (const item of section.items) {
      out.push(item.href);
      for (const child of item.children ?? []) out.push(child.href);
    }
  }
  return Array.from(new Set(out));
}

/** El item de nivel 1 que corresponde a una ruta ("/stock/compras" → Stock). */
export function activeItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const section of NAV) {
    for (const item of section.items) {
      const match =
        item.href === "/"
          ? pathname === "/"
          : pathname === item.href || pathname.startsWith(item.href + "/");
      if (match && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best;
}

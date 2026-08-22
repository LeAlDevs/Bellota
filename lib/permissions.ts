// Helpers puros de permisos (usables en server y client).
// Gatear SIEMPRE por permiso de módulo, no por nombre de rol.
// Excepción: acciones destructivas → is_admin() adentro de la función SQL.

export type Perms = Record<string, { view: boolean; edit: boolean }>;

/**
 * Módulos gateables. El sidebar tiene 7 entradas, pero adentro de Stock viven
 * Compras y Producción, y adentro del POS vive Caja: cada uno lleva su permiso
 * propio para poder darle el mostrador a un cajero sin darle las compras.
 */
export const MODULES: { key: string; label: string }[] = [
  { key: "inicio", label: "Inicio" },
  { key: "pos", label: "Punto de venta" },
  { key: "caja", label: "Caja y arqueo" },
  { key: "ventas", label: "Panel de ventas" },
  { key: "devoluciones", label: "Devoluciones" },
  { key: "stock", label: "Stock" },
  { key: "compras", label: "Compras" },
  { key: "produccion", label: "Producción y despiece" },
  { key: "gastos", label: "Pagos y gastos" },
  { key: "productos", label: "Productos" },
  { key: "precios", label: "Precios" },
  { key: "reportes", label: "Reportes" },
  { key: "configuracion", label: "Configuración" },
];

export function canView(perms: Perms, module: string): boolean {
  return perms[module]?.view === true;
}

export function canEdit(perms: Perms, module: string): boolean {
  return perms[module]?.edit === true;
}

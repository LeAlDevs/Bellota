// Formateo localizado es-AR. Toda la plata es ARS.
// Monotributo: los precios son FINALES, no se discrimina IVA en ningún lado.
//
// El server corre en UTC → fijar SIEMPRE la zona local al formatear timestamptz
// y al calcular "hoy". En una fiambrería que cierra caja de noche, sin esto el
// sistema cambia de día antes de que cierre el turno.

export const TZ = "America/Argentina/Buenos_Aires";

const moneyFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

const moneyRoundFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const numberFmt = new Intl.NumberFormat("es-AR");

const kgFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** $ 1.234,56 */
export function formatMoney(value: number | string): string {
  return moneyFmt.format(typeof value === "string" ? Number(value) : value);
}

/** $ 1.235 — para tarjetas del dashboard, donde los centavos son ruido. */
export function formatMoneyShort(value: number | string): string {
  return moneyRoundFmt.format(typeof value === "string" ? Number(value) : value);
}

/** 1.234 */
export function formatNumber(value: number | string): string {
  return numberFmt.format(typeof value === "string" ? Number(value) : value);
}

/**
 * 1,234 — tres decimales SIEMPRE. La balanza pesa en gramos y el stock es
 * numeric(12,3): mostrar menos decimales esconde diferencias reales.
 */
export function formatKg(value: number | string): string {
  return kgFmt.format(typeof value === "string" ? Number(value) : value);
}

/** Cantidad según el tipo de producto: kg con 3 decimales, unidad entera. */
export function formatQty(
  value: number | string,
  unitType: "kg" | "unidad"
): string {
  return unitType === "kg" ? formatKg(value) + " kg" : formatNumber(value);
}

/** Para columnas timestamptz: convierte a hora local de Buenos Aires. */
export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Para columnas timestamptz cuando solo interesa el día. */
export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * Para columnas date (día calendario puro, ej. vencimiento de un lote):
 * mostrar tal cual, SIN convertir zona, para no correr un día.
 */
export function formatCalendarDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return d + "/" + m + "/" + y;
}

/** "Hoy" en zona local (YYYY-MM-DD), para filtros de caja y cierres. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

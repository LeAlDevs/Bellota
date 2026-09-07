// Helpers del Panel de ventas. Archivo NEUTRO: lo usan páginas de servidor y
// componentes de cliente, así que no puede traer nada de "server-only".

import { todayLocal, TZ } from "@/lib/format";

export type SaleStatus = "completada" | "anulada";

/** Si el ticket de balanza se contrastó contra su código de total. */
export const SCALE_CHECK_LABEL: Record<string, string> = {
  sin_balanza: "Sin balanza",
  verificado: "Total verificado",
  sin_verificar: "Total sin verificar",
};

export type Rango = { desde: string; hasta: string };

/** Un día corrido hacia atrás en zona local, en formato YYYY-MM-DD. */
export function diasAtras(dias: number): string {
  const hoy = new Date();
  hoy.setUTCDate(hoy.getUTCDate() - dias);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(hoy);
}

/**
 * Rango de fechas de un filtro, con el default del que lo pide.
 *
 * Las fechas se comparan contra `created_at at time zone Buenos Aires` en la
 * base: acá alcanza con el día calendario, sin horas.
 */
export function rangoDeFechas(
  sp: { desde?: string; hasta?: string },
  defaultDesde: string = todayLocal()
): Rango {
  const hasta = sp.hasta || todayLocal();
  const desde = sp.desde || defaultDesde;
  // Si el usuario los da al revés, los doy vuelta en vez de devolver vacío.
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

/** "Hoy" / "Del 01/09 al 07/09", para el subtítulo de la página. */
export function textoDelRango(r: Rango): string {
  const corto = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
  if (r.desde === r.hasta) {
    return r.hasta === todayLocal() ? "Hoy" : `El ${corto(r.desde)}`;
  }
  return `Del ${corto(r.desde)} al ${corto(r.hasta)}`;
}

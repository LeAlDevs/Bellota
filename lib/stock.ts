// Etiquetas de los movimientos de stock. Archivo neutro: lo usan el servidor y
// el cliente, así que no puede traer nada de "server-only".

export type Reason =
  | "alta_inicial"
  | "compra"
  | "venta"
  | "devolucion"
  | "ajuste"
  | "merma"
  | "vencimiento"
  | "transferencia_salida"
  | "transferencia_entrada"
  | "produccion_consumo"
  | "produccion_alta"
  | "despiece_consumo"
  | "despiece_alta"
  | "anulacion_venta";

export const REASON_LABEL: Record<Reason, string> = {
  alta_inicial: "Alta inicial",
  compra: "Compra",
  venta: "Venta",
  devolucion: "Devolución",
  ajuste: "Ajuste",
  merma: "Merma",
  vencimiento: "Vencimiento",
  transferencia_salida: "Salió a otro local",
  transferencia_entrada: "Vino de otro local",
  produccion_consumo: "Consumo de producción",
  produccion_alta: "Alta de producción",
  despiece_consumo: "Entró al despiece",
  despiece_alta: "Salió del despiece",
  anulacion_venta: "Venta anulada",
};

export type Motive =
  | "vencido"
  | "roto"
  | "mal_estado"
  | "degustacion"
  | "error_de_carga"
  | "robo";

/**
 * Los motivos de merma. Que sea obligatorio elegir uno es lo que convierte
 * "se perdieron 14 kg" en "se perdieron 14 kg, el 62% por vencimiento" — que es
 * lo único que después te deja decidir algo.
 */
export const MOTIVES: { key: Motive; label: string; hint: string }[] = [
  { key: "vencido", label: "Se venció", hint: "Pasó la fecha antes de venderse" },
  { key: "mal_estado", label: "Mal estado", hint: "Se puso feo, cambió de color u olor" },
  { key: "roto", label: "Se rompió", hint: "Se cayó, se dañó el envase" },
  { key: "degustacion", label: "Degustación", hint: "Se dio a probar en el mostrador" },
  { key: "error_de_carga", label: "Error de carga", hint: "Se había cargado mal antes" },
  { key: "robo", label: "Faltante o robo", hint: "No aparece y no hay explicación" },
];

export const MOTIVE_LABEL: Record<Motive, string> = Object.fromEntries(
  MOTIVES.map((m) => [m.key, m.label])
) as Record<Motive, string>;

/** Los motivos que suman al reporte de "plata perdida". */
export function esSalidaDePlata(reason: string): boolean {
  return reason === "merma" || reason === "vencimiento";
}

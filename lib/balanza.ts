// Lectura de las etiquetas EAN-13 que imprimen las balanzas.
//
// Formato observado en los tickets de la balanza (02/09/2026, Fiambrería Bubi):
//
//     2 0 | P P P P | I I I I I I | C
//     └─┬─┘ └──┬───┘ └────┬─────┘ └┬┘
//    prefijo  PLU      importe   verificador
//                    en pesos, sin centavos
//
// Dos cosas que hay que tener presentes SIEMPRE al tocar este archivo:
//
//   1. La balanza embebe el IMPORTE, no el peso. Para saber los kilos hay que
//      dividir por el precio: kg = importe ÷ precio_por_kg. Eso significa que
//      el precio de la balanza y el de Bellota TIENEN que ser el mismo. Si
//      difieren, el cliente paga bien pero el stock se descuenta mal, y el
//      error no se nota hasta que alguien cuenta la góndola.
//
//   2. El código 2000 no es un producto: es el TOTAL de la operación. Trae
//      plata pero no trae productos, así que no sirve para cobrar — sirve para
//      verificar que no quedó ninguna línea sin escanear.
//
// El formato es configurable porque hay dos modelos de balanza y se configuran
// a mano: si mañana cambian los largos, se cambia acá y en Configuración, sin
// tocar el punto de venta.

export type FormatoBalanza = {
  /** Los dígitos con los que arranca toda etiqueta de balanza. */
  prefijo: string;
  largoPlu: number;
  largoImporte: number;
  /** Cuántos de los dígitos del importe son centavos. Hoy: 0. */
  decimalesImporte: number;
  /** El "PLU" que la balanza usa para el total de la operación. */
  pluTotal: number;
};

export const FORMATO_POR_DEFECTO: FormatoBalanza = {
  prefijo: "20",
  largoPlu: 4,
  largoImporte: 6,
  decimalesImporte: 0,
  pluTotal: 2000,
};

export type Etiqueta =
  | { tipo: "linea"; plu: number; importe: number; codigo: string }
  | { tipo: "total"; importe: number; codigo: string }
  | { tipo: "desconocido"; motivo: string; codigo: string };

/**
 * Dígito verificador de EAN-13: se suman los 12 primeros dígitos alternando
 * peso 1 y 3, y el verificador es lo que falta para llegar a la decena.
 */
export function digitoVerificadorEan13(doce: string): number {
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    suma += Number(doce[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (suma % 10)) % 10;
}

export function ean13Valido(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) return false;
  return digitoVerificadorEan13(codigo.slice(0, 12)) === Number(codigo[12]);
}

/**
 * Interpreta lo que tipeó la lectora. Devuelve `desconocido` en vez de tirar:
 * en el mostrador, un código que no se entiende tiene que dar un mensaje, no
 * romper la venta.
 */
export function leerEtiqueta(
  crudo: string,
  formato: FormatoBalanza = FORMATO_POR_DEFECTO
): Etiqueta {
  const codigo = crudo.replace(/\D/g, "");

  if (codigo.length !== 13) {
    return {
      tipo: "desconocido",
      motivo: `Tiene ${codigo.length} dígitos y una etiqueta de balanza tiene 13.`,
      codigo,
    };
  }

  if (!codigo.startsWith(formato.prefijo)) {
    return {
      tipo: "desconocido",
      motivo: "No arranca con el prefijo de balanza: debe ser un código de fábrica.",
      codigo,
    };
  }

  if (!ean13Valido(codigo)) {
    return {
      tipo: "desconocido",
      motivo: "El dígito verificador no cierra: la lectura salió mal, pasala de nuevo.",
      codigo,
    };
  }

  const desde = formato.prefijo.length;
  const plu = Number(codigo.slice(desde, desde + formato.largoPlu));
  const crudoImporte = codigo.slice(
    desde + formato.largoPlu,
    desde + formato.largoPlu + formato.largoImporte
  );
  const importe = Number(crudoImporte) / 10 ** formato.decimalesImporte;

  if (plu === formato.pluTotal) {
    return { tipo: "total", importe, codigo };
  }

  return { tipo: "linea", plu, importe, codigo };
}

/**
 * Kilos a partir del importe y el precio.
 *
 * La balanza redondea el importe a pesos enteros, así que el peso reconstruido
 * tiene un error de hasta medio peso dividido el precio — con un precio de
 * $13.000/kg son 0,04 gramos. Irrelevante.
 *
 * Lo que NO es irrelevante es que el precio no coincida: ahí el error es
 * proporcional a la diferencia y el stock se va desviando en silencio.
 */
export function pesoDesdeImporte(
  importe: number,
  precioPorKg: number
): { kg: number } | { error: string } {
  if (!Number.isFinite(precioPorKg) || precioPorKg <= 0) {
    return { error: "El producto no tiene precio cargado en Bellota." };
  }
  const kg = importe / precioPorKg;
  if (kg <= 0) return { error: "El importe de la etiqueta es cero." };
  if (kg > 100) {
    return {
      error: `Daría ${kg.toFixed(3)} kg, que no es un peso de mostrador. Puede que el precio de Bellota no sea el mismo que el de la balanza.`,
    };
  }
  return { kg: Math.round(kg * 1000) / 1000 };
}

/**
 * El PLU más grande que entra en el formato. Con 4 dígitos son 9999, y el
 * sistema no puede permitir cargar uno más alto: la etiqueta saldría con más
 * de 13 dígitos y se leería corrida.
 */
export function pluMaximo(formato: FormatoBalanza = FORMATO_POR_DEFECTO): number {
  return 10 ** formato.largoPlu - 1;
}

/** El importe más grande que entra en una línea o en el total. */
export function importeMaximo(formato: FormatoBalanza = FORMATO_POR_DEFECTO): number {
  return (10 ** formato.largoImporte - 1) / 10 ** formato.decimalesImporte;
}

/** Arma el código que imprimiría la balanza. Se usa para probar el parser. */
export function armarEtiqueta(
  plu: number,
  importe: number,
  formato: FormatoBalanza = FORMATO_POR_DEFECTO
): string {
  if (!Number.isInteger(plu) || plu < 0 || plu > pluMaximo(formato)) {
    throw new Error(
      `El PLU ${plu} no entra en ${formato.largoPlu} dígitos (máximo ${pluMaximo(formato)}).`
    );
  }
  const escalado = Math.round(importe * 10 ** formato.decimalesImporte);
  if (escalado < 0 || escalado >= 10 ** formato.largoImporte) {
    throw new Error(
      `El importe ${importe} no entra en ${formato.largoImporte} dígitos.`
    );
  }
  const cuerpo =
    formato.prefijo +
    String(plu).padStart(formato.largoPlu, "0") +
    String(escalado).padStart(formato.largoImporte, "0");
  return cuerpo + digitoVerificadorEan13(cuerpo);
}

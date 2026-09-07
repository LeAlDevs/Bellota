// Lectura de las etiquetas EAN-13 que imprimen las balanzas.
//
// Formato CONFIRMADO contra códigos escaneados de verdad (07/09/2026):
//
//   Línea de producto           Total de la operación
//   2 0 │PPPP│IIIIII│C          2 2 │0200│IIIIII│C
//   └┬─┘ └┬─┘ └──┬─┘            └┬─┘ └┬─┘ └──┬─┘
//  prefijo PLU  importe        prefijo fijo importe
//
// La balanza distingue la línea del total por el PREFIJO, no por el PLU: `20`
// es un producto y `22` es el total de la operación. (Yo había asumido que el
// total era una línea con un PLU reservado; el ticket dice otra cosa.)
//
// Dos cosas que hay que tener presentes SIEMPRE al tocar este archivo:
//
//   1. La balanza embebe el IMPORTE, no el peso. Para saber los kilos hay que
//      dividir por el precio: kg = importe ÷ precio_por_kg. Eso significa que
//      el precio de la balanza y el de Bellota TIENEN que ser el mismo. Si
//      difieren, el cliente paga bien pero el stock se descuenta mal, y el
//      error no se nota hasta que alguien cuenta la góndola.
//
//      La prueba está en el ticket 95-25138: dos líneas de 0,200 kg cada una,
//      con códigos DISTINTOS (…026007 y …028008). Si llevaran el peso, los dos
//      dirían 000200.
//
//   2. El código del total trae plata pero no trae productos: no sirve para
//      cobrar, sirve para verificar que no quedó ninguna línea sin escanear.
//
// El formato es configurable porque hay dos modelos de balanza y se configuran
// a mano: si mañana cambian los largos, se cambia acá y en Configuración, sin
// tocar el punto de venta.

export type FormatoBalanza = {
  /**
   * Prefijos que identifican una LÍNEA de producto.
   *
   * Solo está el `20`, que es el único confirmado con un ticket en la mano. El
   * manual de la línea Cuora menciona un `21` para lo que se vende por unidad,
   * pero todavía no lo vi impreso: si aparece, el mostrador va a decir "no
   * reconozco el código" y se agrega acá con la evidencia. Aceptar un prefijo
   * sin confirmarlo es peor — cargaría una línea equivocada en silencio.
   */
  prefijosLinea: string[];
  /** Prefijo del código del TOTAL de la operación. */
  prefijoTotal: string;
  /** Dígitos que ocupa el PLU dentro de la línea. */
  largoPlu: number;
  largoImporte: number;
  /** Cuántos de los dígitos del importe son centavos. Hoy: 0. */
  decimalesImporte: number;
};

export const FORMATO_POR_DEFECTO: FormatoBalanza = {
  prefijosLinea: ["20"],
  prefijoTotal: "22",
  largoPlu: 4,
  largoImporte: 6,
  decimalesImporte: 0,
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

  const esTotal = codigo.startsWith(formato.prefijoTotal);
  const prefijoLinea = formato.prefijosLinea.find((p) => codigo.startsWith(p));

  if (!esTotal && !prefijoLinea) {
    return {
      tipo: "desconocido",
      motivo: "No arranca con un prefijo de balanza: debe ser un código de fábrica.",
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

  /* El importe ocupa siempre los mismos lugares: los `largoImporte` dígitos
     que están justo antes del verificador. Vale igual para la línea y para el
     total, así que no hace falta saber qué significa el campo del medio del
     total (en los tickets vistos es siempre 0200). */
  const desdeImporte = 12 - formato.largoImporte;
  const importe =
    Number(codigo.slice(desdeImporte, 12)) / 10 ** formato.decimalesImporte;

  if (esTotal) {
    return { tipo: "total", importe, codigo };
  }

  const desdePlu = prefijoLinea!.length;
  const plu = Number(codigo.slice(desdePlu, desdePlu + formato.largoPlu));

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

function importeEnDigitos(importe: number, formato: FormatoBalanza): string {
  const escalado = Math.round(importe * 10 ** formato.decimalesImporte);
  if (escalado < 0 || escalado >= 10 ** formato.largoImporte) {
    throw new Error(
      `El importe ${importe} no entra en ${formato.largoImporte} dígitos.`
    );
  }
  return String(escalado).padStart(formato.largoImporte, "0");
}

/** Arma el código de una línea, como lo imprimiría la balanza. */
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
  const cuerpo =
    formato.prefijosLinea[0] +
    String(plu).padStart(formato.largoPlu, "0") +
    importeEnDigitos(importe, formato);
  return cuerpo + digitoVerificadorEan13(cuerpo);
}

/** Arma el código del total de una operación. */
export function armarEtiquetaTotal(
  importe: number,
  formato: FormatoBalanza = FORMATO_POR_DEFECTO
): string {
  const relleno = 12 - formato.prefijoTotal.length - formato.largoImporte;
  const cuerpo =
    formato.prefijoTotal +
    "0200".slice(0, relleno).padEnd(relleno, "0") +
    importeEnDigitos(importe, formato);
  return cuerpo + digitoVerificadorEan13(cuerpo);
}

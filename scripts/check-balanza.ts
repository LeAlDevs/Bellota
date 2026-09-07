// Prueba el formato de etiqueta de las balanzas.
//
//   npm run check:balanza
//
// SOBRE QUÉ PRUEBA ESTO Y QUÉ NO:
//
// El formato se dedujo de una FOTO de dos tickets reales (02/09/2026,
// Fiambrería Bubi). De la foto se leen bien la descripción, el PLU, el peso, el
// precio y el importe; los códigos de barras se leen a medias.
//
// Lo que sigue verifica dos cosas distintas, y conviene no confundirlas:
//
//   1. Que el parser sea consistente: lo que arma, lo lee igual. Eso se prueba
//      solo y siempre pasa o falla de verdad.
//
//   2. Que el formato sea EL de la balanza. Eso NO se puede probar contra una
//      foto: construir el código con mi hipótesis y después validar su propio
//      dígito verificador es un razonamiento circular. Se cierra cargando los
//      códigos reales en CODIGOS_REALES, escaneándolos con la lectora sobre un
//      bloc de notas. Mientras esa lista esté vacía, el script lo dice.

import {
  armarEtiqueta,
  ean13Valido,
  leerEtiqueta,
  pesoDesdeImporte,
  pluMaximo,
  FORMATO_POR_DEFECTO,
} from "../lib/balanza.ts";

type Linea = { plu: number; nombre: string; kg: number; precio: number; importe: number };
type Ticket = { operacion: string; hora: string; lineas: Linea[]; total: number };

/** Lo que se lee en letras en los dos tickets. Esto sí es confiable. */
const TICKETS: Ticket[] = [
  {
    operacion: "95-25046",
    hora: "19:58",
    lineas: [
      { plu: 98, nombre: "CRUDO OS", kg: 0.28, precio: 15000, importe: 4200 },
      { plu: 97, nombre: "CRUDO LOS MONTES", kg: 0.28, precio: 13000, importe: 3640 },
    ],
    total: 7840,
  },
  {
    operacion: "90-15919",
    hora: "20:25",
    lineas: [
      { plu: 97, nombre: "CRUDO LOS MONTES", kg: 0.125, precio: 13000, importe: 1625 },
      { plu: 101, nombre: "CRUDO C/ PIMENTON", kg: 0.125, precio: 25000, importe: 3125 },
    ],
    total: 4750,
  },
];

/**
 * Códigos escaneados con la lectora, tal cual los tipeó sobre un bloc de notas.
 * Formato: { codigo: "2000970036403", esperado: { plu: 97, importe: 3640 } }
 * Con esto cargado, el formato queda probado de verdad.
 */
const CODIGOS_REALES: { codigo: string; esperado: { plu: number; importe: number } }[] = [
  // Ticket 95-25138 del 07/09/2026, de la prueba de venta real.
  // Las dos líneas pesaron 0,200 kg y los códigos son DISTINTOS: lo que llevan
  // es el importe, no el peso.
  { codigo: "2000650026007", esperado: { plu: 65, importe: 2600 } },
  { codigo: "2000660028008", esperado: { plu: 66, importe: 2800 } },
];

let fallas = 0;

function paso(label: string, fn: () => string | void) {
  try {
    const r = fn();
    console.log(`  ok    ${label}${r ? " -> " + r : ""}`);
  } catch (e) {
    fallas++;
    console.log(`  FALLA ${label}`);
    console.log(`        ${(e as Error).message}`);
  }
}

const f = FORMATO_POR_DEFECTO;
console.log("Formato bajo prueba (hipótesis sacada de la foto):");
console.log(
  `  ${f.prefijo} + PLU(${f.largoPlu}) + importe(${f.largoImporte}) + verificador · ` +
    `el PLU ${f.pluTotal} es el total de la operación`
);
console.log(`  PLU máximo que entra en este formato: ${pluMaximo(f)}\n`);

// ── 1. El parser es consistente consigo mismo ────────────────────────
console.log("El parser lee lo que arma:");

for (const t of TICKETS) {
  for (const l of t.lineas) {
    paso(`PLU ${l.plu} · $${l.importe}`, () => {
      const codigo = armarEtiqueta(l.plu, l.importe);
      if (!ean13Valido(codigo)) throw new Error(`el verificador de ${codigo} no cierra`);
      const et = leerEtiqueta(codigo);
      if (et.tipo !== "linea") throw new Error(`lo leyó como ${et.tipo}`);
      if (et.plu !== l.plu) throw new Error(`sacó PLU ${et.plu}`);
      if (et.importe !== l.importe) throw new Error(`sacó importe ${et.importe}`);
      return codigo;
    });
  }
  paso(`TOTAL $${t.total}`, () => {
    const codigo = armarEtiqueta(f.pluTotal, t.total);
    const et = leerEtiqueta(codigo);
    if (et.tipo !== "total") throw new Error(`lo leyó como ${et.tipo}`);
    if (et.importe !== t.total) throw new Error(`sacó ${et.importe}`);
    return codigo;
  });
}

// ── 2. Las cuentas del ticket cierran ────────────────────────────────
console.log("\nLas cuentas de los tickets cierran:");

for (const t of TICKETS) {
  for (const l of t.lineas) {
    paso(`${l.nombre}: ${l.kg} kg × $${l.precio} = $${l.importe}`, () => {
      if (Math.abs(l.kg * l.precio - l.importe) > 0.5) {
        throw new Error(`da ${l.kg * l.precio}`);
      }
      const r = pesoDesdeImporte(l.importe, l.precio);
      if ("error" in r) throw new Error(r.error);
      if (Math.abs(r.kg - l.kg) > 0.0005) {
        throw new Error(`el peso reconstruido da ${r.kg} kg`);
      }
      return `y al revés: $${l.importe} ÷ $${l.precio} = ${r.kg} kg`;
    });
  }
  paso(`Ticket ${t.operacion}: las líneas suman el total`, () => {
    const suma = t.lineas.reduce((a, l) => a + l.importe, 0);
    if (suma !== t.total) throw new Error(`suman ${suma} y el total dice ${t.total}`);
    return `$${suma}`;
  });
}

// ── 3. Casos borde ───────────────────────────────────────────────────
console.log("\nCasos borde:");

paso("un código de fábrica no se confunde con una etiqueta", () => {
  const et = leerEtiqueta("7791234567890");
  if (et.tipo !== "desconocido") throw new Error(`lo leyó como ${et.tipo}`);
  return "cae en desconocido";
});

paso("una lectura con un dígito cambiado se rechaza", () => {
  const bueno = armarEtiqueta(97, 3640);
  const malo = bueno.slice(0, 5) + (bueno[5] === "9" ? "8" : "9") + bueno.slice(6);
  if (leerEtiqueta(malo).tipo !== "desconocido") throw new Error("se la tragó igual");
  return "el verificador la caza";
});

paso("si el precio de Bellota no es el de la balanza, el stock se desvía", () => {
  const bien = pesoDesdeImporte(3640, 13000);
  const mal = pesoDesdeImporte(3640, 14000);
  if ("error" in bien || "error" in mal) throw new Error("no calculó");
  const g = Math.abs(mal.kg - bien.kg) * 1000;
  if (g < 5) throw new Error("no refleja la diferencia");
  return `0,280 kg contra ${mal.kg} kg: ${g.toFixed(0)} g de desvío por venta`;
});

paso("un peso imposible se frena en vez de cargarse", () => {
  const r = pesoDesdeImporte(4200, 10);
  if (!("error" in r)) throw new Error("dejó pasar 420 kg");
  return "avisa";
});

paso("armarEtiqueta rechaza un PLU que no entra en el formato", () => {
  try {
    armarEtiqueta(pluMaximo(f) + 1, 1000);
  } catch {
    return `no deja pasar del ${pluMaximo(f)}`;
  }
  throw new Error("armó un código de más de 13 dígitos sin avisar");
});

paso("armarEtiqueta rechaza un importe que no entra", () => {
  try {
    armarEtiqueta(97, 10 ** f.largoImporte);
  } catch {
    return `el tope por línea es $${(10 ** f.largoImporte - 1).toLocaleString("es-AR")}`;
  }
  throw new Error("desbordó el importe sin avisar");
});

// ── 4. Contra los códigos reales, si están cargados ──────────────────
console.log("\nContra códigos escaneados de verdad:");

if (CODIGOS_REALES.length === 0) {
  console.log(
    "  PENDIENTE  No hay ninguno cargado todavía, así que el formato sigue siendo\n" +
      "             una hipótesis: coincide con lo que se ve en la foto, pero eso no\n" +
      "             alcanza para darlo por cerrado. Para confirmarlo: escanear cada\n" +
      "             código de barras del ticket con la lectora sobre un bloc de notas\n" +
      "             y cargar los dígitos en CODIGOS_REALES, arriba en este archivo."
  );
} else {
  for (const c of CODIGOS_REALES) {
    paso(`${c.codigo}`, () => {
      if (!ean13Valido(c.codigo)) {
        throw new Error("el verificador no cierra: revisá que esté bien copiado");
      }
      const et = leerEtiqueta(c.codigo);
      if (et.tipo === "desconocido") throw new Error(et.motivo);
      if (et.tipo === "total") {
        throw new Error(`lo leyó como el total de la operación, no como el PLU ${c.esperado.plu}`);
      }
      if (et.plu !== c.esperado.plu) {
        throw new Error(`sacó PLU ${et.plu} y el ticket dice ${c.esperado.plu}`);
      }
      if (et.importe !== c.esperado.importe) {
        throw new Error(`sacó $${et.importe} y el ticket dice $${c.esperado.importe}`);
      }
      return `PLU ${et.plu} · $${et.importe}`;
    });
  }
}

console.log(fallas === 0 ? "\nTodo verde." : `\n${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);

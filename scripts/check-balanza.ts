// Prueba el formato de etiqueta de las balanzas.
//
//   npm run check:balanza
//
// El formato quedó CONFIRMADO el 07/09/2026 contra códigos escaneados con la
// lectora, no contra una foto: están abajo, en CODIGOS_REALES.
//
// Dos cosas que salieron de esa confirmación y que yo había supuesto mal:
//
//   1. El total NO es una línea con un PLU reservado. Se distingue por el
//      PREFIJO: `20` es un producto, `22` es el total de la operación.
//
//   2. Por lo mismo, no hay ningún PLU prohibido. Había bloqueado el 2000 sin
//      necesidad.

import {
  armarEtiqueta,
  armarEtiquetaTotal,
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
 * Sin `plu`, la fila es el código del total de la operación.
 */
const CODIGOS_REALES: {
  codigo: string;
  esperado: { plu?: number; importe: number };
}[] = [
  // Ticket 95-25138 del 07/09/2026, de la primera prueba de venta real.
  //
  // Las dos líneas pesaron 0,200 kg y los códigos son DISTINTOS: uno termina en
  // 2600 y el otro en 2800, que son los dos importes. Si llevaran el peso, los
  // dos dirían 000200. Es la prueba de que el código trae plata, no kilos.
  { codigo: "2000650026007", esperado: { plu: 65, importe: 2600 } },
  { codigo: "2000660028008", esperado: { plu: 66, importe: 2800 } },
  { codigo: "2202000054009", esperado: { importe: 5400 } },
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
  `  línea: ${f.prefijosLinea.join("/")} + PLU(${f.largoPlu}) + importe(${f.largoImporte}) + verificador\n` +
    `  total: ${f.prefijoTotal} + relleno + importe(${f.largoImporte}) + verificador`
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
    const codigo = armarEtiquetaTotal(t.total);
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

paso("el total y la línea no se confunden entre sí", () => {
  const linea = leerEtiqueta(armarEtiqueta(2000, 5400));
  const total = leerEtiqueta(armarEtiquetaTotal(5400));
  if (linea.tipo !== "linea") throw new Error("leyó la línea como " + linea.tipo);
  if (total.tipo !== "total") throw new Error("leyó el total como " + total.tipo);
  if (linea.codigo === total.codigo) throw new Error("salieron iguales");
  return `${linea.codigo} es producto, ${total.codigo} es total`;
});

paso("el PLU 2000 ya no está prohibido", () => {
  // Estaba bloqueado por una suposición mía que el ticket real desmintió: el
  // total se marca con el prefijo 22, no con un PLU reservado.
  const et = leerEtiqueta(armarEtiqueta(2000, 1000));
  if (et.tipo !== "linea" || et.plu !== 2000) {
    throw new Error("lo leyó como " + et.tipo);
  }
  return "es un PLU como cualquier otro";
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
    "  PENDIENTE  No hay ninguno cargado: el formato volvería a ser una hipótesis.\n" +
      "             Se confirman escaneando los códigos con la lectora sobre un bloc\n" +
      "             de notas y cargándolos en CODIGOS_REALES, arriba en este archivo."
  );
} else {
  for (const c of CODIGOS_REALES) {
    paso(`${c.codigo}`, () => {
      if (!ean13Valido(c.codigo)) {
        throw new Error("el verificador no cierra: revisá que esté bien copiado");
      }
      const et = leerEtiqueta(c.codigo);
      if (et.tipo === "desconocido") throw new Error(et.motivo);

      const esperaTotal = c.esperado.plu === undefined;
      if (esperaTotal && et.tipo !== "total") {
        throw new Error(`es el total del ticket y lo leyó como ${et.tipo}`);
      }
      if (!esperaTotal && et.tipo !== "linea") {
        throw new Error(`es la línea del PLU ${c.esperado.plu} y lo leyó como ${et.tipo}`);
      }
      if (et.tipo === "linea" && et.plu !== c.esperado.plu) {
        throw new Error(`sacó PLU ${et.plu} y el ticket dice ${c.esperado.plu}`);
      }
      if (et.importe !== c.esperado.importe) {
        throw new Error(`sacó $${et.importe} y el ticket dice $${c.esperado.importe}`);
      }
      return et.tipo === "total"
        ? `TOTAL $${et.importe}`
        : `PLU ${et.plu} · $${et.importe}`;
    });
  }
}

console.log(fallas === 0 ? "\nTodo verde." : `\n${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);

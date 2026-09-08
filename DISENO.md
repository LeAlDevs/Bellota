# Bellota — Documento de diseño

ERP administrativo, contable y de punto de venta para **Ibérico**, cadena de fiambrerías
con 2 locales: **Ramos** y **Mosconi**.

> Sucesor del proyecto que veníamos diseñando como *Toro*. Mismo negocio, mismas
> decisiones de fondo, con la estructura de módulos redefinida por el dueño y un
> módulo nuevo: **Pagos y gastos del local**.

Estado: **diseño para validar. Nada de código hasta que esto esté aprobado.**

---

## 1. Qué resuelve Bellota

Las balanzas **sí tienen catálogo**: cada producto tiene su PLU cargado. El problema es
que hoy no se usa — se pesa contra un genérico y el ticket sale diciendo **"Varios"**, con
el precio tipeado a mano en cada pesada. Así, no hay stock, no hay costo y no se sabe qué
se vende: la información del negocio existe en las balanzas pero no llega a ningún lado.

> Corregido el 22/08/2026. Antes este documento decía que las balanzas no tenían catálogo
> y que Bellota inventaba los PLU. Es al revés, y la diferencia no es menor: **un PLU
> inventado hace que la etiqueta escanee el producto equivocado en el mostrador.** Bellota
> recibe los PLU que ya existen; solo propone uno libre cuando el producto es nuevo y
> todavía no está cargado en las balanzas.

Bellota tiene que dar, en este orden de importancia:

1. **Saber qué se vende y cuánto deja** — ventas y margen por producto, por local, por hora.
2. **Stock real en un rubro donde el stock nunca cierra solo** — con merma, despiece y
   elaborados como circuitos de primera clase, no como ajustes manuales.
3. **Un mostrador rápido** — el POS no puede ser más lento que la fila.
4. **Saber en qué se va la plata** — gastos del local separados de la mercadería.
5. **Un solo lugar donde se carga el precio** — y de ahí baja a las 4 balanzas.

---

## 2. Decisiones cerradas

| Tema | Decisión |
|---|---|
| Locales | **Ramos** y **Mosconi**, ambos con POS. El stock vive en el local (no hay depósito separado). |
| Usuarios | Cada usuario tiene un local asignado. **Ve** los dos, **opera el POS solo en el suyo**. |
| Fiscal | Monotributo, **no se discrimina IVA**, precios finales. Cada venta lleva flag **fiscal / no fiscal**. Ambas mueven stock y caja; solo las fiscales van a facturación. |
| Cuenta corriente de clientes | **No existe.** No se vende fiado. |
| Cliente | Opcional y liviano: email/teléfono al cerrar la venta, para el ticket y para marketing. |
| Caja | 1 por local, apertura/cierre diario por cajero, arqueo abierto (el cajero ve lo esperado). |
| Ticket | **No hay impresora térmica** (confirmado 2026-08-22). El ticket se **envía por email**. |
| Offline | **No hay POS offline.** Si se cae internet, se vende desde el celular (4G propio). |
| Celulares | iPhone → escaneo por cámara con librería JS. POS responsive real, usable a 390px. |
| Precio | Único por producto, igual en los 2 locales. |
| Costo | **Promedio ponderado**, único a nivel empresa, recalculado en cada recepción. |
| Despiece | Costo repartido **por peso**, editable a mano. Se guarda rinde esperado vs. real. |
| Vencimientos | Lotes **opcionales** por producto. Sin FEFO obligatorio en el mostrador. |
| Gastos | Pueden pagarse **por caja (efectivo) o por banco/transferencia**. Cada gasto lleva el flag. |
| Stack | Next.js + TypeScript + Tailwind v4 + Supabase (Postgres/RLS) + Vercel. Español rioplatense. |

### Infraestructura

| Recurso | Valor |
|---|---|
| Supabase | Proyecto **Bellota** · ref `loxvhnwvannpaqlxfwyq` · `https://loxvhnwvannpaqlxfwyq.supabase.co` |
| GitHub | Cuenta `sondigitalagency@gmail.com` · org **LeAlDevs** (reusada, se limpia y arranca de 0) |
| Deploy | Vercel, push a `main` |
| Dominio | `distribuidoraiberico.com.ar` (remitente de tickets, vía Resend) |
| Puerto dev local | **3006** |

> Si conviven varias cuentas de GitHub en esta máquina, para evitar 403:
> `git config --global credential.https://github.com.useHttpPath true`

---

## 3. Los 7 módulos

El sidebar tiene exactamente los 7 que pediste. Compras, Producción y Caja **no son
módulos nuevos**: viven adentro del módulo al que pertenecen conceptualmente.

| # | Módulo | Pestañas |
|---|---|---|
| 1 | **Inicio** | Dashboard |
| 2 | **Punto de venta y cobros** | Mostrador · **Caja (turno)** · Historial de arqueos |
| 3 | **Panel de ventas** | Ventas por local · Detalle y anulación · Devoluciones · **Reportes** |
| 4 | **Stock** | Existencias · Movimientos · Ajustes y **merma** · Transferencias · **Compras** · **Producción** · Vencimientos |
| 5 | **Pagos y gastos** | Gastos del local · Pagos a proveedores · Cuentas y saldos · Categorías de gasto |
| 6 | **Productos** | Listado · Ficha · Alta/edición · Categorías · **Importar Excel** · Precios y cartelería |
| 7 | **Configuración** | Usuarios y roles · Locales · Medios de pago · Formato de código de barras · Balanzas · Datos de la empresa |

### 3.1 Inicio (dashboard)

Crece por fase. Al final tiene:

- **Ventas de hoy por local**, comparadas contra ayer y contra el mismo día de la semana pasada
- **Ticket promedio** y cantidad de tickets por local
- **Artículos con stock bajo** (por debajo de `min_stock`), por local
- **Próximos vencimientos** por local
- **Cajas sin cerrar** (turnos abiertos de días anteriores → alerta roja)
- **Gastos del mes** vs. mes anterior
- **Ranking de los 10 más vendidos** (en kg y en plata) de la semana
- **Margen del día** (ventas − CMV con costo del momento)

---

## 4. Modelo de datos

### 4.1 Base

`organizations` · `profiles` (+ `store_id`, `role_id`) · `roles` · `role_permissions`
Multi-tenant con RLS por organización desde el día uno. Ibérico es una sola
empresa, pero la estructura queda por si mañana hay una segunda razón social.

`stores` — id, nombre, `email`, `has_pos`, activo. Un depósito central futuro entra
acá con `has_pos = false`.

| Local | Email |
|---|---|
| Ramos | `ibericoramos@distribuidoraiberico.com.ar` |
| Mosconi | `ibericomosconi@distribuidoraiberico.com.ar` |

### 4.2 Productos

`products`
- `name`, `description`, `category_id`
- **`unit_type`**: `kg` | `unidad` — la decisión que atraviesa todo el sistema
- `barcode` (EAN del fabricante, para envasados), `sku` (interno)
- **`kind`**: `simple` (se compra y se vende) | `elaborado` (se produce) | `combo` (promo)
- `cost` — costo manual (ver §4.5: se avisa la diferencia contra la factura, no se pisa)
- `track_expiry`, `shelf_life_days`
- `min_stock` (alerta de reposición), `is_active`

`product_presentations` — **formas de venderlo** (migración 0012)

El mismo queso vale distinto según cómo se lo lleven: fraccionado tiene un precio y la
horma entera otro, más barato por kilo. **No es un descuento por cantidad**: 3 kg feteados
no tienen el precio de horma, porque ahí sí hay merma de puntas y trabajo de fetear. Es
otra forma de vender la misma mercadería.

- `product_id`, `name` ("Fraccionado", "Horma entera", "Media horma")
- **`plu`** (int, **nullable**, único en toda la organización) — el código corto que ya tiene
  cargado la balanza **para este precio**. Lo trae el negocio, no lo inventa Bellota. Queda
  vacío en lo que nunca pasa por balanza (envasados de fábrica con su propio EAN).
- `price` — precio final de venta, por kg o por unidad
- `min_qty` — desde cuánto tiene sentido. Una horma no son 200 g: por debajo, el mostrador
  avisa (no bloquea: frenar la cola es peor, y la línea se puede sacar).
- `is_default` — la que se usa al buscar por nombre o escanear un EAN de fábrica. Un índice
  único garantiza **exactamente una** por producto.
- `sort_order`, `is_active`

> **Por qué el PLU y el precio se mudaron acá y no se duplicó el producto.** "Sardo" y
> "Sardo horma" como dos productos es lo más rápido y es una trampa: dos stocks del mismo
> queso que habría que transferir a mano cada vez que se abre una horma, dos costos que hay
> que acordarse de cambiar juntos, y un margen partido en dos líneas donde ninguna contesta
> "¿cuánto me deja el sardo?". Con presentaciones hay **un producto, un stock, un costo,
> los mismos lotes**, y lo único que cambia es el precio y el número que imprime la etiqueta.
>
> **Por qué se mudó entero y no quedó también en `products`.** Si el PLU viviera en dos
> tablas haría falta un trigger en cada una para garantizar que no se repita, y un PLU
> repetido es exactamente el bug que hace que una etiqueta escanee el producto equivocado.
> En una sola tabla lo resuelve un índice único y no hay nada que recordar.
>
> **Consecuencia para la fase 9:** el archivo que hay que exportarle a Qendra es la lista de
> presentaciones, no la de productos. Un PLU con su precio es justo lo que la balanza espera.

`sale_items.presentation_id` guarda con cuál se cobró: sin eso, dentro de un mes no hay forma
de saber si esos 3 kg salieron a precio de horma o si alguien erró el PLU en la balanza.
- `tax_rate` — **nullable, dormida.** Sin UI. Seguro barato por si pasan a Responsable Inscripto.

`categories` — catálogo editable.

**Importación desde Excel** (carga inicial y altas masivas):

| Columna | Obligatoria | Nota |
|---|---|---|
| Nombre | sí | |
| PLU | no | El de la balanza. **Si viene vacío el producto queda sin PLU: nunca se inventa uno.** |
| Código de barras | no | El EAN de fábrica de los envasados |
| SKU | no | Código interno, opcional |
| **Tipo** | sí | `kg` o `unidad`. **Es la columna que gobierna todo el sistema.** |
| Costo | no | Costo inicial; solo se aplica mientras el producto nunca haya recibido una compra |
| Precio de venta | sí | |
| Stock Ramos | no | **Cuánto hay**, no cuánto sumar |
| Stock Mosconi | no | Ídem |
| Categoría | no | Se crea sola si no existe |
| Vence | no | `sí`/`no` → activa el control de lotes |

Plantilla descargable desde el sistema. La importación muestra **vista previa** (qué crea,
qué actualiza, qué está mal) antes de confirmar.

**Matcheo, por orden de confianza: PLU → código de barras → nombre.** Las columnas de stock
dicen cuánto hay, así que reimportar la misma planilla no duplica productos ni suma el stock
dos veces.

> **Por qué el PLU va aparte del SKU y del código de barras:** son tres identificadores para
> tres circuitos distintos. El **PLU** es el número corto que la balanza imprime dentro de la
> etiqueta de peso variable. El **código de barras** es el EAN que ya trae el paquete de
> fábrica. El **SKU** es interno y no lo lee ninguna máquina. Un producto puede tener uno,
> otro, o los dos primeros.
>
> El PLU **nunca se reutiliza**, aunque se dé de baja el producto: si se recicla, una etiqueta
> vieja pegada en un paquete escanea el producto equivocado. Por eso el contador de
> sugerencias solo avanza, nunca vuelve atrás.

### 4.3 Stock

- `stock` — (store_id, product_id) → `qty numeric(12,3)`. **Decimales, no enteros.**
- `stock_movements` — `delta`, `reason`, referencia al documento origen, costo del momento,
  usuario, fecha.
  Motivos: `alta_inicial`, `compra`, `venta`, `devolucion`, `ajuste`, `merma`, `vencimiento`,
  `transferencia_salida`, `transferencia_entrada`, `produccion_consumo`, `produccion_alta`,
  `despiece_consumo`, `despiece_alta`, `anulacion_venta`.
- RPC atómica `adjust_stock(store, product, delta, reason, ref, nota)` —
  **ningún camino escribe `stock` directo.**

**Merma** — es un ajuste con motivo obligatorio: `vencido`, `roto`, `mal_estado`,
`degustacion`, `error_de_carga`, `robo`. Cada merma guarda el costo del momento, así el
reporte dice **cuánta plata se perdió**, no cuántos kilos.

**Lotes y vencimiento** (solo productos con `track_expiry`)
- `stock_lots` — local, producto, código de lote, `expires_on`, cantidad inicial y remanente,
  costo, origen (recepción o producción).
- El stock maestro sigue siendo `stock`. Los lotes son para **alertar** y para **dar de baja
  lo vencido**, no para forzar al cajero a elegir lote en cada venta.

**Transferencias** — `transfers` + `transfer_items` → RPC atómica que valida stock en origen,
descuenta y acredita, y deja los dos movimientos.

### 4.4 Compras (dentro de Stock)

- `suppliers`
- `purchases` — proveedor, fecha, `has_invoice` + número, estado (`borrador` / `confirmada`),
  total, **condición de pago** (`contado` / `cuenta_corriente`). **Sin local en la cabecera.**
- `purchase_items` — producto, `qty_pedida`, **`qty_recibida` (peso real)**, `unit_cost`, subtotal.
- **`purchase_item_allocations`** — línea de compra, local, cantidad.

**Una compra puede repartirse entre los dos locales.** El destino va **por línea**, no por
documento: llegan 20 kg de jamón y se reparten 12 a Ramos y 8 a Mosconi. En el formulario,
cada línea tiene una columna por local y se valida que la suma cierre con el total recibido.

Al **confirmar** la recepción, en una sola transacción: entra el stock **en cada local según
su asignación**, se recalcula el costo promedio ponderado **sobre el total recibido** (el costo
es único a nivel empresa) y se crea un lote por local si el producto lleva vencimiento.

```
costo_nuevo = (stock_total × costo_actual + qty_recibida × costo_compra)
              ÷ (stock_total + qty_recibida)
```

> Se piden 10 kg y llegan 9,8. **Lo que manda es lo que llegó.** Por eso el documento que
> mueve stock y costo es la **recepción**, no la orden de compra.

Si la compra es a **cuenta corriente**, genera deuda con el proveedor, que se cancela desde
**Pagos y gastos** (§4.7).

### 4.5 Producción: despiece y elaborados (dentro de Stock)

Es lo que hace que Bellota sea un ERP de fiambrería y no un POS genérico.
**Una sola estructura cubre los dos casos:**

- `recipes` — nombre, tipo (`despiece` | `elaborado`), activa
- `recipe_lines` — receta, producto, `role` (`input` | `output`), cantidad, **`pct_esperado`**
  - *Despiece*: 1 input → N outputs. Las salidas llevan el **rinde esperado**
    (jamón crudo → 62% fetas, 13% puntas, 25% merma).
  - *Elaborado*: N inputs → 1 output. Las entradas son los componentes de la picada o bandeja.
- `production_orders` — local, tipo, fecha, estado, usuario, notas
- `production_inputs` — producto, cantidad, costo del momento
- `production_outputs` — producto, cantidad, **costo asignado**

Al confirmar: descuenta los inputs, da de alta los outputs con su lote y vencimiento propios,
y guarda la merma.

```
merma        = Σ inputs − Σ outputs
costo_salida = costo_total_inputs × (qty_salida ÷ Σ qty_outputs)   [editable]
```

> Repartir por peso hace que **la merma encarezca lo que sí se vende**, que es exactamente
> lo que querés ver: si de 8,4 kg salen 5,2 de feta, el costo real de esa feta no es el costo
> del kilo comprado.

Reporte que sale de acá: **rinde real vs. esperado** por producto, por orden y por empleado.

### 4.6 Ventas, POS y caja

- `cash_sessions` — local, cajero, apertura (fondo), cierre (declarado vs. esperado vs.
  diferencia), estado
- `sales` — local, turno de caja, usuario, número, **`is_fiscal`**, cliente (opcional),
  subtotal, descuento, total, estado (`completada` | `anulada`), canal (`pos` | `celular`)
- `sale_items` — producto, `qty numeric(12,3)`, precio unitario, subtotal, **`cost_snapshot`**
  (el costo del momento, para que el margen histórico no se mueva cuando cambie el costo)
- `sale_payments` — medio de pago, monto, recargo
- `payment_methods` — nombre, tipo, `surcharge_pct`, **`afecta_caja`** (efectivo sí, tarjeta no)

RPCs atómicas: `create_sale`, `cancel_sale` (repone stock, solo admin).

**Devoluciones** — `returns` + `return_items`. Reponen stock y devuelven efectivo de la caja
del turno. Sin cuenta corriente, no hay saldo a favor.

**Arqueo del turno:**

```
esperado = fondo_inicial
         + ventas en efectivo
         + ingresos varios
         − devoluciones en efectivo
         − gastos pagados por caja        ← viene de "Pagos y gastos"
         − retiros
```

> Este renglón es el que engancha el módulo 5 con el 2. Un gasto pagado del cajón que no
> descuenta del arqueo hace que a la caja le "falte" plata todos los días.

### 4.7 Pagos y gastos del local  *(módulo nuevo)*

- `expense_categories` — Alquiler, Servicios (luz/gas/agua), Sueldos, Cargas sociales,
  Fletes, Limpieza, Mantenimiento, Impuestos y tasas, Insumos (bandejas, film, bolsas),
  Marketing, Otros. Editable.
- `financial_accounts` — Caja Ramos, Caja Mosconi, Banco, Mercado Pago…
  Tipo (`efectivo` | `banco` | `billetera`), `store_id` nullable (la caja es del local,
  el banco es de la empresa).
- `expenses` — local (nullable = gasto de empresa), categoría, fecha, descripción, monto,
  **`payment_source`: `caja` | `banco`**, `cash_session_id` (si sale de caja),
  `financial_account_id` (si sale de banco), proveedor (opcional), `has_invoice` + número,
  comprobante adjunto (Supabase Storage), usuario.
- `supplier_payments` — proveedor, fecha, monto, cuenta de origen, imputación a compras.
- `supplier_movements` — cuenta corriente del proveedor: la compra suma deuda, el pago la baja.
- `cash_movements` — retiros e ingresos varios de la caja del turno.

**La regla que gobierna el módulo:** todo gasto con `payment_source = 'caja'` exige un
**turno abierto en ese local** y descuenta del arqueo. Todo gasto por banco no toca la caja.

> **Una asimetría que vale la pena marcar:** vos no vendés fiado, pero **a vos te fían los
> proveedores**. Por eso hay cuenta corriente de *proveedores* aunque no haya de *clientes*.
> Si preferís arrancar sin eso (toda compra se paga contado), lo dejo dormido y se enciende
> después.

**Gastos recurrentes** (alquiler, sueldos): plantilla mensual que precarga el gasto para
confirmar, así no se olvida ninguno.

### 4.8 Clientes y ticket por mail

- `customers` — nombre (opcional), email, teléfono, `opt_in_marketing`, primera compra.
  Deduplicado por email/teléfono.
- `sale_emails` — venta, destinatario, estado, fecha de envío, error.
  **Cola con reintento: si el mail falla, la venta ya está cerrada.**

**Envío:** dominio propio `distribuidoraiberico.com.ar` vía Resend. El ticket sale identificado
con el local donde se compró y con **responder-a** el mail de ese local, así el cliente le
contesta a Ramos o a Mosconi según corresponda. Requiere cargar SPF/DKIM en el DNS, una sola vez.

### 4.9 Combos y promociones

- El combo es un `product` con `kind = 'combo'` + `combo_items` (componentes y cantidades).
  Al venderlo descuenta cada componente.
- `promotions` (fase posterior): 2x1, descuento por cantidad, descuento por medio de pago.

> **Combo ≠ elaborado.** El combo se arma al vender y es una regla de precio. El elaborado
> (bandeja de picada envasada y pesada) se armó antes, tiene stock propio, vencimiento propio
> y costo propio. Ibérico hace los dos.

### 4.10 Precios y sincronización con balanzas

- `price_history` — producto, precio anterior, nuevo, motivo, usuario, fecha
- Recálculo masivo: por %, por categoría, por proveedor
- **Cartelería de góndola** imprimible, para que el cartel y la balanza no se peleen
- `scale_sync_log` — qué se exportó, cuándo, a qué balanza

**Bellota es el archivo maestro.** Decisión del dueño, 07/09/2026:

- **El precio nace en Bellota** y de ahí baja a las 4 balanzas por archivo. Un solo lugar
  donde se toca un aumento.
- **El PLU nace en la balanza** para lo que ya existe: Bellota lo recibe en la carga inicial
  (ideal: export del catálogo por Qendra, no una lista tipeada). De ahí en adelante, un
  producto nuevo saca su PLU de Bellota y baja con el mismo archivo.

`scale_sync_log` registra qué se exportó, cuándo y a qué balanza.

> **El agujero que deja este esquema, y cómo se tapa.** Entre que se cambia un precio en
> Bellota y que el archivo llega a las balanzas hay una ventana. Adentro de esa ventana la
> balanza cobra con el precio viejo y Bellota calcula con el nuevo: el cliente paga bien y el
> stock se descuenta mal. **No es un caso raro: es exactamente el día del aumento.**
>
> Por eso un cambio de precio deja el producto marcado como **pendiente de bajar a balanza**,
> y el Inicio muestra cuántos hay. La regla operativa es que un aumento no se considera hecho
> hasta que el archivo se cargó en las cuatro. Mientras haya pendientes, el POS avisa al
> escanear ese producto.

> **A verificar antes de la sincronización:** que el PLU de un mismo producto sea idéntico en
> las 4 balanzas. Si Ramos tiene el jamón en el 412 y Mosconi en el 380, el catálogo no es uno
> solo. Se resuelve exportando las 4 y comparando.

### 4.11 Cómo llega cada producto a la caja

Hardware: **1 PC + 2 balanzas + 1 lectora por local**, 2 locales → **4 balanzas**.
Modelos Systel línea Cuora: **`CM30MBXUF1`** y **`CN30MTEAR`**.

**Circuito cerrado con el dueño el 07/09/2026.** Hay dos caminos y se juntan en la caja:

| | Quién lo identifica | Cómo llega a la caja |
|---|---|---|
| **Fraccionable** (`unit_type = kg`) | PLU en la balanza | El mostrador pesa, la balanza imprime el ticket, el cliente lo lleva a la caja y el cajero lo escanea |
| **No fraccionable** (`unit_type = unidad`, envasado) | EAN de fábrica | El cajero escanea el paquete directo, sin pasar por balanza |

**La venta se arma en Bellota**, mezclando los dos. El total del ticket de balanza **no es**
el total de la venta: el vino que el cliente agarró de la góndola se suma después.

> **Un tercer caso que no entra en la tabla: los elaborados.** Una picada armada no tiene EAN
> de fábrica ni pasa necesariamente por balanza. Tres salidas, en orden de preferencia:
> (1) si se pesa y se envasa, la balanza le pone etiqueta como a cualquier fraccionable;
> (2) si tiene precio fijo, se busca por nombre en el POS — es un producto solo y prominente;
> (3) etiqueta propia, que hoy no se puede porque no hay impresora.

#### El formato de la etiqueta

Verificado contra dos tickets reales el 07/09/2026 (parser en `lib/balanza.ts`,
`npm run check:balanza`):

```
2 0 │ P P P P │ I I I I I I │ C
      └ PLU ─┘ └─ importe ─┘ └ verificador
       4 díg.    6 díg., en pesos
```

- **El PLU ocupa 4 dígitos → el máximo es 9999.** El alta de productos lo valida.
- **No hay ningún PLU reservado.** Acá decía que el `2000` lo estaba, porque yo suponía que
  la balanza lo usaba para el código del total. El ticket real lo desmintió: el total se
  distingue por el **prefijo** (`22` en vez de `20`), no por el PLU. Ver `lib/balanza.ts`.
- **Un PLU identifica una presentación, no un producto.** El fraccionado y la horma del mismo
  queso tienen PLU distintos, y el mostrador despeja los kilos con el precio de *esa*
  presentación.
- **La balanza embebe el IMPORTE, no el peso.** Los kilos se reconstruyen:
  `kg = importe ÷ precio`. Funciona exacto mientras el precio de la balanza sea el de Bellota
  — ver el agujero de la ventana de sincronización en §4.10.

> **Lo que se pierde por embeber importe en vez de peso.** Con el importe, una diferencia de
> precio es **indetectable**: sale un peso plausible pero equivocado y nada lo marca. Con el
> peso embebido, Bellota podría comparar `kg × precio` contra el importe impreso y cazar la
> diferencia en la primera venta. **Si Qendra deja cambiarlo a peso variable, conviene
> hacerlo** — es configuración, no código, y convierte un error silencioso en uno visible.

#### El código del total

El ticket trae un código por línea **y uno del total** (PLU `2000`). El del total lleva plata
pero no lleva productos: **no sirve para cobrar**, sirve para verificar que no quedó ninguna
línea sin escanear.

Orden en el mostrador: **las líneas de arriba hacia abajo y el total al final** — es el
barrido natural con el papel en la mano, y deja el control justo antes de cobrar. Bellota
acepta el total en cualquier posición igual.

Los códigos de línea **no traen el número de operación** (el ticket lo imprime en letras pero
no lo codifica), así que el agrupamiento es por secuencia: todo lo escaneado desde el último
código de total pertenece al ticket en curso.

Si al cobrar quedaron líneas de balanza sin contrastar contra un total, **se avisa pero no se
bloquea**: el papel se arruga y la impresión se borronea, y frenar una venta con cola atrás es
peor que el riesgo que cubre. Queda registrado que se cobró sin verificar.

> Systel publica un **protocolo RS232** (peso en vivo) → camino futuro para una balanza de
> mostrador conectada directo al POS, sin etiqueta intermedia.

---

## 5. Reportes (dentro del Panel de ventas)

- Ventas por período, por local y **por hora del día** (para dimensionar el mostrador)
- **Kg vendidos** por producto y por categoría
- **Margen por producto** (venta − `cost_snapshot`)
- **Merma por producto y por motivo** — cuánto se pierde y dónde
- **Rinde real vs. esperado** por despiece
- Stock valorizado por local
- Vencimientos próximos
- Productos sin rotación
- Comparativa entre locales
- Arqueos y diferencias de caja
- **Gastos por categoría y por local**, mes a mes
- **Resultado del local**: ventas − CMV − gastos del local
- Todos con selector **Todo / Solo fiscal**, con *Todo* por defecto

---

## 6. Arquitectura

1. **Multitenant desde el día uno.** Toda tabla lleva `organization_id` con RLS
   `using (organization_id = current_org_id())`. `current_org_id()` es
   `STABLE SECURITY DEFINER` para no recursar contra `profiles`.
2. **La lógica de negocio va en funciones de Postgres**, llamadas con `supabase.rpc()`.
   Todo lo que deba ser atómico o no salteable: `create_sale`, `cancel_sale`, `adjust_stock`,
   `receive_purchase`, `confirm_production`, `close_cash_session`, `create_expense`.
3. **Seguridad en tres capas:** se oculta el botón en la UI · `requireCan(modulo, editar)`
   al inicio de cada server action · la función SQL revalida rol y organización.
   *Ocultar el botón es parte del trabajo, no un extra.*
4. **Permisos por rol y módulo**, no por nombre de rol. Excepción: acciones destructivas
   (anular venta, borrar) reservadas a `Administrador` verificado dentro de la función SQL.
5. **Migraciones numeradas** `NNNN_descripcion.sql`, **append-only** e idempotentes.
   Se corren a mano en el SQL Editor de Supabase, en orden.
6. **Zona horaria:** el servidor corre en UTC. Fijar `America/Argentina/Buenos_Aires`
   explícito en el formateo **y** en el cálculo de "hoy", si no cerca de medianoche el
   sistema cambia de día antes de tiempo. Crítico en un negocio que cierra caja de noche.

---

## 7. Fases

| # | Fase | Entrega |
|---|---|---|
| 0 | **Base** | Next.js + Supabase + auth + roles + layout con los 7 módulos + deploy en Vercel |
| 1 | **Productos** | Catálogo, PLU, categorías, precios, importación por Excel |
| 2 | **Stock** | Existencias por local, movimientos, ajustes, **merma con motivo**, transferencias |
| 3 | **Compras + costo** | Proveedores, recepción por peso real, reparto entre locales, promedio ponderado |
| 4 | **POS + Caja** | Mostrador (búsqueda + peso manual), cobro multi-medio, turno, arqueo, **versión celular** |
| 5 | **Panel de ventas** | Historial por local, detalle, anulación, devoluciones, primeros reportes |
| 6 | **Pagos y gastos** | Gastos caja/banco, categorías, cuentas, pagos a proveedores, recurrentes |
| 7 | **Producción** | Recetas, despiece, elaborados, rinde real vs. esperado |
| 8 | **Vencimientos + Precios** | Lotes, alertas, recálculo masivo, cartelería de góndola |
| 9 | **Balanzas** | Export del catálogo a Qendra, configuración de las 4, escaneo de etiqueta en el POS |
| 10 | **Ticket por email** | Resend + SPF/DKIM en el dominio |
| 11 | **Facturación** | ARCA / CAE sobre las ventas fiscales |

> **El POS no espera a las balanzas.** Desde la fase 4 vende por búsqueda de producto con
> peso tipeado a mano. La fase 9 enciende el escaneo como un interruptor. Así el proyecto
> no queda bloqueado por el setup del hardware.
>
> **El Inicio se construye de a poco:** cada fase le agrega su tarjeta.

---

## 8. Riesgos y pendientes

**Riesgos asumidos**
- **Sin internet no hay POS en la PC.** Mitigación aceptada: se vende desde el celular por 4G.
  Obliga a que el POS móvil sea bueno de verdad, no un parche.
- **Escaneo por cámara en iPhone** es más lento que la lectora láser. Alcanza para contingencia.
  Si molesta, una lectora bluetooth se aparea al iPhone como teclado.
- **Las 4 balanzas se configuran a mano una vez.** Si los PLU no quedan idénticos, una etiqueta
  de una balanza escanea mal en el POS. Es el punto más frágil del proyecto.
- **Sin impresora térmica el cliente se va sin comprobante** si no deja el mail. Asumido.

**Pendiente de definir**
1. ¿Va **cuenta corriente de proveedores** desde el arranque, o toda compra es contado? (§4.7)
2. **Acceso al DNS de `distribuidoraiberico.com.ar`** para cargar SPF/DKIM (fase 10).
3. **Qendra**: formato de importación de PLUs. Queda de mi lado averiguarlo en la fase 9.
4. **Catálogo inicial**: qué hay hoy para importar (Excel, lista en papel, nada).
5. Nombre del **repositorio** en la org LeAlDevs.
6. **Roles reales** del equipo (cajero, encargado, dueño) y qué puede hacer cada uno.

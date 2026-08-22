# Genera las páginas placeholder del andamiaje (fase 0).
# Se corre una sola vez; las páginas después se editan a mano.
import io, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
APP = os.path.join(ROOT, "app", "(app)")

PAGES = [
    ("", "Inicio", "Cómo viene el día en Ramos y en Mosconi.", 0, [
        "Ventas de hoy por local, con la variación contra ayer",
        "Ticket promedio, margen del día y merma de la semana",
        "Ventas por hora, comparadas contra el mismo día de la semana pasada",
        "Artículos bajo el mínimo y próximos vencimientos, por local",
        "Aviso de cajas sin cerrar",
    ]),
    ("pos", "Punto de venta", "El mostrador: buscar, pesar, cobrar.", 4, [
        "Búsqueda por nombre o PLU, y escaneo de la etiqueta de la balanza",
        "Peso tipeado a mano, para vender desde el día uno sin esperar a las balanzas",
        "Cobro con varios medios de pago, con recargo por medio",
        "Marca fiscal / no fiscal en cada venta",
        "Versión celular usable a 390px, para cuando se cae internet",
    ]),
    ("pos/caja", "Caja del turno", "Apertura, arqueo y cierre del cajón.", 4, [
        "Apertura con fondo declarado",
        "Esperado = fondo + ventas en efectivo − devoluciones − gastos de caja − retiros",
        "Cierre con declarado contra esperado, y la diferencia a la vista",
    ]),
    ("pos/arqueos", "Historial de arqueos", "Todos los cierres, con sus diferencias.", 4, [
        "Cierres por local y por cajero",
        "Diferencias acumuladas, para detectar un problema antes de que sea grande",
    ]),
    ("ventas", "Panel de ventas", "Las ventas de los dos locales.", 5, [
        "Historial con filtros por local, fecha, cajero y medio de pago",
        "Detalle de cada venta con sus líneas y sus pagos",
        "Anulación (solo administrador), que repone el stock",
        "Selector Todo / Solo fiscal, con Todo por defecto",
    ]),
    ("ventas/devoluciones", "Devoluciones", "Devolver mercadería y plata.", 5, [
        "Repone el stock y devuelve el efectivo de la caja del turno",
        "Sin cuenta corriente no hay saldo a favor: se devuelve o no se devuelve",
    ]),
    ("ventas/reportes", "Reportes", "Qué se vende y cuánto deja.", 5, [
        "Kilos vendidos por producto y por categoría",
        "Margen por producto, con el costo del momento de cada venta",
        "Merma por producto y por motivo",
        "Rinde real contra esperado en los despieces",
        "Ventas por hora, comparativa entre locales y resultado del local",
    ]),
    ("stock", "Stock", "Existencias por local, a costo promedio ponderado.", 2, [
        "Existencias por local, con decimales de verdad (numeric 12,3)",
        "Stock valorizado y productos bajo el mínimo",
        "Ficha de producto con su historial de movimientos",
    ]),
    ("stock/movimientos", "Movimientos de stock", "Todo lo que entró y salió, y por qué.", 2, [
        "Cada movimiento con su motivo, su documento de origen y su usuario",
        "Ningún camino escribe el stock directo: todo pasa por adjust_stock()",
    ]),
    ("stock/ajustes", "Ajustes y merma", "Lo que se pierde, con nombre y apellido.", 2, [
        "Motivo obligatorio: vencido, roto, mal estado, degustación, error de carga, robo",
        "Guarda el costo del momento, así el reporte dice cuánta plata se perdió",
    ]),
    ("stock/transferencias", "Transferencias", "Mercadería que pasa de un local al otro.", 2, [
        "Valida el stock en origen antes de mover nada",
        "Deja los dos movimientos en una sola transacción",
    ]),
    ("stock/compras", "Compras", "Recepción de mercadería y costo.", 3, [
        "Recepción por peso real: se piden 10 kg, llegan 9,8 y manda lo que llegó",
        "Una compra se reparte entre los dos locales por línea, no por documento",
        "Al confirmar recalcula el costo promedio ponderado sobre el total recibido",
        "Si es a cuenta corriente, genera la deuda con el proveedor",
    ]),
    ("stock/produccion", "Producción", "Despiece y elaborados.", 7, [
        "Despiece: una pieza entra, salen fetas, puntas y merma",
        "Elaborados: picadas y bandejas, con su propio stock y vencimiento",
        "Costo repartido por peso y editable: la merma encarece lo que sí se vende",
        "Rinde real contra esperado, por orden y por empleado",
    ]),
    ("stock/vencimientos", "Vencimientos", "Lotes que están por vencer.", 8, [
        "Lotes opcionales, solo en los productos que lo necesitan",
        "Sin FEFO obligatorio en el mostrador: es inusable con fila",
        "Baja de lo vencido con un clic, que va derecho a merma",
    ]),
    ("gastos", "Pagos y gastos", "En qué se va la plata del local.", 6, [
        "Cada gasto sale de la caja o del banco, y lo dice",
        "Los de caja exigen turno abierto y descuentan del arqueo",
        "Comprobante adjunto y categoría",
        "Gastos recurrentes precargados, para que no se olvide el alquiler",
    ]),
    ("gastos/proveedores", "Pagos a proveedores", "Lo que se le debe a cada uno.", 6, [
        "La compra a cuenta corriente suma deuda, el pago la baja",
        "Imputación del pago a las compras que cancela",
    ]),
    ("gastos/cuentas", "Cuentas y saldos", "Caja de cada local, banco y billeteras.", 6, [
        "Caja Ramos, Caja Mosconi, banco y billeteras virtuales",
        "La caja es del local; el banco es de la empresa",
    ]),
    ("gastos/categorias", "Categorías de gasto", "Cómo se agrupan los gastos.", 6, [
        "Alquiler, servicios, sueldos, fletes, limpieza, mantenimiento, impuestos, insumos",
        "Editables: el reporte por categoría vale lo que valga esta lista",
    ]),
    ("productos", "Productos", "El catálogo: PLU, precio y costo.", 1, [
        "Tipo kg o unidad: la decisión que atraviesa todo el sistema",
        "PLU asignado por Bellota, único y estable, nunca reutilizado",
        "Costo promedio ponderado calculado, no editable a mano",
        "Stock mínimo para la alerta de reposición",
    ]),
    ("productos/categorias", "Categorías", "Cómo se agrupa el catálogo.", 1, [
        "Fiambres, quesos, elaborados, envasados, bebidas",
        "Se usan en el punto de venta y en los reportes por categoría",
    ]),
    ("productos/importar", "Importar desde Excel", "La carga inicial del catálogo.", 1, [
        "Plantilla descargable con Nombre, PLU, Tipo, Costo, Precio, stock por local",
        "Vista previa antes de confirmar: qué crea, qué actualiza, qué está mal",
        "Idempotente por PLU: se puede volver a correr sin duplicar nada",
    ]),
    ("productos/precios", "Precios y cartelería", "Un solo lugar donde se carga el precio.", 8, [
        "Recálculo masivo por porcentaje, categoría o proveedor",
        "Historial de quién cambió qué precio y cuándo",
        "Cartelería de góndola imprimible",
        "Exportación del catálogo a las cuatro balanzas",
    ]),
    ("configuracion", "Usuarios y roles", "Quién puede hacer qué.", 0, [
        "Permisos por módulo, no por nombre de rol",
        "Cada usuario con su local asignado: ve los dos, opera el suyo",
        "Las acciones destructivas quedan reservadas al administrador",
    ]),
    ("configuracion/locales", "Locales", "Ramos y Mosconi.", 0, [
        "Nombre, correo del local y si tiene punto de venta",
        "Un depósito central futuro entra acá con el punto de venta apagado",
    ]),
    ("configuracion/pagos", "Medios de pago", "Efectivo, débito, crédito, QR, transferencia.", 4, [
        "Recargo por medio de pago",
        "Marca de si afecta la caja: el efectivo sí, la tarjeta no",
    ]),
    ("configuracion/balanzas", "Balanzas y código de barras", "Las cuatro Systel Cuora.", 9, [
        "Formato del EAN-13 configurable: posiciones y largo de cada tramo",
        "Prefijo 20 pesable, 21 por unidad, con el peso embebido y no el importe",
        "Exportación del catálogo en el formato que consume Qendra",
    ]),
]

TEMPLATE = '''import {{ Placeholder }} from "@/components/shell/placeholder";

export default function Page() {{
  return (
    <Placeholder
      title="{title}"
      description="{description}"
      phase={{{phase}}}
      items={{[
{items}
      ]}}
    />
  );
}}
'''

for route, title, description, phase, items in PAGES:
    folder = os.path.join(APP, *route.split("/")) if route else APP
    os.makedirs(folder, exist_ok=True)
    body = "\n".join('        "%s",' % i.replace('"', '\\"') for i in items)
    src = TEMPLATE.format(title=title, description=description, phase=phase, items=body)
    path = os.path.join(folder, "page.tsx")
    io.open(path, "w", encoding="utf-8", newline="\n").write(src)
    print("wrote", os.path.relpath(path, ROOT))

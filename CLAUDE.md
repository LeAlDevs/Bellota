# Bellota — ERP y punto de venta de Distribuidora Ibérico

Cadena de fiambrerías con dos locales: **Ramos** y **Mosconi**.
El diseño completo está en [DISENO.md](DISENO.md) — leerlo antes de tocar
cualquier regla de negocio.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind v4 + `lucide-react` + `sonner` |
| Backend | Supabase (Postgres + Auth + Storage + RLS) |
| Validación | `zod` en cada server action |
| Excel | `xlsx` (SheetJS), del lado del cliente |
| Deploy | Vercel, push a `main` |

Puerto de dev: **3006**. UI en **español rioplatense** (voseo: "Cargá", "Ingresá").
Formatos con `Intl` es-AR desde `lib/format.ts` — nunca a mano.

## Reglas de negocio que no se negocian

1. **Monotributo: NO se discrimina IVA.** Los precios son finales. `tax_rate`
   existe en `products` pero está dormida y sin UI.
2. **Fiscal / no fiscal** es un flag por venta. **Las dos mueven stock y caja**;
   solo las fiscales van a facturación. Reportes con selector Todo / Solo fiscal,
   **Todo por defecto**.
3. **No hay cuenta corriente de clientes.** No se vende fiado. Sí hay cuenta
   corriente de proveedores.
4. **El costo es promedio ponderado**, único a nivel empresa, recalculado en
   cada recepción. Nunca editable a mano.
5. **`cost_snapshot` en cada línea de venta**: el margen histórico no se puede
   mover cuando cambie el costo.
6. **Todos VEN los dos locales; cada uno OPERA el punto de venta del suyo.**
   Gatear con `requireStoreForPos()`, no filtrar las lecturas.
7. **El PLU lo asigna el sistema, es único y NUNCA se reutiliza.** Si se recicla,
   una etiqueta vieja de la balanza escanea el producto equivocado.
8. **`unit_type` (`kg` | `unidad`) gobierna todo.** Las cantidades son
   `numeric(12,3)`, con decimales de verdad.
9. **No hay impresora térmica.** El ticket se manda por email, en cola con
   reintento: si el mail falla, la venta ya está cerrada.
10. **Un gasto pagado por caja descuenta del arqueo del turno.** Si no, a la caja
    le falta plata todos los días.

## Arquitectura

### Multitenant desde el día uno
Toda tabla de negocio lleva `organization_id` con RLS:

```sql
create policy <tabla>_all on public.<tabla> for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
```

`current_org_id()`, `is_admin()`, `current_store_id()` y `get_my_permissions()`
son `STABLE SECURITY DEFINER` para no recursar contra `profiles` por RLS.

### La lógica de negocio vive en Postgres
Todo lo que deba ser **atómico** o **no salteable** va en una función SQL llamada
con `supabase.rpc()`: `adjust_stock`, `create_sale`, `cancel_sale`,
`receive_purchase`, `confirm_production`, `close_cash_session`, `create_expense`.

**Ningún camino escribe `stock` directo.** Siempre `adjust_stock()`.

### Seguridad en tres capas
1. **UI**: se oculta el botón si no corresponde. *Ocultar el botón es parte del
   trabajo, no un extra* — botones visibles que el servidor rechaza generan
   desconfianza.
2. **Server action**: `requireCan("modulo", true)` al inicio.
3. **Función SQL**: revalida rol y organización.

Gatear **por permiso de módulo**, no por nombre de rol. Excepción: acciones
destructivas (anular venta, borrar) → `is_admin()` adentro de la función SQL.

### Server actions

```ts
export async function guardarX(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const parsed = schema.safeParse({ ...campos });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  // ... rpc / update
  revalidatePath("/ruta");
  return { ok: true };
}
```

Formularios con `useActionState` + `<form action={action}>`; feedback con
`toast.success` / `toast.error` desde un `useEffect` sobre el estado.

## Sistema visual — "Tablero" (Dirección D, validada 22/08/2026)

Los bocetos fuente están en `design/*.dc.html`; los tokens, en `app/globals.css`.

- Canvas `#F4F1EC`, tarjetas blancas, línea `#E7E0D6`
- **Sidebar claro** con secciones rotuladas (Operación / Administración); las
  sub-pestañas se despliegan **solo** en el módulo activo
- **Barra superior espresso** `#221609` con buscador y selector de local
- Acento bellota `#7B4A17`, tostado `#C99263`
- Tipografía **Geist** + **Geist Mono**. Los números llevan la utility `num`
  (peso 600, tracking cerrado, cifras tabulares) o `tnum` en filas de tabla
- **El color codifica, no decora**: marrón = venta · verde = margen ·
  rojo = merma y faltante · ámbar = atención

## Flujo de trabajo

1. **Migraciones** numeradas `NNNN_descripcion.sql` en `supabase/migrations/`.
   El usuario las corre **a mano** en el SQL Editor de Supabase, **en orden**.
   Son **append-only**: nunca editar una entregada, crear una nueva.
   Idempotentes: `create or replace`, `add column if not exists`.
2. **Verificar contra la base real**, no contra los archivos, antes de afirmar
   que algo falta o sobra.
3. **`npm run build` antes de cada commit** — atrapa errores de tipos.
4. Al terminar una feature, decir **explícitamente** qué migración hay que correr.

## Trampas conocidas de este stack (no volver a caer)

- `formData.get("campo")` devuelve **`null`** si el campo no está en el form. Un
  `z.preprocess` que solo convierte `""` a `undefined` **falla con `null`**.
  Normalizar antes de validar (ver `field()` en `app/login/actions.ts`).
- No guardar en cada `onChange` de un input de fecha: al tipear el año, el primer
  dígito dispara el guardado y corta la edición. **Guardar en `onBlur`.**
- Un **server component no puede pasar closures** a un client component. Para una
  server action con argumentos: `accion.bind(null, arg1, arg2)`.
- La policy de `profiles` permite editar **solo el propio perfil**: cambiar el rol
  o el local de otro usuario con el cliente normal **falla en silencio** (0 filas).
  Usar `createAdminClient()` **después** del guard.
- **El server corre en UTC.** Fijar `America/Argentina/Buenos_Aires` explícito al
  formatear y al calcular "hoy". Distinguir `date` (día calendario, mostrar tal
  cual) de `timestamptz` (convertir). En un negocio que cierra caja de noche esto
  es crítico.
- Al eliminar registros con impacto financiero: revertir el **efecto neto** y
  borrar los movimientos, no asentar contra-movimientos.

## Cómo trabajar con el dueño

Charlar y **cerrar el diseño antes de codear**. Explicar el porqué, no solo el
qué. Proponer con trade-offs. Si su premisa tiene un problema, decirlo con
fundamento. Verificar contra datos reales y mostrar la evidencia.

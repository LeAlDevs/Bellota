# Bellota

ERP administrativo, contable y de punto de venta para **Distribuidora Ibérico**,
cadena de fiambrerías con dos locales: **Ramos** y **Mosconi**.

- Diseño y modelo de datos: [DISENO.md](DISENO.md)
- Convenciones de código y reglas de negocio: [CLAUDE.md](CLAUDE.md)
- Bocetos de UI: `design/` (artboards `.dc.html` + `canvas.json`)

## Poner a andar el proyecto

```bash
npm install
cp .env.local.example .env.local   # completar con las claves de Supabase
npm run dev                        # http://localhost:3006
```

La `SUPABASE_SERVICE_ROLE_KEY` **saltea RLS**: va solo en `.env.local` (que está
gitignoreado) y en las variables de entorno del servidor en Vercel. Nunca al
browser, nunca al repo.

## Base de datos

Las migraciones están en `supabase/migrations/`, numeradas y **append-only**. Se
corren **a mano en el SQL Editor de Supabase, en orden**. Nunca se edita una ya
corrida: si algo cambia, va una migración nueva.

Para arrancar de cero, **en este orden**:

1. Correr `0001_base.sql`. Crea la organización, los dos locales, los roles
   (Administrador, Encargado, Cajero) con sus permisos, y el trigger de alta.
2. Correr `0002_reparar_alta_usuario.sql`.
3. Crear el primer usuario en **Supabase → Authentication → Users → Add user**,
   con contraseña y "Auto Confirm User" activado.
4. Ese primer usuario queda como **Administrador** automáticamente. Los que
   entren después quedan sin rol hasta que un administrador se los asigne.

> **El orden importa.** El perfil se crea con un trigger sobre `auth.users`, que
> solo actúa hacia adelante: un usuario dado de alta ANTES de correr las
> migraciones queda sin perfil y sin rol, y no hay forma de arreglarlo desde la
> UI (para entrar a Configuración ya hace falta tener rol). `0002` existe
> justamente para reparar eso: rellena los perfiles que falten y garantiza que
> haya un Administrador. Es idempotente, se puede volver a correr.

## Deploy en Vercel

El repo remoto es `https://github.com/LeAlDevs/bellota.git`. Una vez creado en
GitHub y pusheado:

1. En **vercel.com → Add New → Project**, importar el repo `LeAlDevs/bellota`.
   Vercel detecta Next.js solo: no hay que tocar build command ni output.
2. Antes de darle Deploy, cargar las tres variables de entorno (**Environment
   Variables**), las mismas de `.env.local`, en *Production*, *Preview* y
   *Development*:

   | Variable | Dónde sale |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ídem (clave `anon`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | ídem (clave `service_role`) |

   > La `service_role` **saltea RLS**. En Vercel es una variable de servidor y
   > nunca llega al navegador — por eso NO lleva el prefijo `NEXT_PUBLIC_`.
   > Cualquier variable que empiece con `NEXT_PUBLIC_` sí termina en el browser.

3. Deploy. De ahí en adelante, cada `git push` a `main` deploya solo.

**Supabase no necesita nada.** La base es la misma que en local: el proyecto
apunta al mismo `loxvhnwvannpaqlxfwyq`, así que lo que se ve online y lo que se
ve en `localhost:3006` son los mismos datos. Cuando haga falta separar
producción de pruebas, va un segundo proyecto de Supabase y otras variables en
el entorno *Preview*.

## Módulos

| Módulo | Qué tiene adentro |
|---|---|
| Inicio | Dashboard de los dos locales |
| Punto de venta | Mostrador · Caja del turno · Historial de arqueos |
| Panel de ventas | Ventas por local · Devoluciones · Reportes |
| Stock | Existencias · Movimientos · Ajustes y merma · Transferencias · Compras · Producción · Vencimientos |
| Pagos y gastos | Gastos del local · Pagos a proveedores · Cuentas · Categorías |
| Productos | Listado · Categorías · Importar Excel · Precios y cartelería |
| Configuración | Usuarios y roles · Locales · Medios de pago · Balanzas |

## Estado

**Fase 0 — andamiaje.** Auth, roles, permisos por módulo, RLS, el shell de los
siete módulos y todas las pantallas navegables como placeholder. El plan de
fases está en [DISENO.md](DISENO.md#7-fases).

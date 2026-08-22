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

Para arrancar de cero:

1. Correr `0001_base.sql`. Crea la organización, los dos locales, los roles
   (Administrador, Encargado, Cajero) con sus permisos, y el trigger de alta.
2. Crear el primer usuario en **Supabase → Authentication → Users → Add user**,
   con contraseña y "Auto Confirm User" activado.
3. Ese primer usuario queda como **Administrador** automáticamente. Los que
   entren después quedan sin rol hasta que un administrador se los asigne.

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

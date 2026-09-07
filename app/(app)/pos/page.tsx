import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { getMe, getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getProductosParaPicker } from "@/lib/productos";
import { formatMoney } from "@/lib/format";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { PosTerminal, type MedioPago } from "./pos-terminal";

export default async function PosPage() {
  const [me, perms, sb, products] = await Promise.all([
    getMe(),
    getPermissions(),
    createClient(),
    getProductosParaPicker(),
  ]);

  if (!canEdit(perms, "pos")) {
    return (
      <>
        <PageHeader title="Punto de venta" />
        <Card>
          <EmptyState
            title="No tenés permiso para vender"
            description="Pedile a un encargado que te habilite el mostrador."
          />
        </Card>
      </>
    );
  }

  // Todos ven los dos locales, pero cada uno opera el suyo. El administrador
  // sin local asignado opera el primero: la base lo valida igual.
  const { data: stores } = await sb
    .from("stores")
    .select("id, name")
    .eq("active", true)
    .eq("has_pos", true)
    .order("name");

  const storeId = me?.storeId ?? stores?.[0]?.id ?? null;
  const storeName =
    stores?.find((s) => s.id === storeId)?.name ?? me?.storeName ?? "—";

  if (!storeId) {
    return (
      <>
        <PageHeader title="Punto de venta" />
        <Card>
          <EmptyState
            title="No hay ningún local con punto de venta"
            description="Revisá en Configuración que el local esté activo y marcado con punto de venta."
          />
        </Card>
      </>
    );
  }

  const { data: turno, error } = await sb
    .from("cash_sessions")
    .select("id, opening_float, opened_at")
    .eq("store_id", storeId)
    .eq("status", "abierta")
    .maybeSingle();

  if (error) {
    return (
      <>
        <PageHeader title="Punto de venta" />
        <Card>
          <EmptyState
            title="No pude leer el turno de caja"
            description={`La base devolvió: ${error.message}. Si todavía no corriste 0008_pos_caja.sql, es eso.`}
          />
        </Card>
      </>
    );
  }

  if (!turno) {
    return (
      <>
        <PageHeader title="Punto de venta" subtitle={storeName} />
        <Card>
          <EmptyState
            title="La caja está cerrada"
            description="Antes de vender hay que abrir el turno y declarar con cuánto arranca el cajón. Es lo que después permite saber si la caja cierra."
          >
            <Link href="/pos/caja">
              <Button>
                <LockKeyhole className="size-4" strokeWidth={1.8} />
                Abrir el turno
              </Button>
            </Link>
          </EmptyState>
        </Card>
      </>
    );
  }

  const [{ data: metodos }, { data: ventas }] = await Promise.all([
    sb
      .from("payment_methods")
      .select("id, name, surcharge_pct, affects_cash")
      .eq("active", true)
      .order("sort_order"),
    sb
      .from("sales")
      .select("total")
      .eq("cash_session_id", turno.id)
      .eq("status", "completada"),
  ]);

  const ventasDelTurno = (ventas ?? []).reduce((a, v) => a + Number(v.total), 0);

  return (
    <>
      <PageHeader
        title="Mostrador"
        subtitle={`${storeName} · turno abierto con ${formatMoney(turno.opening_float)} de fondo`}
      >
        <Link
          href="/pos/caja"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-card px-4 text-[13px] font-medium transition-colors hover:bg-canvas"
        >
          Caja del turno
        </Link>
      </PageHeader>

      <PosTerminal
        storeId={storeId}
        storeName={storeName}
        sessionId={turno.id}
        products={products}
        metodos={(metodos ?? []) as MedioPago[]}
        ventasDelTurno={ventasDelTurno}
        ticketsDelTurno={(ventas ?? []).length}
      />
    </>
  );
}

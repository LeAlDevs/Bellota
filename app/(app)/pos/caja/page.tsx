import { getMe, getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "@/components/ui/form";
import { AbrirTurno, TurnoAbierto } from "./caja-panel";

export default async function CajaPage() {
  const [me, perms, sb] = await Promise.all([
    getMe(),
    getPermissions(),
    createClient(),
  ]);

  if (!canEdit(perms, "caja")) {
    return (
      <>
        <PageHeader title="Caja del turno" />
        <Card>
          <EmptyState
            title="No tenés permiso para operar la caja"
            description="Podés ver los arqueos, pero abrir y cerrar el turno lo hace quien esté habilitado."
          />
        </Card>
      </>
    );
  }

  const { data: stores } = await sb
    .from("stores")
    .select("id, name")
    .eq("active", true)
    .eq("has_pos", true)
    .order("name");

  const storeId = me?.storeId ?? stores?.[0]?.id ?? null;
  const storeName = stores?.find((s) => s.id === storeId)?.name ?? "—";

  if (!storeId) {
    return (
      <>
        <PageHeader title="Caja del turno" />
        <Card>
          <EmptyState
            title="No hay ningún local con punto de venta"
            description="Revisá en Configuración que el local esté activo."
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
        <PageHeader title="Caja del turno" />
        <Card>
          <EmptyState
            title="No pude leer la caja"
            description={`La base devolvió: ${error.message}. Si todavía no corriste 0008_pos_caja.sql, es eso.`}
          />
        </Card>
      </>
    );
  }

  if (!turno) {
    return (
      <>
        <PageHeader
          title="Caja del turno"
          subtitle={`${storeName} · sin turno abierto`}
        />
        <AbrirTurno storeId={storeId} storeName={storeName} />
      </>
    );
  }

  const [{ data: esperado }, { data: ventas }, { data: movimientos }] =
    await Promise.all([
      sb.rpc("expected_cash", { p_session_id: turno.id }),
      sb
        .from("sales")
        .select("total, sale_payments(amount, surcharge, affects_cash)")
        .eq("cash_session_id", turno.id)
        .eq("status", "completada")
        .returns<
          {
            total: number;
            sale_payments: { amount: number; surcharge: number; affects_cash: boolean }[];
          }[]
        >(),
      sb
        .from("cash_movements")
        .select("id, amount, kind, note")
        .eq("cash_session_id", turno.id)
        .order("created_at", { ascending: false }),
    ]);

  const lista = ventas ?? [];
  const ventasTotales = lista.reduce((a, v) => a + Number(v.total), 0);
  const ventasEfectivo = lista.reduce(
    (a, v) =>
      a +
      (v.sale_payments ?? [])
        .filter((p) => p.affects_cash)
        .reduce((b, p) => b + Number(p.amount) + Number(p.surcharge), 0),
    0
  );

  return (
    <>
      <PageHeader title="Caja del turno" subtitle={storeName} />
      <TurnoAbierto
        sessionId={turno.id}
        storeName={storeName}
        abiertoDesde={turno.opened_at}
        fondo={Number(turno.opening_float)}
        esperado={Number(esperado ?? 0)}
        ventasEfectivo={ventasEfectivo}
        ventasTotales={ventasTotales}
        tickets={lista.length}
        movimientos={(movimientos ?? []) as never[]}
      />
    </>
  );
}

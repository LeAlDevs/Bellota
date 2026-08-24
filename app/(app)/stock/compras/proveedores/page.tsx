import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/form";
import { SupplierManager, type Proveedor } from "./supplier-manager";

export default async function ProveedoresPage() {
  const [perms, sb] = await Promise.all([getPermissions(), createClient()]);

  const [{ data: suppliers }, { data: saldos }, { data: compras }] = await Promise.all([
    sb
      .from("suppliers")
      .select("id, name, cuit, phone, email, notes")
      .eq("active", true)
      .order("name"),
    sb.rpc("supplier_balances"),
    sb.from("purchases").select("supplier_id"),
  ]);

  const porSaldo = new Map(
    ((saldos ?? []) as { supplier_id: string; balance: number }[]).map((s) => [
      s.supplier_id,
      Number(s.balance),
    ])
  );

  const conteo = new Map<string, number>();
  for (const c of (compras ?? []) as { supplier_id: string }[]) {
    conteo.set(c.supplier_id, (conteo.get(c.supplier_id) ?? 0) + 1);
  }

  const proveedores: Proveedor[] = (suppliers ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    cuit: p.cuit,
    phone: p.phone,
    email: p.email,
    notes: p.notes,
    saldo: porSaldo.get(p.id) ?? 0,
    compras: conteo.get(p.id) ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Proveedores"
        subtitle="Quién nos vende, y cuánto le debemos."
      >
        <Link
          href="/stock/compras"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-card px-4 text-[13px] font-medium transition-colors hover:bg-canvas"
        >
          <ArrowLeft className="size-4" strokeWidth={1.8} />
          Volver a Compras
        </Link>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="max-w-3xl">
          <SupplierManager
            proveedores={proveedores}
            puedeEditar={canEdit(perms, "compras")}
          />
        </div>
      </div>
    </>
  );
}

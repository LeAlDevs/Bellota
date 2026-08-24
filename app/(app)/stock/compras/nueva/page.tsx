import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getProductosParaPicker } from "@/lib/productos";
import { todayLocal } from "@/lib/format";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/form";
import { PurchaseForm } from "./purchase-form";

export default async function NuevaCompraPage() {
  const [perms, me, sb, products] = await Promise.all([
    getPermissions(),
    getMe(),
    createClient(),
    getProductosParaPicker(),
  ]);

  if (!canEdit(perms, "compras")) redirect("/stock/compras");

  const [{ data: suppliers }, { data: stores }] = await Promise.all([
    sb.from("suppliers").select("id, name").eq("active", true).order("name"),
    sb.from("stores").select("id, name").eq("active", true).order("name"),
  ]);

  if ((suppliers ?? []).length === 0) {
    return (
      <>
        <PageHeader title="Recibir compra" />
        <Card>
          <EmptyState
            title="Todavía no hay proveedores"
            description="Una compra siempre es de alguien. Cargá el proveedor primero y volvé."
          >
            <Link href="/stock/compras/proveedores">
              <Button>Cargar un proveedor</Button>
            </Link>
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Recibir compra"
        subtitle="Cargá el peso real de la balanza, no lo que decía el pedido."
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <PurchaseForm
          suppliers={suppliers ?? []}
          stores={stores ?? []}
          products={products}
          storeIdPropio={me?.storeId ?? null}
          hoy={todayLocal()}
        />
      </div>
    </>
  );
}

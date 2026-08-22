import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getMe, getPermissions } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [me, perms] = await Promise.all([getMe(), getPermissions()]);
  if (!me) redirect("/login");

  const sb = await createClient();
  const { data: stores } = await sb
    .from("stores")
    .select("id, name")
    .eq("active", true)
    .order("name");

  // Todavía no existe la tabla de turnos (fase 4): el aviso queda apagado.
  const cajaAbierta = null;

  if (!me.roleName) {
    return (
      <main className="flex min-h-screen items-center justify-center p-10">
        <div className="flex max-w-md flex-col gap-3 rounded-xl border border-line bg-card p-8">
          <h1 className="text-lg font-semibold">Tu cuenta todavía no tiene rol</h1>
          <p className="text-sm leading-relaxed text-muted">
            Entraste bien, pero un administrador tiene que asignarte un rol y un
            local antes de que puedas usar el sistema.
          </p>
          <p className="text-sm text-faint">{me.email}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Suspense>
        <Sidebar perms={perms} cajaAbierta={cajaAbierta} />
      </Suspense>

      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-14 shrink-0 bg-topbar" />}>
          <Topbar
            stores={stores ?? []}
            user={{
              fullName: me.fullName,
              roleName: me.roleName,
              storeName: me.storeName,
            }}
            alertas={0}
          />
        </Suspense>

        <main className="flex min-h-0 flex-1 flex-col gap-3.5 p-5">
          {children}
        </main>
      </div>
    </div>
  );
}

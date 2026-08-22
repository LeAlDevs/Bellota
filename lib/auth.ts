import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canEdit, canView, type Perms } from "@/lib/permissions";

/** Estado estándar de las server actions (useActionState). */
export type ActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export type Me = {
  id: string;
  fullName: string;
  email: string;
  roleName: string | null;
  storeId: string | null;
  storeName: string | null;
  isAdmin: boolean;
};

/** Permisos del usuario actual: { modulo: { view, edit } }. */
export async function getPermissions(): Promise<Perms> {
  const sb = await createClient();
  const { data } = await sb.rpc("get_my_permissions");
  return (data ?? {}) as Perms;
}

/** Datos del usuario actual, con su local y su rol. */
export async function getMe(): Promise<Me | null> {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return null;

  const [{ data: profile }, { data: isAdmin }] = await Promise.all([
    sb
      .from("profiles")
      .select("full_name, email, store_id, roles(name), stores(name)")
      .eq("id", auth.user.id)
      .maybeSingle(),
    sb.rpc("is_admin"),
  ]);

  const role = profile?.roles as unknown as { name: string } | null;
  const store = profile?.stores as unknown as { name: string } | null;

  return {
    id: auth.user.id,
    fullName: profile?.full_name ?? auth.user.email ?? "",
    email: profile?.email ?? auth.user.email ?? "",
    roleName: role?.name ?? null,
    storeId: (profile?.store_id as string | null) ?? null,
    storeName: store?.name ?? null,
    isAdmin: isAdmin === true,
  };
}

/**
 * Alcance de OPERACIÓN por local. Decisión del dueño: todos VEN los dos
 * locales, pero cada uno OPERA el punto de venta solo en el suyo. Por eso esto
 * no filtra lecturas: gatea la caja y la venta.
 */
export async function requireStoreForPos(
  storeId: string
): Promise<ActionState | null> {
  const me = await getMe();
  if (!me) return { error: "No autenticado." };
  if (me.isAdmin) return null;
  if (me.storeId !== storeId) {
    return { error: "Solo podés operar el punto de venta de tu local." };
  }
  return null;
}

/**
 * Guard de server action (capa 2 de la seguridad en 3 capas).
 *   const denied = await requireCan("productos", true);
 *   if (denied) return denied;
 */
export async function requireCan(
  module: string,
  edit = false
): Promise<ActionState | null> {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return { error: "No autenticado." };

  const perms = await getPermissions();
  const ok = edit ? canEdit(perms, module) : canView(perms, module);
  if (!ok) return { error: "No tenés permiso para esta acción." };
  return null;
}

/** Guard para acciones reservadas al Administrador (anular, borrar). */
export async function requireAdmin(): Promise<ActionState | null> {
  const sb = await createClient();
  const { data } = await sb.rpc("is_admin");
  if (data !== true) return { error: "Acción reservada a un administrador." };
  return null;
}

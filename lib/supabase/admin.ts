import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con service-role key: SALTEA RLS. Solo servidor.
 * Usar únicamente DESPUÉS de un guard de permisos (requireCan / requireAdmin).
 * Ojo: cambiar el rol de OTRO usuario con el cliente normal falla en silencio
 * (0 filas, por la policy de profiles) → para eso está este cliente.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

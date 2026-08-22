import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Nombres de usuario por id, para mostrar quién hizo cada cosa.
 *
 * Va en consulta aparte y no como embed de PostgREST porque las tablas de
 * negocio apuntan a `auth.users`, no a `profiles`: son dos relaciones distintas
 * y PostgREST no puede saltar de una a la otra solo. Agregarle un segundo FK a
 * la columna resolvería el embed, pero dejaría la referencia ambigua para
 * cualquier otra consulta.
 */
export async function getNombresDeUsuarios(
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unicos.length === 0) return new Map();

  const sb = await createClient();
  const { data } = await sb
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unicos);

  return new Map(
    (data ?? []).map((p) => [p.id as string, (p.full_name || p.email || "—") as string])
  );
}

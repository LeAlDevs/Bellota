"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCan, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Poné un nombre de al menos 2 letras.").max(60),
});

export async function guardarCategoria(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const raw = formData.get("id");
  const parsed = schema.safeParse({
    id: raw == null || String(raw).trim() === "" ? undefined : String(raw),
    name: formData.get("name") == null ? undefined : String(formData.get("name")),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const sb = await createClient();
  const { error } = await sb.rpc("upsert_category", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
  });

  if (error) {
    if (error.code === "23505") return { error: "Ya existe una categoría con ese nombre." };
    return { error: error.message };
  }

  revalidatePath("/productos/categorias");
  revalidatePath("/productos");
  return { ok: true };
}

/** Los productos de la categoría no se borran: quedan sin categoría. */
export async function borrarCategoria(id: string): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("delete_category", { p_id: id });
  if (error) return { error: error.message };

  revalidatePath("/productos/categorias");
  revalidatePath("/productos");
  return { ok: true };
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/auth";

const schema = z.object({
  email: z.string().trim().min(1, "Poné tu correo.").email("Ese correo no es válido."),
  password: z.string().min(1, "Poné tu contraseña."),
});

/**
 * formData.get() devuelve null si el campo no existe en el form: normalizar a
 * undefined ANTES de validar, o zod explota con un mensaje incomprensible.
 */
function field(value: FormDataEntryValue | null): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s === "" ? undefined : s;
}

export async function entrar(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = schema.safeParse({
    email: field(formData.get("email")),
    password: field(formData.get("password")),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: "El correo o la contraseña no coinciden." };
  }

  // redirect() lanza: tiene que quedar afuera de cualquier try/catch.
  redirect("/");
}

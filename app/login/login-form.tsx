"use client";

import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { entrar } from "./actions";
import type { ActionState } from "@/lib/auth";

const initial: ActionState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(entrar, initial);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="flex w-[396px] flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Entrar</h1>
        <p className="text-sm text-muted">Usá el mail que te dio el encargado.</p>
      </div>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink/70">Correo</span>
          <div className="flex h-12 items-center gap-3 rounded-[10px] border border-line-strong bg-card px-3.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
            <Mail className="size-[18px] shrink-0 text-faint" strokeWidth={1.6} />
            <input
              name="email"
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="nombre@distribuidoraiberico.com.ar"
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
          </div>
          {state.fieldErrors?.email && (
            <span className="text-xs text-danger">{state.fieldErrors.email[0]}</span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink/70">Contraseña</span>
          <div className="flex h-12 items-center gap-3 rounded-[10px] border border-line-strong bg-card px-3.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
            <Lock className="size-[18px] shrink-0 text-faint" strokeWidth={1.6} />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="shrink-0 text-faint transition-colors hover:text-muted"
            >
              {showPassword ? (
                <EyeOff className="size-[18px]" strokeWidth={1.6} />
              ) : (
                <Eye className="size-[18px]" strokeWidth={1.6} />
              )}
            </button>
          </div>
          {state.fieldErrors?.password && (
            <span className="text-xs text-danger">{state.fieldErrors.password[0]}</span>
          )}
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="h-[50px] rounded-[11px] bg-accent text-[15px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>

      <p className="rounded-[10px] border border-accent-soft bg-accent-soft/60 px-3.5 py-3 text-xs leading-relaxed text-warn">
        Cada usuario opera el punto de venta de su propio local. Los dos se ven
        desde cualquier cuenta.
      </p>

      <p className="text-center text-xs text-faint">
        Distribuidora Ibérico · Bellota v0.1
      </p>
    </form>
  );
}

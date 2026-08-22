"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, LogOut, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { cerrarSesion } from "@/app/(app)/actions";

export type Store = { id: string; name: string };

type Props = {
  stores: Store[];
  user: { fullName: string; roleName: string | null; storeName: string | null };
  alertas: number;
};

export function Topbar({ stores, user, alertas }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("local") ?? "todos";

  /** Conserva el resto de los filtros al cambiar de local. */
  function hrefFor(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "todos") next.delete("local");
    else next.set("local", value);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const options = [{ id: "todos", name: "Los dos" }, ...stores];

  const initials = user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 bg-topbar px-5.5 text-topbar-fg">
      <div className="flex w-[300px] items-center gap-2.5 rounded-lg bg-topbar-field px-3.5 py-2">
        <Search className="size-4 shrink-0" strokeWidth={1.6} />
        <span className="text-[13px] text-topbar-muted">
          Buscar producto, venta o proveedor
        </span>
      </div>

      <div className="ml-1.5 flex gap-1.5">
        {options.map((o) => (
          <Link
            key={o.id}
            href={hrefFor(o.id)}
            className={cn(
              "rounded-[7px] px-3.5 py-1.5 text-[12.5px] transition-colors",
              current === o.id
                ? "bg-tostado font-semibold text-topbar"
                : "hover:bg-topbar-field"
            )}
          >
            {o.name}
          </Link>
        ))}
      </div>

      <div className="grow" />

      <div className="relative flex">
        <Bell className="size-[19px]" strokeWidth={1.6} />
        {alertas > 0 && (
          <span className="tnum absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-strong px-1 text-[10px] font-semibold text-white">
            {alertas}
          </span>
        )}
      </div>

      <span className="h-5.5 w-px bg-topbar-line" />

      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
          {initials}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[12.5px] font-semibold text-topbar-strong">
            {user.fullName}
          </span>
          <span className="text-[11px] text-topbar-muted">
            {[user.roleName, user.storeName].filter(Boolean).join(" · ") ||
              "Sin rol asignado"}
          </span>
        </span>
      </div>

      <form action={cerrarSesion}>
        <button
          type="submit"
          aria-label="Cerrar sesión"
          className="flex rounded-lg p-2 transition-colors hover:bg-topbar-field"
        >
          <LogOut className="size-[18px]" strokeWidth={1.6} />
        </button>
      </form>
    </header>
  );
}

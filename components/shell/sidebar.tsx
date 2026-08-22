"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  Home,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { NAV, activeItem, type NavItem } from "@/lib/nav";
import { canView, type Perms } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ICONS: Record<NavItem["icon"], LucideIcon> = {
  home: Home,
  cart: ShoppingCart,
  chart: BarChart3,
  boxes: Boxes,
  wallet: Wallet,
  tag: Tag,
  sliders: SlidersHorizontal,
};

type Props = {
  perms: Perms;
  /** Aviso de caja sin cerrar, al pie. Null si no hay ninguna. */
  cajaAbierta: { store: string; esperado: string } | null;
};

export function Sidebar({ perms, cajaAbierta }: Props) {
  const pathname = usePathname();
  const active = activeItem(pathname);

  return (
    <aside className="flex w-[238px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-line px-4.5 py-4">
        <Image src="/bellota.webp" alt="" width={28} height={28} priority />
        <span className="text-[17px] font-semibold tracking-[-0.015em]">Bellota</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 py-3.5">
        {NAV.map((section) => {
          const visible = section.items.filter((i) => canView(perms, i.module));
          if (visible.length === 0) return null;

          return (
            <div key={section.label} className="flex flex-col gap-0.5">
              <p className="px-2.5 pt-2 pb-1.5 text-[10px] uppercase tracking-[0.11em] text-sidebar-muted">
                {section.label}
              </p>

              {visible.map((item) => {
                const Icon = ICONS[item.icon];
                const isActive = active?.href === item.href;
                const children = (item.children ?? []).filter(
                  (c) => !c.module || canView(perms, c.module)
                );

                return (
                  <div key={item.href} className="flex flex-col">
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] transition-colors",
                        isActive
                          ? "bg-sidebar-active font-semibold text-sidebar-active-fg"
                          : "text-sidebar-fg hover:bg-canvas"
                      )}
                    >
                      <Icon className="size-[19px] shrink-0" strokeWidth={1.6} />
                      <span className="truncate">{item.label}</span>
                      {children.length > 0 && (
                        <span className="ml-auto shrink-0 text-faint">
                          {isActive ? (
                            <ChevronDown className="size-[15px]" strokeWidth={1.8} />
                          ) : (
                            <ChevronRight className="size-[15px]" strokeWidth={1.8} />
                          )}
                        </span>
                      )}
                    </Link>

                    {/* Las sub-pestañas solo se despliegan en el módulo activo:
                        con siete adentro de Stock, mostrarlas todas siempre
                        convierte el sidebar en una lista de veinte cosas. */}
                    {isActive && children.length > 0 && (
                      <div className="flex flex-col gap-px py-1 pl-[34px]">
                        {children.map((child) => {
                          const childActive = pathname === child.href;
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={cn(
                                "rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors",
                                childActive
                                  ? "bg-subtle font-semibold text-accent-hover"
                                  : "text-muted hover:text-ink"
                              )}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="grow" />

      {cajaAbierta && (
        <Link
          href="/pos/caja"
          className="m-3 flex flex-col gap-1.5 rounded-[11px] border border-warn-bg bg-warn-bg/50 px-3.5 py-3 transition-colors hover:bg-warn-bg"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-warn">
            <span className="size-1.5 rounded-full bg-warn" />
            Caja de {cajaAbierta.store}
          </span>
          <span className="text-[11.5px] leading-snug text-muted">
            Quedó un turno sin cerrar.
          </span>
          <span className="num text-lg text-warn">{cajaAbierta.esperado}</span>
        </Link>
      )}
    </aside>
  );
}

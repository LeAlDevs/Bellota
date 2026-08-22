import { Hammer } from "lucide-react";

type Props = {
  title: string;
  /** Qué va a resolver esta pantalla cuando esté. */
  description: string;
  /** Número de fase del plan (ver DISENO.md §7). */
  phase: number;
  /** Lo que va a haber acá adentro. */
  items?: string[];
};

/**
 * Pantalla todavía no construida. Existe para que el andamiaje sea navegable
 * de punta a punta desde la fase 0 y para que el dueño vea el plan en el
 * propio sistema, en vez de en un documento aparte.
 */
export function Placeholder({ title, description, phase, items }: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="text-[13px] text-muted">{description}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-card p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Hammer className="size-4" strokeWidth={1.7} />
          </span>
          <span className="text-sm font-semibold">
            Se construye en la fase {phase}
          </span>
        </div>

        {items && items.length > 0 && (
          <ul className="flex flex-col gap-2 border-t border-line pt-4">
            {items.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13px] text-muted">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-tostado" />
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

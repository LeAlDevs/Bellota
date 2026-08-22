import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      <div className="grow" />
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-ink/70">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

const control =
  "h-10 rounded-lg border border-line-strong bg-card px-3 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-canvas disabled:text-muted";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(control, "pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(control, "h-auto min-h-20 py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-colors disabled:opacity-60",
        variant === "primary" && "bg-accent text-accent-fg hover:bg-accent-hover",
        variant === "ghost" && "border border-line-strong bg-card hover:bg-canvas",
        variant === "danger" && "border border-danger/30 bg-card text-danger hover:bg-danger-bg",
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "ok" | "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold",
        tone === "neutral" && "bg-canvas text-muted",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "ok" && "bg-ok-bg text-ok",
        tone === "warn" && "bg-warn-bg text-warn",
        tone === "danger" && "bg-danger-bg text-danger"
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-card", className)}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-muted">{description}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

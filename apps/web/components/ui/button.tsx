import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ className, variant = "primary", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:pointer-events-none disabled:opacity-45",
        variant === "primary" && "bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]",
        variant === "secondary" && "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-soft)]",
        variant === "ghost" && "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]",
        variant === "danger" && "bg-[var(--danger)] text-white hover:brightness-95",
        size === "sm" && "min-h-11 px-3 text-sm sm:min-h-10",
        size === "md" && "px-4 text-sm",
        size === "lg" && "min-h-13 px-6 text-base",
        className,
      )}
      {...props}
    />
  );
}

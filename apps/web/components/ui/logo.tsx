import { Gavel } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2.5" aria-label="Fantasta">
      <span className="grid size-10 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-sm">
        <Gavel className="size-5" strokeWidth={2.4} />
      </span>
      {compact ? null : (
        <span className="text-xl font-black tracking-[-0.04em]">
          FANTA<span className="text-[var(--brand-dark)]">STA</span>
        </span>
      )}
    </div>
  );
}

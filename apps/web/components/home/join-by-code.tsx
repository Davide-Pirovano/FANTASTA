"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { toast } from "sonner";

export function JoinByCode() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 3) {
      toast.error("Inserisci un codice lega valido.");
      return;
    }
    router.push(`/league/${trimmed}`);
  }

  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="join-by-code-panel"
        className="group pressable inline-flex min-h-[4.25rem] w-full items-center justify-center gap-3 rounded-2xl border-2 border-[var(--brand)] bg-[var(--surface)] px-6 text-lg font-black tracking-tight text-[var(--brand-dark)] shadow-[0_18px_40px_-18px_rgba(24,81,70,0.35)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-soft)] sm:w-auto"
      >
        <KeyRound className="size-6 transition-transform duration-200 group-hover:rotate-12" />
        Accedi alla lega
      </button>

      {open ? (
        <div id="join-by-code-panel" className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)]/90 p-4 shadow-[0_18px_40px_-24px_rgba(24,51,40,0.45)] backdrop-blur sm:max-w-sm">
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-sm font-black">Codice lega</span>
              <input
                className="numeric mt-1.5 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--background)] px-4 text-lg font-black uppercase tracking-[0.2em] outline-none focus:border-[var(--brand)]"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={12}
                autoComplete="off"
                autoFocus
                spellCheck={false}
              />
            </label>
            <button
              type="submit"
              className="pressable inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-bold text-white transition-colors hover:bg-[var(--brand-dark)]"
            >
              Continua
              <ArrowRight className="size-4" />
            </button>
            <p className="text-center text-xs leading-5 text-[var(--muted)]">
              Il codice te lo fornisce l&apos;organizzatore dell&apos;asta, insieme al QR.
            </p>
          </form>
        </div>
      ) : null}
    </div>
  );
}

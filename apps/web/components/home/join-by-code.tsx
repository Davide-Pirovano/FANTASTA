"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, X } from "lucide-react";
import { toast } from "sonner";

export function JoinByCode({ fullWidth = false }: { fullWidth?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
    <div className={fullWidth ? "w-full" : "w-full sm:w-auto"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="join-by-code-panel"
        className={`group pressable inline-flex min-h-[4.25rem] w-full items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--surface)] px-5 text-lg font-black tracking-tight text-[var(--brand-dark)] shadow-[0_18px_40px_-18px_rgba(24,81,70,0.28)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-soft)] hover:shadow-[0_22px_42px_-18px_rgba(24,81,70,0.36)]${fullWidth ? "" : " sm:w-auto"}`}
      >
        <KeyRound className="size-6 transition-transform duration-200 group-hover:rotate-12" />
        Accedi alla lega
      </button>

      {open ? createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(18,39,30,0.28)] px-5 py-8 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div id="join-by-code-panel" role="dialog" aria-modal="true" aria-labelledby="join-by-code-title" className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_32px_80px_-24px_rgba(16,45,33,0.55)] sm:p-7" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="grid size-11 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]"><KeyRound className="size-5" /></span>
                <h2 id="join-by-code-title" className="mt-4 text-2xl font-black tracking-tight text-[var(--ink)]">Accedi alla lega</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Inserisci il codice ricevuto dall&apos;organizzatore.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="pressable grid size-10 place-items-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand-dark)]" aria-label="Chiudi"><X className="size-5" /></button>
            </div>
            <form onSubmit={submit} className="mt-6 space-y-3">
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
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

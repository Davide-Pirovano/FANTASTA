"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, KeyRound, Link2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * "Accedi alla lega" per la home desktop (contesto /local).
 *
 * Un partecipante che usa l'app dal proprio PC incolla il link di invito
 * (quello del QR / "Copia link" mostrato dalla regia dell'admin), che contiene
 * sia il codice lega sia l'URL del server LAN dell'admin. L'app estrae i due
 * valori e apre la vista partecipante sul renderer locale, collegandosi poi al
 * server dell'admin: nessun database o account necessario sul PC del guest.
 */
function parseInviteLink(raw: string): { code: string; server: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const match = /^\/(?:local\/)?league\/([A-Z0-9]{4,12})$/i.exec(url.pathname);
  if (!match) return null;
  const server = url.searchParams.get("server");
  if (!server) return null;
  return { code: match[1].toUpperCase(), server };
}

export function LocalJoinByInviteLink({ fullWidth = false }: { fullWidth?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

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
    const parsed = parseInviteLink(value);
    if (!parsed) {
      toast.error("Incolla il link di invito completo, quello del QR o del pulsante 'Copia link'.");
      return;
    }
    const target = new URL(`/local/league/${parsed.code}`, window.location.origin);
    target.searchParams.set("server", parsed.server);
    window.location.assign(target.toString());
  }

  return (
    <div className={fullWidth ? "w-full" : "w-full sm:w-auto"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="join-by-invite-panel"
        className={`group pressable inline-flex min-h-[4.25rem] w-full items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--surface)] px-5 text-lg font-black tracking-tight text-[var(--brand-dark)] shadow-[0_18px_40px_-18px_rgba(24,81,70,0.28)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-soft)] hover:shadow-[0_22px_42px_-18px_rgba(24,81,70,0.36)]${fullWidth ? "" : " sm:w-auto"}`}
      >
        <KeyRound className="size-6 transition-transform duration-200 group-hover:rotate-12" />
        Accedi alla lega
      </button>

      {open ? createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(18,39,30,0.28)] px-5 py-8 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div id="join-by-invite-panel" role="dialog" aria-modal="true" aria-labelledby="join-by-invite-title" className="w-full max-w-lg rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_32px_80px_-24px_rgba(16,45,33,0.55)] sm:p-7" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="grid size-11 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]"><Link2 className="size-5" /></span>
                <h2 id="join-by-invite-title" className="mt-4 text-2xl font-black tracking-tight text-[var(--ink)]">Accedi alla lega</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Incolla il link di invito condiviso dall&apos;organizzatore.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="pressable grid size-10 place-items-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand-dark)]" aria-label="Chiudi"><X className="size-5" /></button>
            </div>
            <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block">
              <span className="text-sm font-black">Link di invito</span>
              <input
                className="mt-1.5 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--background)] px-4 text-sm font-semibold outline-none focus:border-[var(--brand)]"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="http://192.168.1.5:47822/local/league/ABC123?server=…"
                autoFocus
                autoComplete="off"
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
            <p className="flex items-start gap-1.5 text-xs leading-5 text-[var(--muted)]">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              Il link te lo fornisce l&apos;organizzatore dell&apos;asta (QR o &quot;Copia link&quot; dalla regia). Contiene il codice lega e l&apos;indirizzo del suo PC sulla rete.
            </p>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

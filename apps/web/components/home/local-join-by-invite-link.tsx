"use client";

import { useState } from "react";
import { ArrowRight, KeyRound, Link2 } from "lucide-react";
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

export function LocalJoinByInviteLink() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

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
    <div className="w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="join-by-invite-panel"
        className="group pressable inline-flex min-h-[4.25rem] w-full items-center justify-center gap-3 rounded-2xl border-2 border-[var(--brand)] bg-[var(--surface)] px-6 text-lg font-black tracking-tight text-[var(--brand-dark)] shadow-[0_18px_40px_-18px_rgba(24,81,70,0.35)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-soft)] sm:w-auto"
      >
        <KeyRound className="size-6 transition-transform duration-200 group-hover:rotate-12" />
        Accedi alla lega
      </button>

      {open ? (
        <div id="join-by-invite-panel" className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)]/90 p-4 shadow-[0_18px_40px_-24px_rgba(24,51,40,0.45)] backdrop-blur sm:max-w-md">
          <form onSubmit={submit} className="space-y-3">
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
            <p className="flex items-start gap-1.5 text-center text-xs leading-5 text-[var(--muted)]">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              Il link te lo fornisce l&apos;organizzatore dell&apos;asta (QR o &quot;Copia link&quot; dalla regia). Contiene il codice lega e l&apos;indirizzo del suo PC sulla rete.
            </p>
          </form>
        </div>
      ) : null}
    </div>
  );
}

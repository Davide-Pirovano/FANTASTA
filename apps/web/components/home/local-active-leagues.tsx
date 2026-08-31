"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { LocalLanClient, type LocalLeagueSummary } from "@fantasta/desktop/client";
import { Button } from "@/components/ui/button";

/**
 * Home desktop: elenco delle leghe di cui la sessione locale è admin, con
 * "Entra nella regia" e "Elimina" (come nella home web). I dati arrivano dal
 * server SQLite/LAN del PC invece che da Supabase.
 */
export function LocalActiveLeagues({ baseUrl, sessionId }: { baseUrl: string; sessionId: string }) {
  const [client] = useState(() => new LocalLanClient(baseUrl, sessionId));
  const [leagues, setLeagues] = useState<LocalLeagueSummary[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      setLeagues(await client.listLeagues());
    } catch {
      setLeagues([]);
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    void client.listLeagues().then(
      (nextLeagues) => {
        if (active) setLeagues(nextLeagues);
      },
      () => {
        if (active) setLeagues([]);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  function remove(league: LocalLeagueSummary) {
    if (pending) return;
    startTransition(async () => {
      try {
        await client.command("deleteLeague", { leagueId: league.id, leagueCode: league.invite_code });
        toast.success("Lega eliminata");
        await refresh();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Eliminazione non riuscita");
      }
      setConfirmingId(null);
    });
  }

  if (leagues === null) {
    return <div className="mt-4 min-h-24 w-full" />;
  }

  if (leagues.length === 0) {
    return (
      <div className="mt-4 flex w-full flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-[var(--line)] bg-white/40 px-6 py-8 text-center backdrop-blur">
        <span className="grid size-14 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <Users className="size-7" />
        </span>
        <div>
          <p className="text-base font-black text-[var(--ink)]">Nessuna asta ancora</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-[var(--muted)]">
            Le tue aste aperte e concluse compariranno qui.
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-2">
          {["Crea la lega", "Importa il listone", "Condividi il QR"].map((step, i) => (
            <div key={step} className="flex flex-col items-center gap-1 rounded-xl bg-[var(--surface)] px-2 py-3">
              <span className="grid size-6 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-black text-white">
                {i + 1}
              </span>
              <span className="text-[11px] font-bold leading-tight text-[var(--muted)]">{step}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex w-full flex-col gap-2.5">
      {leagues.map((league) => {
        const adminHref = `/local/admin?${new URLSearchParams({
          server: baseUrl,
          session: sessionId,
          league: league.invite_code,
        }).toString()}`;
        return (
          <div
            key={league.id}
            className="rounded-2xl border border-[var(--line)] bg-white/70 p-3.5 shadow-[0_14px_36px_-24px_rgba(24,51,40,0.45)] backdrop-blur"
          >
            {confirmingId === league.id ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-sm font-bold leading-5">
                  Eliminare <span className="text-[var(--ink)]">{league.name}</span>?<br />
                  <span className="text-xs font-semibold text-[var(--muted)]">
                    Squadre, crediti e storico verranno rimossi per sempre.
                  </span>
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmingId(null)} disabled={pending}>
                    Annulla
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => remove(league)} disabled={pending}>
                    <Trash2 className="size-4" /> Elimina
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href={adminHref}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-0.5 transition-colors hover:bg-[var(--brand-soft)]/40"
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-dark)] transition-transform group-hover:scale-105">
                    <ExternalLink className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-[var(--ink)]">{league.name}</p>
                    <p className="numeric truncate text-xs text-[var(--muted)]">
                      {league.invite_code} · {league.participant_count}/{league.participant_limit} partecipanti
                    </p>
                  </div>
                </Link>
                {league.status === "COMPLETED" ? <Link href={`/local/repair?${new URLSearchParams({server:baseUrl,session:sessionId,source:league.id})}`} className="pressable grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] text-[var(--brand-dark)] hover:bg-[var(--brand-soft)] sm:size-10" aria-label={`Avvia asta di riparazione da ${league.name}`}><RefreshCw className="size-4" /></Link> : null}
                <button
                  type="button"
                  onClick={() => setConfirmingId(league.id)}
                  className="pressable grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] text-[var(--muted)] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:size-10"
                  aria-label={`Elimina ${league.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

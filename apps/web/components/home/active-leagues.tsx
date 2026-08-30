"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteLeagueAction } from "@/app/actions/auction";
import type { LeagueStatus } from "@fantasta/domain/state";

export type OpenLeague = {
  id: string;
  name: string;
  invite_code: string;
  status: LeagueStatus;
  participant_count: number;
  participant_limit: number;
};


export function ActiveLeagues({ leagues }: { leagues: OpenLeague[] }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(league: OpenLeague) {
    if (pending) return;
    startTransition(async () => {
      const res = await deleteLeagueAction(league.id, league.invite_code);
      if (!res.ok) toast.error(res.message);
      setConfirmingId(null);
    });
  }

  return (
    <div className="mt-4 flex w-full flex-col gap-2.5 overflow-y-auto pr-1 lg:min-h-0">
      {leagues.map((league) => (
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
                href={`/league/${league.invite_code}/admin`}
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
      ))}
    </div>
  );
}

export function EmptyLeagues() {
  return (
    <div className="mt-4 flex w-full flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-[var(--line)] bg-white/40 px-6 py-8 text-center backdrop-blur">
      <span className="grid size-14 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
        <Plus className="size-7" />
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

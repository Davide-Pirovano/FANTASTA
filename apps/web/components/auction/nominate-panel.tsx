"use client";

import { useMemo, useState, useTransition } from "react";
import { Megaphone, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/auction/parts";
import { PHASE_LABELS, type PlayerRole } from "@fantasta/domain/auction";
import type { PlayerRow } from "@fantasta/domain/state";
import { cn } from "@/lib/utils";
import { useAuctionActions } from "@/components/auction/auction-actions";

export function NominatePanel({ availablePlayers, phase, asteMode, leagueCode }: {
  availablePlayers: PlayerRow[];
  /** Fase corrente: si possono chiamare solo i giocatori di questo ruolo (solo modalità per_ruoli). */
  phase: PlayerRole;
  /** Modalità d'asta: "libero" mostra tutti i ruoli. */
  asteMode: "per_ruoli" | "libero";
  leagueCode: string;
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"valutazione" | "squadra">("valutazione");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { nominatePlayer } = useAuctionActions();

  // In modalità "libero" si può chiamare qualsiasi ruolo ancora disponibile.
  const visiblePlayers = useMemo(
    () => (asteMode === "libero" ? availablePlayers : availablePlayers.filter((p) => p.role === phase)),
    [availablePlayers, phase, asteMode]
  );

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return visiblePlayers
      .filter(
        (player) =>
          !normalized ||
          player.name.toLowerCase().includes(normalized) ||
          player.real_team.toLowerCase().includes(normalized)
      )
      .sort((a, b) =>
        sortBy === "squadra"
          ? a.real_team.localeCompare(b.real_team) || a.name.localeCompare(b.name)
          : b.quotation - a.quotation || a.name.localeCompare(b.name)
      )
      .slice(0, 40);
  }, [visiblePlayers, query, sortBy]);

  const selected = results.find((player) => player.id === selectedId) ?? null;

  function nominate() {
    if (!selected || pending) return;
    startTransition(async () => {
      const res = await nominatePlayer(selected.id, leagueCode);
      if (!res.ok) toast.error(res.message);
    });
  }

  return (
    <section className="rounded-[1.4rem] border-2 border-[var(--brand)] bg-[var(--surface)] p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <Megaphone className="size-5" />
        </span>
        <div>
          <h2 className="font-black text-[var(--brand-dark)]">È il tuo turno di chiamare</h2>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {asteMode === "per_ruoli" ? (
          <p className="text-sm">
            <span className="font-black uppercase tracking-wide text-[var(--ink)]">{PHASE_LABELS[phase]}</span>
            <span className="mx-2 text-[var(--muted)]">·</span>
            <span className="font-bold text-[var(--muted)]">{visiblePlayers.length} disponibili</span>
          </p>
        ) : (
          <span className="text-xs font-bold text-[var(--muted)]">
            Ordine sparso · {visiblePlayers.length} giocatori disponibili
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[var(--muted)]">
        {(["valutazione", "squadra"] as const).map((mode, index) => (
          <span key={mode} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-[var(--line)]">·</span> : null}
            <button
              type="button"
              onClick={() => setSortBy(mode)}
              aria-pressed={sortBy === mode}
              className={cn(
                "rounded px-1 py-0.5 transition-colors",
                sortBy === mode
                  ? "font-black text-[var(--brand-dark)]"
                  : "hover:text-[var(--ink)]"
              )}
            >
              {mode === "valutazione" ? "Per valutazione" : "Per squadra"}
            </button>
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center rounded-xl border border-[var(--line)] bg-[var(--background)] pl-3 focus-within:border-[var(--brand)]">
        <Search className="size-4 shrink-0 text-[var(--muted)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            asteMode === "libero"
              ? "Cerca tra tutti i giocatori..."
              : `Cerca tra i ${PHASE_LABELS[phase].toLowerCase()}...`
          }
          className="min-h-11 w-full bg-transparent px-2.5 font-semibold outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Svuota ricerca"
            className="grid size-11 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition-colors hover:text-[var(--ink)] sm:size-10"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-[var(--line)] sm:max-h-64">
        {results.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">
            {visiblePlayers.length === 0
              ? asteMode === "libero"
                ? "Nessun giocatore disponibile in rosa libera."
                : "Nessun giocatore disponibile per questa fase."
              : "Nessun giocatore trovato."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {results.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(player.id === selectedId ? null : player.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-soft)]",
                    player.id === selectedId && "bg-[var(--brand-soft)]/60"
                  )}
                >
                  <RoleBadge role={player.role} soft />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-black">
                      {player.name}
                      {player.is_trequartista ? (
                        <Sparkles className="size-3.5 shrink-0 text-purple-600" aria-label="Trequartista" />
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">{player.real_team}</span>
                  </span>
                  <span className="numeric shrink-0 text-sm font-black">{player.quotation}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button size="lg" className="mt-3 w-full sm:mt-4" disabled={!selected || pending} onClick={nominate}>
        {pending ? "Chiamata in corso..." : selected ? `Metti all'asta: ${selected.name}` : "Seleziona un giocatore"}
      </Button>
    </section>
  );
}

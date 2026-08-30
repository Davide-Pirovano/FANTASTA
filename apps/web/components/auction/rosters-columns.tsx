"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ReleaseButton, RoleBadge } from "@/components/auction/parts";
import { ROLES, type PlayerRole, type ReleaseRefund, type RoleSlots } from "@fantasta/domain/auction";
import type { TeamSummary } from "@fantasta/domain/state";
import { cn } from "@/lib/utils";

const ROLE_ORDER: Record<PlayerRole, number> = { P: 0, D: 1, C: 2, A: 3 };

/**
 * Rose di tutte le squadre: una colonna per squadra (squadre in orizzontale),
 * con i giocatori in verticale (ruolo, nome, squadra reale, prezzo) e le
 * statistiche della squadra nell'header della colonna.
 */
const COLORS = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
];

export function RostersColumns({ teams, slots, releaseRefund, leagueCode }: {
  teams: TeamSummary[];
  slots: RoleSlots;
  releaseRefund: ReleaseRefund;
  leagueCode: string;
}) {
  const totalSlots = ROLES.reduce((sum, role) => sum + slots[role], 0);

  // Paginazione responsive: poche squadre per pagina così i nomi restano leggibili.
  const [perPage, setPerPage] = useState(8);
  const [page, setPage] = useState(0);
  useEffect(() => {
    function calc() {
      const w = window.innerWidth;
      setPerPage(w < 640 ? 2 : w < 1024 ? 4 : w < 1280 ? 6 : 8);
    }
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const pageCount = Math.max(1, Math.ceil(teams.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const visible = teams.slice(safePage * perPage, safePage * perPage + perPage);
  const startIndex = safePage * perPage;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {visible.map((team, index) => (
          <article
            key={team.participant.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]"
          >
            <header className="border-b border-[var(--line)] bg-[var(--surface-soft)] px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-xl text-xs font-black",
                    COLORS[(startIndex + index) % COLORS.length]
                  )}
                >
                  {initials(team.participant.team_name)}
                </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-black">{team.participant.team_name}</h3>
                <p className="text-xs text-[var(--muted)]">
                  <span className="numeric font-black text-[var(--ink)]">{team.rosterSize}/{totalSlots}</span>{" "}
                  giocatori · <span className="numeric font-black text-[var(--brand-dark)]">{team.participant.budget_remaining}</span> crediti
                </p>
              </div>
            </div>
            <div className="mt-2 flex gap-1.5">
              {ROLES.map((role) => (
                <span key={role} className="rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-black text-[var(--muted)]">
                  {role} <span className="numeric">{team.ownedByRole[role]}</span>
                </span>
              ))}
            </div>
          </header>

          <ul className="flex-1 divide-y divide-[var(--line)]">
            {team.roster.length === 0 ? (
              <li className="px-4 py-5 text-center text-xs text-[var(--muted)]">Nessun acquisto ancora</li>
            ) : (
              [...team.roster]
                .sort(
                  (a, b) =>
                    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.player_name.localeCompare(b.player_name)
                )
                .map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                    <RoleBadge role={item.role} soft />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.player_name}</span>
                    <span className="max-w-[4.5rem] shrink truncate text-[11px] uppercase tracking-wide text-[var(--muted)]">{item.real_team}</span>
                    <span className="numeric shrink-0 text-sm font-black">{item.price}</span>
                    <ReleaseButton playerId={item.player_id} playerName={item.player_name} price={item.price} releaseRefund={releaseRefund} leagueCode={leagueCode} />
                  </li>
                ))
            )}
          </ul>
        </article>
      ))}
      </div>

      {teams.length > perPage ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="pressable inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 text-sm font-black text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="size-4" /> Precedenti
          </button>
          <span className="text-sm font-bold text-[var(--muted)]">
            Squadre {startIndex + 1}–{startIndex + visible.length} di {teams.length}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="pressable inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 text-sm font-black text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Successive <ChevronRight className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0]?.charAt(1) ?? "";
  return (first + second).toUpperCase();
}

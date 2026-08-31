"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ReleaseButton, RoleBadge } from "@/components/auction/parts";
import { ROLES, type PlayerRole, type ReleaseRefund, type RoleSlots } from "@fantasta/domain/auction";
import type { TeamSummary } from "@fantasta/domain/state";
import { cn } from "@/lib/utils";

const ROLE_ORDER: Record<PlayerRole, number> = { P: 0, D: 1, C: 2, A: 3 };

/**
 * Rose di tutte le squadre in blocchi verticali apribili: una card per squadra,
 * impilata in verticale, con statistiche in testa (nome, rose/crediti, contatori
 * ruolo) e la rosa espandibile con il chevron. Più leggibile della griglia a
 * colonne quando le squadre sono tante.
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
  // Tutte le rose partono chiuse; l'admin apre i singoli blocchi.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(participantId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {teams.map((team, index) => {
        const isExpanded = expanded.has(team.participant.id);
        return (
          <article
            key={team.participant.id}
            className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]"
          >
            <button
              type="button"
              onClick={() => toggle(team.participant.id)}
              aria-expanded={isExpanded}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-soft)]",
                isExpanded && "border-b border-[var(--line)]"
              )}
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl text-xs font-black",
                  COLORS[index % COLORS.length]
                )}
              >
                {initials(team.participant.team_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black">{team.participant.team_name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  <span className="numeric font-black text-[var(--ink)]">{team.rosterSize}/{totalSlots}</span>{" "}
                  giocatori · <span className="numeric font-black text-[var(--brand-dark)]">{team.participant.budget_remaining}</span> crediti
                </span>
              </span>
              <span className="hidden shrink-0 gap-1.5 sm:flex">
                {ROLES.map((role) => (
                  <span key={role} className="rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-black text-[var(--muted)]">
                    {role} <span className="numeric">{team.ownedByRole[role]}</span>
                  </span>
                ))}
              </span>
              {isExpanded ? <ChevronUp className="size-4 shrink-0 text-[var(--muted)]" /> : <ChevronDown className="size-4 shrink-0 text-[var(--muted)]" />}
            </button>

            {isExpanded ? (
              <ul className="divide-y divide-[var(--line)]">
                {team.roster.length === 0 ? (
                  <li className="px-4 py-5 text-center text-xs text-[var(--muted)]">Nessun acquisto ancora</li>
                ) : (
                  [...team.roster]
                    .sort(
                      (a, b) =>
                        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.player_name.localeCompare(b.player_name)
                    )
                    .map((item) => (
                      <li key={item.id} className="flex items-center gap-2 px-4 py-2">
                        <RoleBadge role={item.role} soft />
                        <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.player_name}</span>
                        <span className="max-w-[4.5rem] shrink truncate text-[11px] uppercase tracking-wide text-[var(--muted)]">{item.real_team}</span>
                        <span className="numeric shrink-0 text-sm font-black">{item.price}</span>
                        <ReleaseButton playerId={item.player_id} playerName={item.player_name} price={item.price} quotation={item.quotation} releaseRefund={releaseRefund} leagueCode={leagueCode} />
                      </li>
                    ))
                )}
              </ul>
            ) : null}
          </article>
        );
      })}

      {teams.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-[var(--muted)]">Nessuna squadra ancora.</p>
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
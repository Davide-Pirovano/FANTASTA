"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/auction/parts";
import type { PlayerRole } from "@fantasta/domain/auction";
import { exportLeague } from "@/lib/export-league";
import type { LeagueState } from "@fantasta/domain/state";

const ROLE_ORDER: Record<PlayerRole, number> = { P: 0, D: 1, C: 2, A: 3 };

export function ResultsSection({ state, scope }: {
  state: LeagueState;
  scope: "participant" | "admin";
}) {
  const [exporting, setExporting] = useState(false);
  const sortedTeams = [...state.teams].sort(
    (a, b) => b.participant.budget_remaining - a.participant.budget_remaining
  );

  async function downloadExcel() {
    if (exporting) return;
    setExporting(true);
    try {
      await exportLeague(
        state.league.name,
        state.teams.map((team) => ({
          name: team.participant.team_name,
          initialBudget: state.league.initial_budget,
          remainingBudget: team.participant.budget_remaining,
          players: team.roster.map((item) => ({
            role: item.role,
            player: item.player_name,
            realTeam: item.real_team,
            price: item.price,
            quotation: item.quotation,
          })),
        }))
      );
    } catch {
      toast.error("Errore durante la generazione del file Excel.");
    } finally {
      setExporting(false);
    }
  }

  function downloadMyCsv() {
    const myTeam = state.me ? state.teams.find((team) => team.participant.id === state.me!.id) : null;
    if (!myTeam) return;
    const rows: string[][] = [["Ruolo", "Giocatore", "Squadra reale", "Prezzo"]];
    for (const role of Object.keys(ROLE_ORDER) as PlayerRole[]) {
      for (const item of myTeam.roster.filter((entry) => entry.role === role)) {
        rows.push([role, item.player_name, item.real_team, String(item.price)]);
      }
    }
    rows.push([]);
    rows.push(["Crediti iniziali", "", "", String(state.league.initial_budget)]);
    rows.push(["Valore rosa attuale", "", "", String(myTeam.spent)]);
    rows.push(["Crediti rimasti", "", "", String(myTeam.participant.budget_remaining)]);
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${myTeam.participant.team_name}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-[-0.03em]">Asta completata 🎉</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {state.league.name} · rose finali e crediti consolidati.
            </p>
          </div>
          {scope === "admin" ? (
            <Button size="lg" onClick={downloadExcel} disabled={exporting}>
              <Download className="size-5" /> {exporting ? "Generazione..." : "Export lega completa"}
            </Button>
          ) : null}
        </div>
        {scope === "participant" && state.me ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <p className="truncate font-black">{state.me.team_name}</p>
              <p className="truncate text-xs text-[var(--muted)]">
                <span className="numeric font-black text-[var(--brand-dark)]">{state.me.budget_remaining}</span> crediti rimasti
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={downloadMyCsv}>
              <Download className="size-4" /> Scarica la tua rosa
            </Button>
          </div>
        ) : null}
      </section>

      {/* Rose finali divise per squadra */}
      <section>
        <h2 className="text-lg font-black tracking-[-0.02em]">Rose finali per squadra</h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">Ogni squadra con la sua rosa verticale e il totale speso.</p>
        <div className="mt-3 space-y-3">
          {sortedTeams.map((team) => {
            const rows = [...team.roster].sort(
              (a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.player_name.localeCompare(b.player_name)
            );
            return (
              <article key={team.participant.id} className="overflow-hidden rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-xs font-black text-[var(--brand-dark)]">
                      {initials(team.participant.team_name)}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-black">{team.participant.team_name}</h3>
                      <p className="text-xs text-[var(--muted)]">
                        <span className="numeric font-black text-[var(--ink)]">{rows.length}</span> giocatori ·{" "}
                        <span className="numeric font-black text-[var(--brand-dark)]">{team.participant.budget_remaining}</span> crediti rimasti
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="numeric text-sm font-black"><span className="font-bold text-[var(--muted)]">tot.</span> {team.spent} cr</p>
                  </div>
                </div>
                {rows.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-[var(--muted)] sm:px-5">Nessun giocatore acquistato.</p>
                ) : (
                  <ul className="divide-y divide-[var(--line)]">
                    {rows.map((row) => (
                      <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <RoleBadge role={row.role} soft />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-black">{row.player_name}</p>
                          <p className="truncate text-xs text-[var(--muted)]">{row.real_team}</p>
                        </div>
                        <span className="numeric shrink-0 font-black">{row.price}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0]?.charAt(1) ?? "";
  return (first + second).toUpperCase();
}

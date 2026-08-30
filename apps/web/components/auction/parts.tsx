"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Gavel, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuctionActions } from "@/components/auction/auction-actions";
import { refundForRelease, type PlayerRole, type ReleaseRefund } from "@fantasta/domain/auction";
import type { PurchaseRow, TeamSummary } from "@fantasta/domain/state";
import type { ActiveAuction } from "@fantasta/domain/state";
import { cn } from "@/lib/utils";

const ROLE_ORDER: Record<PlayerRole, number> = { P: 0, D: 1, C: 2, A: 3 };

const ROLE_BADGE: Record<PlayerRole, string> = {
  P: "bg-amber-100 text-amber-800",
  D: "bg-sky-100 text-sky-800",
  C: "bg-violet-100 text-violet-800",
  A: "bg-rose-100 text-rose-800",
};

const ROLE_SOFT: Record<PlayerRole, string> = {
  P: "bg-amber-50 text-amber-700",
  D: "bg-blue-50 text-blue-700",
  C: "bg-emerald-50 text-emerald-700",
  A: "bg-rose-50 text-rose-700",
};

export function RoleBadge({ role, soft = false }: { role: PlayerRole; soft?: boolean }) {
  return (
    <span className={cn("inline-grid size-7 shrink-0 place-items-center rounded-lg text-xs font-black", soft ? ROLE_SOFT[role] : ROLE_BADGE[role])}>
      {role}
    </span>
  );
}

export function AuctionStage({ auction, leaderName, myParticipantId }: {
  auction: ActiveAuction;
  leaderName: string | null;
  /** Id del partecipante corrente: la card è verde se la puntata è sua, neutra altrimenti. */
  myParticipantId?: string | null;
}) {
  const isMine = Boolean(myParticipantId && auction.highest_bidder_id === myParticipantId);
  return (
    <section
      key={auction.current_bid}
      className={cn(
        "relative overflow-hidden rounded-[1.6rem] text-white",
        isMine
          ? "bid-card-pop mine shadow-[0_18px_50px_oklch(0.45_0.13_153/0.18)]"
          : "bid-card-pop other shadow-[0_18px_50px_oklch(0.22_0.01_253/0.20)]"
      )}
    >
      <div className="flex justify-end px-4 pt-4 sm:px-7 sm:pt-6">
        <div className="flex items-center gap-1.5 rounded-full bg-white/14 px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:py-1.5 sm:text-xs">
          <Gavel className="size-3.5" /> Quotazione {auction.player.quotation}
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 sm:px-7 sm:pb-6 sm:pt-4">
        <div className="flex gap-2.5 sm:gap-4">
          <span className="grid w-12 shrink-0 place-items-center self-stretch rounded-2xl bg-white/15 text-xl font-black sm:w-16 sm:rounded-[1.25rem] sm:text-3xl">{auction.player.role}</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white/70 sm:text-sm">{auction.player.real_team}</p>
            <h1 className="mt-0.5 text-2xl font-black leading-[1.08] tracking-[-0.04em] sm:mt-1 sm:text-[2.6rem]">{auction.player.name}</h1>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/20 pt-3 sm:mt-6 sm:pt-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/65 sm:text-xs">Offerta attuale</p>
            </div>
            <p className="numeric mt-0.5 text-4xl font-black leading-none tracking-[-0.05em] sm:mt-1 sm:text-7xl">
              {auction.current_bid}
              <span className="ml-2 align-middle text-xs font-bold tracking-normal text-white/60 sm:text-sm">crediti</span>
            </p>
          </div>
          <div className="pb-0.5 text-right sm:pb-1">
            <p className="text-[10px] text-white/65 sm:text-xs">Miglior offerente</p>
            <p
              key={`leader-${auction.highest_bidder_id ?? "none"}`}
              className="leader-flash mt-0.5 max-w-28 truncate font-black leading-tight sm:mt-1 sm:max-w-40"
            >
              {leaderName ?? "In attesa"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function TeamsOverview({ teams, slots, highlightTeamId, caption, expandable = false }: {
  teams: TeamSummary[];
  slots: Record<PlayerRole, number>;
  highlightTeamId?: string | null;
  caption?: string;
  /** Se true, ogni squadra è espandibile per vedere la composizione della rosa. */
  expandable?: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const roles: PlayerRole[] = ["P", "D", "C", "A"];
  const totalSlots = roles.reduce((sum, role) => sum + slots[role], 0);
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-black tracking-[-0.02em]">Situazione squadre</h2>
          {caption ? <p className="text-sm text-[var(--muted)]">{caption}</p> : null}
        </div>
      </div>
      <div className="space-y-2">
        {teams.map((team, index) => {
          const isExpanded = expandable && expandedId === team.participant.id;
          return (
            <article
              key={team.participant.id}
              className={cn(
                "rounded-2xl border bg-[var(--surface)] p-4",
                team.participant.id === highlightTeamId ? "border-[var(--brand)] ring-1 ring-[var(--brand)]/30" : "border-[var(--line)]"
              )}
            >
              <button
                type="button"
                onClick={expandable ? () => setExpandedId(isExpanded ? null : team.participant.id) : undefined}
                disabled={!expandable}
                className={cn("w-full text-left", expandable && "cursor-pointer")}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl text-xs font-black",
                      index % 4 === 0 && "bg-emerald-100 text-emerald-800",
                      index % 4 === 1 && "bg-sky-100 text-sky-800",
                      index % 4 === 2 && "bg-violet-100 text-violet-800",
                      index % 4 === 3 && "bg-rose-100 text-rose-800"
                    )}
                  >
                    {initials(team.participant.team_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-black">{team.participant.team_name}</h3>
                    <p className="text-xs text-[var(--muted)]">
                      {team.rosterSize} giocatori · {Math.max(0, totalSlots - team.rosterSize)} slot rimasti
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="numeric text-xl font-black">{team.participant.budget_remaining}</p>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">crediti</p>
                  </div>
                  {expandable ? (
                    <ChevronDown
                      className={cn("size-4 shrink-0 text-[var(--muted)] transition-transform", isExpanded && "rotate-180")}
                    />
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {roles.map((role) => (
                    <div key={role} className="rounded-lg bg-[var(--surface-soft)] px-2 py-1.5 text-center text-xs">
                      <span className="font-black">{role}</span>{" "}
                      <span className="text-[var(--muted)]">{team.ownedByRole[role]}/{slots[role]}</span>
                    </div>
                  ))}
                </div>
              </button>

              {isExpanded ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-[var(--line)]">
                  {team.roster.length === 0 ? (
                    <p className="bg-[var(--surface-soft)] px-4 py-5 text-center text-xs text-[var(--muted)]">
                      Nessun acquisto ancora
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--line)] bg-[var(--surface)]">
                      {[...team.roster]
                        .sort(
                          (a, b) =>
                            (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.player_name.localeCompare(b.player_name)
                        )
                        .map((item) => (
                          <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                            <RoleBadge role={item.role} soft />
                            <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.player_name}</span>
                            <span className="max-w-[5.5rem] shrink truncate text-[11px] uppercase tracking-wide text-[var(--muted)]">
                              {item.real_team}
                            </span>
                            <span className="numeric shrink-0 text-sm font-black">{item.price}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function RecentPurchases({ purchases, participants, myParticipantId = null, limit = 8 }: {
  purchases: PurchaseRow[];
  participants: Map<string, string>;
  /** Partecipante collegato alla sessione: evidenzia i suoi acquisti. */
  myParticipantId?: string | null;
  /** Quanti acquisti mostrare (default 8: la vista ridotta nell'asta). */
  limit?: number;
}) {
  const latest = purchases.slice(0, limit);
  // L'ultimo acquisto ancora attivo è il primo della lista (ordinata per created_at desc).
  const hero = latest.find((p) => !p.released_at) ?? null;
  const rest = latest.filter((p) => p !== hero);

  const buyerName = (purchase: PurchaseRow) => participants.get(purchase.participant_id) ?? "—";
  const isMine = (purchase: PurchaseRow) =>
    myParticipantId != null && purchase.participant_id === myParticipantId;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Ultimo acquisto: card separata, più alta; verde se è un acquisto del partecipante corrente. */}
      {hero ? (
        <section
          className={cn(
            "rounded-[1.6rem] border p-4 shadow-sm sm:p-5",
            isMine(hero)
              ? "border-[var(--brand)]/40 bg-[var(--brand-soft)] ring-1 ring-inset ring-[var(--brand)]/30"
              : "border-[var(--line)] bg-[var(--surface)]"
          )}
        >
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]">Ultimo acquisto</p>
          <div className="mt-3 flex items-center gap-3 sm:gap-4">
            <RoleBadge role={hero.role} soft />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-black tracking-[-0.02em] sm:text-2xl">{hero.player_name}</p>
              <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                {buyerName(hero)} · {hero.real_team}
              </p>
            </div>
            {hero.released_at ? (
              <span className="shrink-0 rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">
                Svincolato
              </span>
            ) : null}
            <p className="numeric shrink-0 text-2xl font-black text-[var(--brand-dark)] sm:text-3xl">{hero.price}</p>
          </div>
        </section>
      ) : null}

      {/* Storico: lista scrollabile dentro la card, la pagina non scorre. */}
      {latest.length === 0 ? (
        <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-black">Ultimi acquisti</h2>
              <p className="mt-0.5 text-sm text-[var(--muted)]">Storico dell&apos;asta</p>
            </div>
            <CheckCircle2 className="size-5 text-[var(--muted)]" />
          </div>
          <p className="mt-4 rounded-xl bg-[var(--surface-soft)] p-3 text-sm text-[var(--muted)]">
            Nessun acquisto ancora. Il primo arriverà dopo l&apos;aggiudicazione del giocatore all&apos;asta.
          </p>
        </section>
      ) : rest.length > 0 ? (
        <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
          <div>
            <h2 className="font-black">Ultimi acquisti</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">Storico dell&apos;asta</p>
          </div>
          <div className="mt-4 max-h-72 space-y-2.5 overflow-y-auto pr-1 sm:max-h-96">
            {rest.map((purchase) => {
              const mine = isMine(purchase);
              return (
                <div
                  key={purchase.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-2.5 py-2.5 sm:px-3",
                    mine
                      ? "bg-[var(--brand-soft)] ring-1 ring-inset ring-[var(--brand)]/40"
                      : "bg-neutral-100"
                  )}
                >
                  <RoleBadge role={purchase.role} soft />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate font-black text-sm", purchase.released_at && "text-[var(--muted)] line-through")}>
                      {purchase.player_name}
                    </p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {buyerName(purchase)} · {purchase.real_team}
                    </p>
                  </div>
                  {purchase.released_at ? (
                    <span className="shrink-0 rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">
                      Svincolato
                    </span>
                  ) : null}
                  <p className={cn("numeric shrink-0 font-black", mine && "text-[var(--brand-dark)]")}>{purchase.price}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Svincola un giocatore acquistato: mostra il rimborso e chiede conferma. */
export function ReleaseButton({ playerId, playerName, price, releaseRefund, leagueCode }: {
  playerId: string;
  playerName: string;
  price: number;
  releaseRefund: ReleaseRefund;
  leagueCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { releasePlayer } = useAuctionActions();
  const refund = refundForRelease(releaseRefund, price);

  // Lo svincolo è sempre possibile (nessuna politica lo disabilita).

  async function confirmRelease() {
    setPending(true);
    const res = await releasePlayer(playerId, leagueCode);
    setPending(false);
    setOpen(false);
    if (!res.ok) {
      toast.error(res.message);
    }
  }

  return (
    <>
      <button
        type="button"
        title={refund > 0 ? `Svincola ${playerName} (+${refund} crediti)` : `Svincola ${playerName} (0 crediti)`}
        aria-label={`Svincola ${playerName}`}
        onClick={() => setOpen(true)}
        className="pressable grid size-7 shrink-0 place-items-center rounded-md border border-[var(--line)] text-[var(--muted)] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
      >
        <X className="size-4" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            className="surface-shadow w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5"
          >
            <h3 className="text-lg font-black tracking-tight text-[var(--ink)]">Svincolare {playerName}?</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              Il giocatore tornerà disponibile e riceverai{" "}
              <span className="font-black text-[var(--brand-dark)]">+{refund}</span> crediti in cassa.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Annulla
              </Button>
              <Button onClick={confirmRelease} disabled={pending}>
                {pending ? "Svincolo..." : "Svincola"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0]?.charAt(1) ?? "";
  return (first + second).toUpperCase();
}

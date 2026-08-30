"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Hourglass, PauseCircle, Users } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { AuctionStage, RecentPurchases, ReleaseButton, RoleBadge, TeamsOverview } from "@/components/auction/parts";
import { MovedAwayNotice } from "@/components/auction/moved-away-notice";
import { PHASE_LABELS, type ReleaseRefund } from "@fantasta/domain/auction";
import { AuctionTimer } from "@/components/auction/auction-timer";
import { BidControls } from "@/components/auction/bid-controls";
import { NominatePanel } from "@/components/auction/nominate-panel";
import { ResultsSection } from "@/components/auction/results";
import type { PlayerRole } from "@fantasta/domain/auction";
import type { LeagueState, PurchaseRow, TeamSummary } from "@fantasta/domain/state";
import { useLeagueRealtime } from "@/hooks/use-league-realtime";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type TabId = "asta" | "acquisti" | "squadre" | "rosa";

const TABS: { id: TabId; label: string }[] = [
  { id: "asta", label: "Asta" },
  { id: "acquisti", label: "Acquisti" },
  { id: "squadre", label: "Squadre" },
  { id: "rosa", label: "Rosa" },
];

export function ParticipantView({ state, inviteCode, realtimeEnabled, teamMovedEventsEnabled, homeHref = "/" }: {
  state: LeagueState;
  inviteCode: string;
  /** Il renderer LAN locale gestisce il proprio WebSocket. */
  realtimeEnabled?: boolean;
  teamMovedEventsEnabled?: boolean;
  /** Nel contesto desktop punta a /local/home con il parametro server. */
  homeHref?: string;
}) {
  useLeagueRealtime(state.league.id, realtimeEnabled ?? true);
  const [tab, setTab] = useState<TabId>("asta");
  const [movedAway, setMovedAway] = useState(false);

  // Se la squadra viene spostata su un altro dispositivo mentre questa pagina
  // è aperta, il realtime non arriva (la RLS nasconde la riga al vecchio
  // utente): il dispositivo che ha rientrato lo segnala con un broadcast.
  useEffect(() => {
    if (teamMovedEventsEnabled === false) return;
    const myTeamName = state.me?.team_name;
    if (!myTeamName) return;
    const supabase = createClient();
    const channel = supabase.channel(`team-moved:${state.league.id}`);
    channel.on("broadcast", { event: "team-moved" }, (payload) => {
      if (payload.payload?.team_name === myTeamName) {
        setMovedAway(true);
      }
    });
    void channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [state.league.id, state.me?.team_name, teamMovedEventsEnabled]);

  const participantsByName = useMemo(
    () => new Map(state.participants.map((p) => [p.id, p.team_name])),
    [state.participants]
  );
  const myTeam = state.teams.find((team) => team.participant.id === state.me?.id) ?? null;
  const leaderName =
    state.activeAuction?.highest_bidder_id != null
      ? participantsByName.get(state.activeAuction.highest_bidder_id) ?? null
      : null;
  const isMyTurn = Boolean(state.nextCaller && state.me && state.nextCaller.id === state.me.id);
  const code = state.league.invite_code || inviteCode;
  const status = state.league.status;

  if (movedAway) {
    return <MovedAwayNotice teamName={state.me?.team_name ?? ""} inviteCode={code} />;
  }

  const showTabs = (status === "LIVE" || status === "PAUSED") && Boolean(myTeam);
  const astaAlert = Boolean(state.activeAuction) || isMyTurn;

  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color:oklch(0.975_0.006_155/0.94)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href={homeHref} className="shrink-0"><Logo /></Link>
          <p className="hidden min-w-0 flex-1 truncate text-sm font-black sm:block">{state.league.name}</p>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-black text-[var(--muted)] sm:inline-flex">
              <span className="numeric text-[var(--ink)]">{code}</span>
            </span>
            {myTeam && status !== "COMPLETED" ? (
              <span className="rounded-xl bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-black text-[var(--brand-dark)] numeric">
                {myTeam.participant.budget_remaining} cr
              </span>
            ) : null}
          </div>
        </div>

        {showTabs ? (
          <div className="mx-auto max-w-6xl px-3 pb-2.5 sm:px-6">
            <div role="tablist" aria-label="Sezioni della lega" className="grid grid-cols-4 gap-1 rounded-2xl bg-[var(--surface-soft)] p-1">
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`participant-panel-${id}`}
                  className={cn(
                    "relative flex items-center justify-center rounded-xl px-2 py-2.5 text-xs font-black transition-colors",
                    tab === id
                      ? "bg-[var(--surface)] text-[var(--brand-dark)] shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  )}
                >
                  {label}
                  {id === "asta" && astaAlert && tab !== id ? (
                    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500 animate-pulse" aria-label="Asta attiva" />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-3 sm:px-6 sm:pt-5 lg:px-8">
        {status === "SETUP" || status === "LOBBY" ? (
          <LobbyWait state={state} />
        ) : null}

        {status === "PAUSED" && myTeam ? (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
            <PauseCircle className="size-5 shrink-0" /> Asta messa in pausa dall&apos;admin. Riceverai un segnale alla ripresa.
          </div>
        ) : null}

        {(status === "LIVE" || status === "PAUSED") && myTeam ? (
          <div className="space-y-3 sm:space-y-5">
            <div id={`participant-panel-${tab}`} role="tabpanel" aria-label={TABS.find((item) => item.id === tab)?.label}>
            {tab === "asta" ? (
              state.activeAuction ? (
                <>
                  <AuctionStage auction={state.activeAuction} leaderName={leaderName} myParticipantId={myTeam?.participant.id} />
                  <AuctionTimer
                    deadline={state.activeAuction.bid_deadline}
                    auctionId={state.activeAuction.id}
                    leagueCode={code}
                    paused={status === "PAUSED"}
                  />
                  <BidControls
                    auction={state.activeAuction}
                    me={myTeam.participant}
                    slots={state.slots}
                    ownedByRole={myTeam.ownedByRole}
                    minBid={state.league.min_bid}
                    leagueCode={code}
                  />
                </>
              ) : isMyTurn ? (
                <NominatePanel availablePlayers={state.availablePlayers} phase={state.phase} asteMode={state.asteMode} leagueCode={code} />
              ) : (
                <>
                  <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-5 text-center">
                    <Hourglass className="mx-auto size-7 text-[var(--brand)]" />
                    <p className="mt-2 font-black">Tocca chiamare a</p>
                    <p className="mt-1 text-2xl font-black tracking-tight text-[var(--brand-dark)]">
                      {state.nextCaller?.team_name ?? "—"}
                    </p>
                    {state.asteMode === "per_ruoli" ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-soft)] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[var(--muted)]">
                        Fase {PHASE_LABELS[state.phase]}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm text-[var(--muted)]">Prepara la strategia sul tuo listone mentre aspetti.</p>
                  </section>
                  <LastPurchaseHighlight purchases={state.purchases} participants={participantsByName} myParticipantId={state.me?.id ?? null} />
                </>
              )
            ) : null}

            {tab === "acquisti" ? (
              <RecentPurchases purchases={state.purchases} participants={participantsByName} myParticipantId={state.me?.id ?? null} limit={state.purchases.length} />
            ) : null}

            {tab === "squadre" ? (
              <TeamsOverview
                teams={state.teams.filter((team) => team.participant.id !== state.me?.id)}
                slots={state.slots}
                highlightTeamId={state.activeAuction?.highest_bidder_id ?? null}
                caption={`${state.participants.length - (state.me ? 1 : 0)} squadre avversarie in corsa. Tocca una squadra per vedere la rosa.`}
                expandable
              />
            ) : null}

            {tab === "rosa" ? <MyRoster team={myTeam} releaseRefund={state.releaseRefund} leagueCode={code} /> : null}
            </div>
          </div>
        ) : null}

        {status === "COMPLETED" ? <ResultsSection state={state} scope="participant" /> : null}
      </main>
    </div>
  );
}

/** Ultimo acquisto in evidenza, mostrato mentre si attende la prossima chiamata. */
function LastPurchaseHighlight({ purchases, participants, myParticipantId }: {
  purchases: PurchaseRow[];
  participants: Map<string, string>;
  myParticipantId: string | null;
}) {
  // purchases è ordinato per created_at decrescente: il primo acquisto ancora attivo
  // (non svincolato) è l'ultimo fatto realmente.
  const last = purchases.find((p) => !p.released_at);
  if (!last) return null;
  const buyer = participants.get(last.participant_id) ?? "—";
  const isMine = myParticipantId != null && last.participant_id === myParticipantId;
  return (
    <section
      className={cn(
        "rounded-[1.4rem] border p-5",
        isMine
          ? "border-[var(--brand)]/40 bg-[var(--brand-soft)] ring-1 ring-inset ring-[var(--brand)]/30"
          : "border-[var(--line)] bg-[var(--surface)]"
      )}
    >
      <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]">Ultimo acquisto</p>
      <div className="mt-3 flex items-center gap-3">
        <RoleBadge role={last.role} soft />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-black tracking-[-0.02em]">{last.player_name}</p>
          <p className="truncate text-sm text-[var(--muted)]">{last.real_team}</p>
        </div>
        <div className="text-right">
          <p className="numeric text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">
            {buyer}
          </p>
          <p className="numeric text-2xl font-black leading-tight text-[var(--brand-dark)]">
            {last.price} <span className="text-xs font-bold text-[var(--muted)]">cr</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function MyRoster({ team, releaseRefund, leagueCode }: {
  team: TeamSummary;
  releaseRefund: ReleaseRefund;
  leagueCode: string;
}) {
  const roles: PlayerRole[] = ["P", "D", "C", "A"];
  return (
    <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-black">La mia rosa ({team.rosterSize} giocatori)</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Spesi <span className="numeric font-black text-[var(--ink)]">{team.spent}</span> crediti · rimasti{" "}
            <span className="numeric font-black text-[var(--brand-dark)]">{team.participant.budget_remaining}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((role) => (
            <span key={role} className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-soft)] py-1 pl-1 pr-2 text-xs font-black">
              <RoleBadge role={role} soft />
              <span className="numeric">{team.ownedByRole[role]}</span>
            </span>
          ))}
        </div>
      </div>

      {team.roster.length === 0 ? (
        <p className="mt-4 rounded-xl bg-[var(--surface-soft)] p-3 text-sm text-[var(--muted)]">
          Ancora nessun acquisto. La prima offerta è tutte le volte la più emozionante.
        </p>
      ) : (
        <div className="mt-4 space-y-1.5">
          {[...team.roster].reverse().map((item) => (
            <RosterRow
              key={item.id}
              item={{ player_id: item.player_id, price: item.price, player_name: item.player_name, real_team: item.real_team }}
              role={item.role}
              releaseRefund={releaseRefund}
              leagueCode={leagueCode}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RosterRow({ item, role, releaseRefund, leagueCode }: {
  item: { player_id: string; price: number; player_name: string; real_team: string };
  role: PlayerRole;
  releaseRefund: ReleaseRefund;
  leagueCode: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-[var(--surface-soft)] px-3 py-2">
      <RoleBadge role={role} soft />
      <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.player_name}</span>
      <span className="max-w-[5.5rem] shrink truncate text-xs text-[var(--muted)]">{item.real_team}</span>
      <span className="numeric shrink-0 text-sm font-black">{item.price}</span>
      <ReleaseButton playerId={item.player_id} playerName={item.player_name} price={item.price} releaseRefund={releaseRefund} leagueCode={leagueCode} />
    </div>
  );
}

function LobbyWait({ state }: { state: LeagueState }) {
  return (
    <div className="space-y-5">
      <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-5 text-center sm:p-7">
        <span className="grid size-12 mx-auto place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]"><Users className="size-6" /></span>
        <h1 className="mt-4 text-2xl font-black tracking-[-0.03em]">Sei nella lobby</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">L&apos;admin avvierà l&apos;asta quando tutti i partecipanti saranno collegati.</p>
      </section>
      <TeamsOverview teams={state.teams} slots={state.slots} caption={`${state.participants.length} collegati su ${state.league.participant_limit} attesi.`} />
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  CirclePause,
  CirclePlay,
  Copy,
  Gavel,
  House,
  QrCode,
  RotateCcw,
  Square,
  Trophy,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { AuctionStage, RecentPurchases, TeamsOverview } from "@/components/auction/parts";
import { AuctionTimer } from "@/components/auction/auction-timer";
import { RostersColumns } from "@/components/auction/rosters-columns";
import { ResultsSection } from "@/components/auction/results";
import { PHASE_LABELS, PHASE_ORDER, type PlayerRole } from "@fantasta/domain/auction";
import { useAuctionActions } from "@/components/auction/auction-actions";
import type { LeagueState } from "@fantasta/domain/state";
import { cn } from "@/lib/utils";
import { useLeagueRealtime } from "@/hooks/use-league-realtime";
import { useLanOrigin } from "@/hooks/use-lan-origin";

export function AdminView({ state, inviteCode, realtimeEnabled, lobbyUrl: lobbyUrlProp, homeHref = "/" }: {
  state: LeagueState;
  inviteCode: string;
  /** Il renderer locale gestisce gli eventi WebSocket e passa false qui. */
  realtimeEnabled?: boolean;
  /** Nel contesto desktop il link invito è /local/league con il parametro server: lo calcola la shell locale. */
  lobbyUrl?: string | null;
  /** Nel contesto desktop punta a /local/home con i parametri server/session. */
  homeHref?: string;
}) {
  useLeagueRealtime(state.league.id, realtimeEnabled ?? true);
  const code = state.league.invite_code || inviteCode;

  const [tab, setTab] = useState<"asta" | "squadre">("asta");
  const [pendingAward, startAward] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [pendingTransition, startTransitionRpc] = useTransition();
  const [copied, setCopied] = useState(false);
  const { origin } = useLanOrigin();
  const { awardPlayer, cancelAuction: cancelAuctionCommand, setLeaguePhase, setLeagueStatus } = useAuctionActions();
  const lobbyUrl = lobbyUrlProp ?? (origin ? `${origin}/league/${code}` : null);

  const participantsByName = useMemo(
    () => new Map(state.participants.map((p) => [p.id, p.team_name])),
    [state.participants]
  );
  const leaderName =
    state.activeAuction?.highest_bidder_id != null
      ? participantsByName.get(state.activeAuction.highest_bidder_id) ?? null
      : null;
  const leaderPrice = state.activeAuction?.current_bid ?? 0;
  const status = state.league.status;

  function transitionTo(next: LeagueState["league"]["status"]) {
    startTransitionRpc(async () => {
      const res = await setLeagueStatus(state.league.id, next, code);
      if (!res.ok) toast.error(res.message);
    });
  }

  function changePhase(phase: PlayerRole) {
    if (phase === state.phase || pendingTransition) return;
    startTransitionRpc(async () => {
      const res = await setLeaguePhase(state.league.id, phase, code);
      if (!res.ok) toast.error(res.message);
    });
  }

  function award() {
    if (!state.activeAuction) return;
    startAward(async () => {
      const res = await awardPlayer(state.activeAuction!.id, code);
      if (!res.ok) toast.error(res.message);
      setConfirming(false);
    });
  }

  function cancelAuction() {
    if (!state.activeAuction) return;
    startAward(async () => {
      const res = await cancelAuctionCommand(state.activeAuction!.id, code);
      if (!res.ok) toast.error(res.message);
      setConfirmingCancel(false);
    });
  }

  function endAuction() {
    startAward(async () => {
      // Se c'è un giocatore all'asta lo riporta disponibile prima di chiudere.
      if (state.activeAuction) {
        const cancel = await cancelAuctionCommand(state.activeAuction.id, code);
        if (!cancel.ok) {
          toast.error(cancel.message);
          setConfirmingEnd(false);
          return;
        }
      }
      const res = await setLeagueStatus(state.league.id, "COMPLETED", code);
      if (!res.ok) toast.error(res.message);
      setConfirmingEnd(false);
    });
  }

  return (
    <div className="min-h-dvh bg-[var(--background)] pb-28 xl:pb-16">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color:oklch(0.975_0.006_155/0.92)] px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link href={homeHref} className="shrink-0"><Logo /></Link>
          <p className="hidden min-w-0 flex-1 truncate text-sm font-black lg:block">{state.league.name}</p>
          <Link
            href={homeHref}
            className="pressable inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-sm font-black text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          >
            <House className="size-4" /> Home
          </Link>
        </div>
      </header>

      <main className="px-4 pt-5 sm:px-6 lg:px-8">
        {/* LOBBY / SETUP: QR + partecipanti + avvio */}
        {(status === "SETUP" || status === "LOBBY") && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <section className="surface-shadow rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7">
              <h1 className="text-2xl font-black tracking-[-0.03em]">Lobby aperta</h1>
              <p className="mt-1 max-w-lg text-sm leading-6 text-[var(--muted)]">
                Fai scansionare il QR ai partecipanti: entreranno direttamente nella lobby con nome e squadra.
                L&apos;asta parte quando vuoi.
              </p>

              <div className="mt-6 grid items-center gap-6 sm:grid-cols-[200px_1fr]">
                <div className="grid place-items-center rounded-3xl border border-[var(--line)] bg-white p-5 shadow-sm">
                  {lobbyUrl ? (
                    <QRCodeSVG value={lobbyUrl} size={160} level="M" fgColor="#183328" />
                  ) : (
                    <span className="px-4 text-center text-xs font-semibold text-[var(--muted)]">Calcolo URL della lobby…</span>
                  )}
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">Codice invito</p>
                  <p className="numeric mt-1 text-4xl font-black tracking-[0.08em] text-[var(--brand-dark)]">{code}</p>
                  <Button
                    variant="secondary"
                    className="mt-4 w-full"
                    disabled={!lobbyUrl}
                    onClick={() => {
                      if (!lobbyUrl) return;
                      void navigator.clipboard.writeText(lobbyUrl).then(
                        () => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        },
                        (cause) => toast.error("Copia non riuscita", { description: cause instanceof Error ? cause.message : undefined })
                      );
                    }}
                  >
                    <Copy className="size-4" /> {copied ? "Link copiato" : "Copia link"}
                  </Button>

                  {origin && origin !== window.location.origin ? (
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      IP di rete locale rilevato automaticamente: il link funziona da dispositivi sulla stessa Wi-Fi del Mac.
                    </p>
                  ) : null}
                  <Button
                    size="lg"
                    className="mt-5 w-full"
                    disabled={pendingTransition || state.participants.length === 0}
                    onClick={() => transitionTo("LIVE")}
                  >
                    <CirclePlay className="size-5" /> Inizia asta
                  </Button>
                  {state.participants.length === 0 ? (
                    <p className="mt-2 text-center text-xs text-[var(--muted)]">Serve almeno un partecipante in lobby.</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Partecipanti" value={`${state.participants.length}/${state.league.participant_limit}`} />
                <Stat label="Crediti squadra" value={`${state.league.initial_budget}`} />
                <Stat label="Offerta minima" value={`${state.league.min_bid}`} />
              </div>
            </section>

            <TeamsOverview teams={state.teams} slots={state.slots} caption={`${state.participants.length} collegati.`} />
          </div>
        )}

        {/* LIVE / PAUSED */}
        {(status === "LIVE" || status === "PAUSED") && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {state.asteMode === "per_ruoli" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-[var(--muted)]">Seleziona fase:</span>
                    <div className="flex rounded-lg bg-[var(--surface-soft)] p-0.5">
                      {PHASE_ORDER.map((phase) => (
                        <button
                          key={phase}
                          type="button"
                          onClick={() => changePhase(phase)}
                          disabled={pendingTransition || phase === state.phase}
                          aria-pressed={phase === state.phase}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-black transition-colors",
                            phase === state.phase
                              ? "bg-[var(--brand)] text-white shadow-sm"
                              : "text-[var(--muted)] hover:text-[var(--ink)]"
                          )}
                        >
                          {phase === state.phase ? PHASE_LABELS[phase] : phase}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={pendingAward || pendingTransition}
                onClick={() => setConfirmingEnd(true)}
              >
                <Square className="size-4" /> Termina asta
              </Button>
            </div>

            {/* Tabs della regia: Asta / Squadre */}
            <div className="grid w-full max-w-sm grid-cols-2 gap-1 rounded-2xl bg-[var(--surface-soft)] p-1 sm:max-w-xs">
              {([
                { id: "asta", label: "Asta" },
                { id: "squadre", label: "Squadre" },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={tab === id}
                  className={cn(
                    "flex items-center justify-center rounded-xl px-3 py-2.5 text-sm font-black transition-colors",
                    tab === id
                      ? "bg-[var(--surface)] text-[var(--brand-dark)] shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {confirmingEnd ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm">
                <p className="font-black text-red-800">Terminare definitivamente l&apos;asta?</p>
                <p className="mt-1 leading-6 text-red-700">
                  {state.activeAuction
                    ? `Il giocatore all'asta (${state.activeAuction.player.name}) tornerà disponibile. `
                    : ""}
                  Le rose e i crediti attuali resteranno definitivi: i partecipanti vedranno la dashboard finale.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setConfirmingEnd(false)} disabled={pendingAward}>No, continua</Button>
                  <Button variant="danger" onClick={endAuction} disabled={pendingAward}>
                    <Square className="size-4" /> Sì, termina
                  </Button>
                </div>
              </div>
            ) : null}

            {tab === "asta" && (
            <>
            {status === "PAUSED" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                <span className="flex items-center gap-2"><CirclePause className="size-5" /> Asta in pausa</span>
                <Button size="sm" variant="secondary" disabled={pendingTransition} onClick={() => transitionTo("LIVE")}>
                  <CirclePlay className="size-4" /> Riprendi
                </Button>
              </div>
            ) : null}

            {state.activeAuction ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]">
                <div className="space-y-5">
                  <AuctionStage auction={state.activeAuction} leaderName={leaderName} />
                  <AuctionTimer
                    deadline={state.activeAuction.bid_deadline}
                    auctionId={state.activeAuction.id}
                    leagueCode={code}
                    paused={status === "PAUSED"}
                  />
                </div>
                <div className="space-y-5">
                  <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
                    {!confirming ? (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="font-black">Controlli asta</h2>
                          <p className="mt-0.5 text-sm text-[var(--muted)]">
                            Aggiudicazione automatica allo scadere del timer: puoi anche chiudere prima.
                          </p>
                        </div>
                        <Gavel className="size-5 shrink-0 text-[var(--brand)]" />
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-[var(--brand-soft)]/70 p-4 text-center">
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--brand-dark)]">Conferma assegnazione</p>
                        <p className="mt-2 text-xl font-black leading-tight">{state.activeAuction.player.name}</p>
                        <p className="font-bold text-[var(--muted)]">
                          → {leaderName ?? "—"} · <span className="numeric">{leaderPrice}</span> crediti
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pendingAward}>Annulla</Button>
                          <Button onClick={award} disabled={pendingAward}>
                            <Trophy className="size-5" /> {pendingAward ? "Aggiudico..." : "Conferma"}
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="mt-4 space-y-2">
                      {!confirming ? (
                        <>
                          <Button
                            className="w-full"
                            onClick={() => setConfirming(true)}
                            disabled={!leaderName || pendingAward}
                          >
                            <Trophy className="size-5" /> Aggiudica ora{leaderName ? ` a ${leaderPrice}` : ""}
                          </Button>
                          <div className="grid grid-cols-2 gap-2">
                            <Button variant="danger" onClick={() => setConfirmingCancel(true)} disabled={!leaderName || pendingAward}>
                              Annulla asta
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={pendingTransition}
                              onClick={() => transitionTo("PAUSED")}
                            >
                              <CirclePause className="size-5" /> Pausa
                            </Button>
                          </div>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          className="w-full"
                          disabled={pendingTransition}
                          onClick={() => transitionTo("PAUSED")}
                        >
                          <CirclePause className="size-5" /> Pausa
                        </Button>
                      )}
                    </div>
                  </section>

                  {!confirmingCancel ? null : (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm">
                      <p className="font-black text-red-800">Annullare l&apos;asta per {state.activeAuction.player.name}?</p>
                      <p className="mt-1 text-red-700">Le offerte verranno eliminate e il giocatore tornerà disponibile.</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setConfirmingCancel(false)}>No, continua</Button>
                        <Button variant="danger" onClick={cancelAuction} disabled={pendingAward}>
                          <RotateCcw className="size-4" /> Sì, annulla
                        </Button>
                      </div>
                    </div>
                  )}

                  <RecentPurchases purchases={state.purchases} participants={participantsByName} myParticipantId={state.me?.id ?? null} innerScroll={false} />
                </div>
              </div>
            ) : (
              <section className="mb-5 w-full rounded-[1.4rem] border border-dashed border-[var(--line)] bg-[var(--surface)] p-6 text-center">
                <Users className="mx-auto size-7 text-[var(--brand)]" />
                <p className="mt-2 font-black">In attesa della chiamata</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Deve chiamare un giocatore:{" "}
                  <strong className="text-[var(--ink)]">{state.nextCaller?.team_name ?? "—"}</strong>
                </p>
                {state.purchases.length > 0 ? (
                  <div className="mt-5 text-left">
                    <RecentPurchases purchases={state.purchases} participants={participantsByName} myParticipantId={state.me?.id ?? null} innerScroll={false} />
                  </div>
                ) : null}
              </section>
            )}
            </>
            )}

            {/* Tab Squadre: rose di tutte le squadre in blocchi verticali apribili */}
            {tab === "squadre" && (
              <RostersColumns teams={state.teams} slots={state.slots} releaseRefund={state.releaseRefund} leagueCode={code} />
            )}
          </div>
        )}

        {status === "COMPLETED" ? <ResultsSection state={state} scope="admin" /> : null}

        {status === "SETUP" || status === "LOBBY" ? (
          <footer className="mt-6 flex items-center justify-center gap-2 pb-4 text-xs text-[var(--muted)]">
            <QrCode className="size-4" /> Condividi anche il link manuale nei gruppi: stesso effetto del QR.
          </footer>
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="numeric mt-0.5 text-xl font-black">{value}</p>
    </div>
  );
}

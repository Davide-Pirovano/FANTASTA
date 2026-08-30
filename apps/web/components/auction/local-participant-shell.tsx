"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { LocalLanClient, createLocalAuctionActions } from "@fantasta/desktop/client";
import type { LeagueState } from "@fantasta/domain/state";
import { Button } from "@/components/ui/button";
import { AuctionActionsProvider } from "@/components/auction/auction-actions";
import { ParticipantView } from "@/components/auction/participant-view";

export function LocalParticipantShell({ baseUrl, inviteCode }: { baseUrl: string; inviteCode: string }) {
  const [client, setClient] = useState<LocalLanClient | null>(null);
  const [state, setState] = useState<LeagueState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `fantasta:lan-session:${new URL(baseUrl).origin}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          let sessionId = window.localStorage.getItem(storageKey);
          if (!sessionId) {
            const created = await LocalLanClient.createSession(baseUrl);
            sessionId = created.sessionId;
            window.localStorage.setItem(storageKey, sessionId);
          }
          setClient(new LocalLanClient(baseUrl, sessionId));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Impossibile creare la sessione locale");
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [baseUrl, storageKey]);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const next = await client.getLeagueState(inviteCode);
      if (!next) throw new Error("Lega locale non trovata");
      setState(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile aggiornare l'asta locale");
    }
  }, [client, inviteCode]);

  useEffect(() => {
    if (!client) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = client.subscribe(inviteCode, (event) => { if (event.type === "state_changed") void refresh(); });
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, [client, inviteCode, refresh]);

  const actions = useMemo(() => client ? createLocalAuctionActions(client) : null, [client]);
  if (error) return <LocalNotice title="Connessione locale non disponibile" message={error} />;
  if (!client || !state || !actions) return <LocalNotice title="Connessione alla lega…" message="Sto collegando il tuo dispositivo al PC che gestisce l'asta." />;
  if (!state.me) return <LocalJoinPanel client={client} state={state} inviteCode={inviteCode} onJoined={refresh} />;
  const homeHref = `/local/home?${new URLSearchParams({ server: baseUrl }).toString()}`;
  return (
    <AuctionActionsProvider actions={actions}>
      <ParticipantView state={state} inviteCode={inviteCode} realtimeEnabled={false} teamMovedEventsEnabled={false} homeHref={homeHref} />
    </AuctionActionsProvider>
  );
}

function LocalJoinPanel({ client, state, inviteCode, onJoined }: {
  client: LocalLanClient;
  state: LeagueState;
  inviteCode: string;
  onJoined: () => Promise<void>;
}) {
  const [teamName, setTeamName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blocked = !["SETUP", "LOBBY"].includes(state.league.status);
  const join = (rejoin: boolean) => startTransition(async () => {
    try {
      if (!teamName.trim()) throw new Error("Inserisci il nome della squadra");
      if (rejoin) await client.command("rejoinLeague", { inviteCode, teamName });
      else await client.command("joinLeague", { inviteCode, participantName: teamName, teamName });
      await onJoined();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Operazione non riuscita");
    }
  });
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-10 sm:px-6">
      <header className="text-center">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--brand-dark)]">Asta locale</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{state.league.name}</h1>
        <p className="numeric mt-2 text-sm font-semibold text-[var(--muted)]">{state.participants.length}/{state.league.participant_limit} partecipanti · {state.league.initial_budget} crediti</p>
      </header>
      <section className="rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface)] p-5 surface-shadow">
        <label className="block text-sm font-black">Nome squadra
          <input value={teamName} onChange={(event) => setTeamName(event.target.value)} disabled={pending} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 font-semibold outline-none focus:border-[var(--brand)]" placeholder="Es. FC Fantasta" />
        </label>
        {message ? <p className="mt-3 text-sm font-bold text-red-700">{message}</p> : null}
        {blocked ? <p className="mt-4 text-sm font-bold text-amber-800">La lobby è chiusa: puoi rientrare solo se avevi già una squadra.</p> : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button onClick={() => join(false)} disabled={blocked || pending}>Entra</Button>
          <Button variant="secondary" onClick={() => join(true)} disabled={pending}>Rientra</Button>
        </div>
      </section>
    </main>
  );
}

function LocalNotice({ title, message }: { title: string; message: string }) {
  return <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-4"><section className="w-full max-w-md rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface)] p-6 text-center surface-shadow"><h1 className="text-xl font-black">{title}</h1><p className="mt-2 text-sm text-[var(--muted)]">{message}</p></section></main>;
}

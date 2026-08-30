"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createLocalAuctionActions, LocalLanClient } from "@fantasta/desktop/client";
import type { LeagueState } from "@fantasta/domain/state";
import { AdminView } from "@/components/auction/admin-view";
import { AuctionActionsProvider } from "@/components/auction/auction-actions";
import { useLanOrigin } from "@/hooks/use-lan-origin";

/**
 * Ponte per Electron: usa gli stessi componenti admin del web, ma stato,
 * comandi e realtime arrivano dal server SQLite locale invece che da Supabase.
 */
export function LocalAdminShell({ baseUrl, sessionId, inviteCode }: {
  baseUrl: string;
  sessionId: string;
  inviteCode: string;
}) {
  const client = useMemo(() => new LocalLanClient(baseUrl, sessionId), [baseUrl, sessionId]);
  const actions = useMemo(() => createLocalAuctionActions(client), [client]);
  const [state, setState] = useState<LeagueState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Nel contesto desktop il link invito deve puntare al renderer locale
  // (/local/league/<CODICE>) con il parametro server verso l'IP di rete,
  // non alla route web /league/<CODICE> usata dalla modalità Supabase.
  const { origin } = useLanOrigin();
  const lobbyUrl = useMemo(() => {
    if (!origin) return null;
    const url = new URL(`/local/league/${inviteCode}`, origin);
    const server = new URL(baseUrl);
    server.hostname = new URL(origin).hostname;
    url.searchParams.set("server", server.toString());
    return url.toString();
  }, [origin, baseUrl, inviteCode]);
  const homeHref = useMemo(() => {
    const params = new URLSearchParams({ server: baseUrl, session: sessionId });
    return `/local/home?${params.toString()}`;
  }, [baseUrl, sessionId]);

  const refresh = useCallback(async () => {
    try {
      const next = await client.getLeagueState(inviteCode);
      if (!next) throw new Error("Lega locale non trovata");
      setState(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile aggiornare la lega locale");
    }
  }, [client, inviteCode]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = client.subscribe(inviteCode, (event) => {
      if (event.type === "state_changed") void refresh();
    });
    return () => {
      window.clearTimeout(initialRefresh);
      unsubscribe();
    };
  }, [client, inviteCode, refresh]);

  if (error) {
    return <LocalStateNotice title="Server locale non raggiungibile" message={error} />;
  }
  if (!state) {
    return <LocalStateNotice title="Connessione alla lega locale…" message="Carico i dati dell'asta dal PC host." />;
  }
  if (!state.isOwner) {
    return <LocalStateNotice title="Regia non autorizzata" message="Questa sessione locale non è l'admin della lega." />;
  }
  return (
    <AuctionActionsProvider actions={actions}>
      <AdminView state={state} inviteCode={inviteCode} realtimeEnabled={false} lobbyUrl={lobbyUrl} homeHref={homeHref} />
    </AuctionActionsProvider>
  );
}

function LocalStateNotice({ title, message }: { title: string; message: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-4">
      <section className="w-full max-w-md rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface)] p-6 text-center surface-shadow">
        <h1 className="text-xl font-black">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{message}</p>
      </section>
    </main>
  );
}

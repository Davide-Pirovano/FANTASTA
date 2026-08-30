"use client";

import { useCallback, useMemo } from "react";
import { LocalLanClient } from "@fantasta/desktop/client";
import type { SetupInput } from "@fantasta/contracts";
import { SetupWizard } from "@/components/setup/setup-wizard";

type DesktopBridge = { saveHostConfig?: (config: { leagueCode: string }) => Promise<void> };

/** Setup desktop: lo stesso wizard web, con persistenza SQLite e eventi LAN. */
export function LocalSetupShell({ baseUrl, sessionId }: { baseUrl: string; sessionId: string }) {
  const client = useMemo(() => new LocalLanClient(baseUrl, sessionId), [baseUrl, sessionId]);
  const createLeague = useCallback(async (input: SetupInput) => {
    try {
      const league = await client.command<{ id: string; inviteCode: string; name: string }>("createLeague", input);
      const desktop = (window as Window & { fantastaDesktop?: DesktopBridge }).fantastaDesktop;
      await desktop?.saveHostConfig?.({ leagueCode: league.inviteCode });
      return { ok: true as const, league: { id: league.id, invite_code: league.inviteCode, name: league.name }, importedCount: input.players.length };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Impossibile creare la lega locale" };
    }
  }, [client]);
  const subscribeParticipantCount = useCallback((league: { invite_code: string }, onCount: (count: number) => void) => {
    const refresh = () => void client.getLeagueState(league.invite_code).then((state) => onCount(state?.participants.length ?? 0));
    refresh();
    return client.subscribe(league.invite_code, (event) => { if (event.type === "state_changed") refresh(); });
  }, [client]);
  const adminHref = useCallback((inviteCode: string) => {
    const url = new URL("/local/admin", window.location.origin);
    url.searchParams.set("server", baseUrl);
    url.searchParams.set("session", sessionId);
    url.searchParams.set("league", inviteCode);
    return url.toString();
  }, [baseUrl, sessionId]);
  const homeHref = useMemo(() => {
    const params = new URLSearchParams({ server: baseUrl, session: sessionId });
    return `/local/home?${params.toString()}`;
  }, [baseUrl, sessionId]);
  const lobbyUrlForCode = useCallback((inviteCode: string, origin: string | null) => {
    if (!origin) return null;
    const url = new URL(`/local/league/${inviteCode}`, origin);
    const server = new URL(baseUrl);
    server.hostname = new URL(origin).hostname;
    url.searchParams.set("server", server.toString());
    return url.toString();
  }, [baseUrl]);

  return <SetupWizard createLeague={createLeague} subscribeParticipantCount={subscribeParticipantCount} adminHref={adminHref} lobbyUrlForCode={lobbyUrlForCode} homeHref={homeHref} />;
}

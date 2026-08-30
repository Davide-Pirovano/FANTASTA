import type { LeagueState } from "@fantasta/domain/state";
import type { LeagueStatus } from "@fantasta/domain/state";
import type { PlayerRole } from "@fantasta/domain/auction";

export type LocalEvent =
  | { type: "connected"; leagueCode: string }
  | { type: "state_changed"; operation: string };

export type LocalLeagueSummary = {
  id: string;
  name: string;
  invite_code: string;
  status: LeagueStatus;
  participant_count: number;
  participant_limit: number;
};

export class LocalApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "LocalApiError";
  }
}

/** Client trasporto-agnostico utilizzabile dalla futura UI Electron e dai browser LAN. */
export class LocalLanClient {
  constructor(
    readonly baseUrl: string,
    readonly sessionId: string,
  ) {}

  static async createSession(baseUrl: string): Promise<LocalLanClient> {
    const response = await fetch(new URL("/api/session", baseUrl), { method: "POST" });
    const body = await response.json() as { sessionId?: string; error?: string; message?: string };
    if (!response.ok || !body.sessionId) throw new LocalApiError(body.error ?? "SESSION_ERROR", body.message ?? "Impossibile creare la sessione", response.status);
    return new LocalLanClient(baseUrl, body.sessionId);
  }

  async getLeagueState(inviteCode: string): Promise<LeagueState | null> {
    const response = await fetch(new URL(`/api/leagues/${encodeURIComponent(inviteCode)}`, this.baseUrl), { headers: this.headers() });
    if (response.status === 404) return null;
    return this.read<LeagueState>(response);
  }

  /** Elenco delle leghe di cui questa sessione è admin (per la home desktop). */
  async listLeagues(): Promise<LocalLeagueSummary[]> {
    const response = await fetch(new URL("/api/leagues", this.baseUrl), { headers: this.headers() });
    return this.read<LocalLeagueSummary[]>(response);
  }

  async command<T>(operation: string, input: Record<string, unknown>): Promise<T> {
    const response = await fetch(new URL("/api/commands", this.baseUrl), {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });
    return this.read<T>(response);
  }

  subscribe(inviteCode: string, onEvent: (event: LocalEvent) => void): () => void {
    const url = new URL("/api/events", this.websocketOrigin());
    url.searchParams.set("leagueCode", inviteCode);
    url.searchParams.set("sessionId", this.sessionId);
    const socket = new WebSocket(url);
    socket.addEventListener("message", (message) => {
      try { onEvent(JSON.parse(String(message.data)) as LocalEvent); } catch { /* messaggio non valido: ignorato */ }
    });
    return () => socket.close();
  }

  private headers(): Record<string, string> { return { "x-session-id": this.sessionId }; }

  private websocketOrigin(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  private async read<T>(response: Response): Promise<T> {
    const body = await response.json() as T & { error?: string; message?: string };
    if (!response.ok) throw new LocalApiError(body.error ?? "REQUEST_ERROR", body.message ?? "Richiesta locale non riuscita", response.status);
    return body;
  }
}

/** Implementazione locale del contratto usato dai controlli React dell'asta. */
export function createLocalAuctionActions(client: LocalLanClient) {
  const run = async (operation: string, input: Record<string, unknown>) => {
    try {
      await client.command(operation, input);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : "Operazione locale non riuscita" };
    }
  };
  return {
    placeBid: (auctionId: string, amount: number, leagueCode: string) => run("placeBid", { auctionId, amount, leagueCode }),
    resolveAuction: (auctionId: string, leagueCode: string) => run("resolveAuction", { auctionId, leagueCode }),
    awardPlayer: (auctionId: string, leagueCode: string) => run("awardPlayer", { auctionId, leagueCode }),
    nominatePlayer: (playerId: string, leagueCode: string) => run("nominatePlayer", { playerId, leagueCode }),
    setLeagueStatus: (leagueId: string, status: LeagueStatus, leagueCode: string) => run("setLeagueStatus", { leagueId, status, leagueCode }),
    setLeaguePhase: (leagueId: string, phase: PlayerRole, leagueCode: string) => run("setLeaguePhase", { leagueId, phase, leagueCode }),
    cancelAuction: (auctionId: string, leagueCode: string) => run("cancelAuction", { auctionId, leagueCode }),
    releasePlayer: (playerId: string, leagueCode: string) => run("releasePlayer", { playerId, leagueCode }),
  };
}

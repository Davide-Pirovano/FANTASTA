import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import {
  awardPlayerCommandSchema,
  cancelAuctionCommandSchema,
  deleteLeagueCommandSchema,
  joinLeagueCommandSchema,
  nominatePlayerCommandSchema,
  placeBidCommandSchema,
  releasePlayerCommandSchema,
  rejoinLeagueCommandSchema,
  resolveAuctionCommandSchema,
  setLeaguePhaseCommandSchema,
  setLeagueStatusCommandSchema,
  setupInputSchema,
  type SetupInput,
} from "@fantasta/contracts";
import { openLocalDatabase, LeagueStore, LocalStoreError } from "./database/index.js";

const jsonCommandSchema = z.object({ operation: z.string(), input: z.unknown().optional() });
const MAX_BODY_BYTES = 256_000;

export type LocalServerOptions = {
  databasePath: string;
  host?: string;
  port?: number;
};

type Client = { socket: WebSocket; leagueCode: string; sessionId: string | null };

/** HTTP/WebSocket adapter LAN. La logica dell'asta rimane interamente nel LeagueStore. */
export class LocalLanServer {
  readonly store: LeagueStore;
  private readonly httpServer: Server;
  private readonly websocketServer: WebSocketServer;
  private readonly clients = new Set<Client>();
  private readonly host: string;
  private readonly port: number;

  constructor(options: LocalServerOptions) {
    const database = openLocalDatabase(options.databasePath);
    this.store = new LeagueStore(database);
    this.host = options.host ?? "0.0.0.0";
    this.port = options.port ?? 0;
    this.httpServer = createServer((request, response) => void this.handleHttp(request, response));
    this.websocketServer = new WebSocketServer({ noServer: true });
    this.httpServer.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/api/events") {
        socket.destroy();
        return;
      }
      const leagueCode = url.searchParams.get("leagueCode");
      if (!leagueCode) {
        socket.destroy();
        return;
      }
      this.websocketServer.handleUpgrade(request, socket, head, (client) => {
        const entry = { socket: client, leagueCode, sessionId: url.searchParams.get("sessionId") };
        this.clients.add(entry);
        client.on("close", () => this.clients.delete(entry));
        client.send(JSON.stringify({ type: "connected", leagueCode }));
      });
    });
  }

  async start(): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(this.port, this.host, () => resolve());
    });
    const address = this.httpServer.address();
    return { host: this.host, port: typeof address === "object" && address ? address.port : this.port };
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.socket.close();
    this.clients.clear();
    this.websocketServer.close();
    await new Promise<void>((resolve, reject) => this.httpServer.close((error) => error ? reject(error) : resolve()));
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // CORS: la vista partecipante e la regia vengono servite dal renderer Next
    // (porta 47822), che chiama l'API del server locale su un'altra porta
    // (47821) — origini diverse. Senza questi header un browser blocca ogni
    // richiesta (e un preflight OPTIONS fallirebbe), rompendo l'accesso da
    // telefono e da app desktop degli altri partecipanti.
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-session-id",
        "access-control-max-age": "86400",
      });
      response.end();
      return;
    }
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/api/health") {
        this.send(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session") {
        const token = randomUUID();
        this.store.createSession(token, token);
        this.send(response, 201, { sessionId: token, token });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/leagues") {
        const sessionId = request.headers["x-session-id"]?.toString() ?? "";
        this.send(response, 200, this.store.listLeaguesByAdmin(sessionId));
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/leagues/")) {
        const code = decodeURIComponent(url.pathname.slice("/api/leagues/".length));
        const state = this.store.getLeagueState(code, request.headers["x-session-id"]?.toString() ?? null);
        if (!state) { this.send(response, 404, { error: "LEAGUE_NOT_FOUND" }); return; }
        this.send(response, 200, state);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands") {
        const body = jsonCommandSchema.parse(await this.readJson(request));
        const result = this.dispatch(body.operation, body.input, request.headers["x-session-id"]?.toString());
        this.send(response, 200, result);
        const input = (body.input ?? {}) as Record<string, unknown>;
        if (typeof input.leagueCode === "string") this.broadcast(input.leagueCode, { type: "state_changed", operation: body.operation });
        return;
      }
      this.send(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : error instanceof LocalStoreError ? 409 : 500;
      this.send(response, status, { error: error instanceof LocalStoreError ? error.code : "INVALID_REQUEST", message: error instanceof Error ? error.message : "Errore" });
    }
  }

  private dispatch(operation: string, rawInput: unknown, sessionId?: string) {
    const input = rawInput ?? {};
    switch (operation) {
      case "createLeague": {
        const parsed = setupInputSchema.parse(input) as SetupInput;
        if (!sessionId) throw new LocalStoreError("SESSION_NOT_FOUND", "Header x-session-id richiesto");
        const inviteCode = typeof (input as Record<string, unknown>).inviteCode === "string"
          ? (input as Record<string, unknown>).inviteCode as string
          : undefined;
        return this.store.createLeague(sessionId, parsed, inviteCode);
      }
      case "joinLeague": return this.store.joinLeague(sessionId ?? "", joinLeagueCommandSchema.parse(input));
      case "rejoinLeague": return this.store.rejoinLeague(sessionId ?? "", rejoinLeagueCommandSchema.parse(input));
      case "setLeagueStatus": { const x = setLeagueStatusCommandSchema.parse(input); return this.store.setLeagueStatus(sessionId ?? "", x.leagueId, x.status); }
      case "setLeaguePhase": { const x = setLeaguePhaseCommandSchema.parse(input); return this.store.setLeaguePhase(sessionId ?? "", x.leagueId, x.phase); }
      case "nominatePlayer": { const x = nominatePlayerCommandSchema.parse(input); return this.store.nominatePlayer(sessionId ?? "", x.playerId); }
      case "placeBid": { const x = placeBidCommandSchema.parse(input); return this.store.placeBid(sessionId ?? "", x.auctionId, x.amount); }
      case "awardPlayer": { const x = awardPlayerCommandSchema.parse(input); return this.store.awardPlayer(sessionId ?? "", x.auctionId); }
      case "resolveAuction": { const x = resolveAuctionCommandSchema.parse(input); return this.store.resolveAuction(sessionId ?? "", x.auctionId); }
      case "cancelAuction": { const x = cancelAuctionCommandSchema.parse(input); return this.store.cancelAuction(sessionId ?? "", x.auctionId); }
      case "releasePlayer": { const x = releasePlayerCommandSchema.parse(input); return this.store.releasePlayer(sessionId ?? "", x.playerId); }
      case "deleteLeague": { const x = deleteLeagueCommandSchema.parse(input); return this.store.deleteLeague(sessionId ?? "", x.leagueId); }
      default: throw new Error(`Operazione non supportata: ${operation}`);
    }
  }

  private broadcast(leagueCode: string, payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const client of this.clients) if (client.leagueCode.toUpperCase() === leagueCode.toUpperCase() && client.socket.readyState === client.socket.OPEN) client.socket.send(message);
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > MAX_BODY_BYTES) throw new Error("Payload troppo grande"); chunks.push(Buffer.from(chunk)); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private send(response: ServerResponse, status: number, payload: unknown): void {
    // Alcuni comandi (es. cambio stato) sono volutamente void: HTTP deve
    // comunque restituire JSON valido per il client condiviso.
    const body = JSON.stringify(payload === undefined ? null : payload);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    response.end(body);
  }
}

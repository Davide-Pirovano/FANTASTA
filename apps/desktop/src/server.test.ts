import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { LocalLanClient } from "./client.js";
import { LocalLanServer } from "./server.js";

test("espone health, sessione, comando createLeague e snapshot sulla LAN", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fantasta-server-"));
  const server = new LocalLanServer({ databasePath: join(directory, "fantasta.db"), host: "127.0.0.1" });
  const address = await server.start();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
    const client = await LocalLanClient.createSession(base);
    const league = await client.command<{ id: string }>("createLeague", {
        leagueName: "LAN test", inviteCode: "LAN123", participantLimit: 2, initialBudget: 100,
        minBid: 1, slots: { P: 1, D: 0, C: 0, A: 0 }, auctionTimerSeconds: 15,
        players: [{ name: "Portiere test", real_team: "Test FC", role: "P", quotation: 1, is_trequartista: false }],
    });
    assert.ok(league.id);
    const state = await client.getLeagueState("LAN123") as { league: { invite_code: string }; participants: unknown[] };
    assert.equal(state.league.invite_code, "LAN123");
    assert.equal(state.participants.length, 0);

    // La home desktop elenca le leghe della sessione admin (con conteggio partecipanti).
    const owned = await client.listLeagues();
    assert.equal(owned.length, 1);
    assert.equal(owned[0].invite_code, "LAN123");
    assert.equal(owned[0].participant_count, 0);
    assert.equal(owned[0].status, "SETUP");

    const participant = await LocalLanClient.createSession(base);
    await participant.command("joinLeague", { inviteCode: "LAN123", participantName: "Team LAN", teamName: "Team LAN" });
    const participantState = await participant.getLeagueState("LAN123");
    assert.equal(participantState?.me?.team_name, "Team LAN");
    // Una sessione partecipante non vede la lega tra quelle di cui è admin.
    assert.deepEqual(await participant.listLeagues(), []);
    assert.equal((await client.listLeagues())[0].participant_count, 1);

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/events?leagueCode=LAN123&sessionId=${client.sessionId}`);
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const event = new Promise<{ type: string; operation?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error("WebSocket event non ricevuto")); }, 1_000);
      socket.on("message", (raw) => {
        const payload = JSON.parse(raw.toString()) as { type: string; operation?: string };
        if (payload.type === "state_changed") { clearTimeout(timeout); socket.close(); resolve(payload); }
      });
      socket.once("error", reject);
    });
    await client.command("setLeagueStatus", { leagueId: league.id, leagueCode: "LAN123", status: "LOBBY" });
    assert.equal((await event).operation, "setLeagueStatus");
  } finally {
    await server.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

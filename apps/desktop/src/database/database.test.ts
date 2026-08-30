import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SetupInput } from "@fantasta/contracts";
import { openLocalDatabase } from "./database.js";
import { LeagueStore, LocalStoreError } from "./league-store.js";
import { createLocalBackup } from "./backup.js";

const setup: SetupInput = {
  leagueName: "Lega Desktop",
  participantLimit: 2,
  initialBudget: 500,
  minBid: 1,
  slots: { P: 1, D: 1, C: 1, A: 1 },
  auctionTimerSeconds: 15,
  asteMode: "per_ruoli",
  releaseRefund: "half",
  players: [
    { name: "Portiere Uno", real_team: "Roma", role: "P", quotation: 10, is_trequartista: false },
    { name: "Portiere Due", real_team: "Lazio", role: "P", quotation: 8, is_trequartista: false },
  ],
};

test("applica lo schema e crea atomicamente lega, regole e listone", () => {
  const database = openLocalDatabase(":memory:");
  try {
    const store = new LeagueStore(database);
    const admin = store.createSession("admin-token", "admin-session");
    const league = store.createLeague(admin, setup, "ABC123");
    const overview = store.getLeagueOverview("abc123");

    assert.equal(league.inviteCode, "ABC123");
    assert.deepEqual(overview ? { ...overview } : null, {
      id: league.id,
      name: "Lega Desktop",
      status: "SETUP",
      participant_limit: 2,
      initial_budget: 500,
      min_bid: 1,
      participant_count: 0,
    });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM league_rules").get() as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM players").get() as { count: number }).count, 2);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count, 1);
  } finally {
    database.close();
  }
});

test("join assegna budget e turno e protegge il nome squadra senza distinzione maiuscole", () => {
  const database = openLocalDatabase(":memory:");
  try {
    const store = new LeagueStore(database);
    store.createSession("admin-token", "admin-session");
    store.createSession("participant-one-token", "participant-one");
    store.createSession("participant-two-token", "participant-two");
    store.createLeague("admin-session", setup, "JOIN12");

    const joined = store.joinLeague("participant-one", {
      inviteCode: "join12",
      participantName: " Squadra Uno ",
      teamName: " Squadra Uno ",
    });
    assert.equal(joined.budgetRemaining, 500);
    assert.equal(joined.turnOrder, 0);
    assert.equal(joined.teamName, "Squadra Uno");

    assert.throws(
      () => store.joinLeague("participant-two", {
        inviteCode: "JOIN12",
        participantName: "SQUADRA UNO",
        teamName: "SQUADRA UNO",
      }),
      (error) => error instanceof LocalStoreError && error.code === "TEAM_ALREADY_EXISTS",
    );
    assert.equal(store.getLeagueOverview("JOIN12")?.participant_count, 1);
  } finally {
    database.close();
  }
});

test("i vincoli impediscono due aste attive per la stessa lega", () => {
  const database = openLocalDatabase(":memory:");
  try {
    const store = new LeagueStore(database);
    store.createSession("admin-token", "admin-session");
    store.createSession("participant-token", "participant-session");
    const league = store.createLeague("admin-session", setup, "LOCK12");
    const participant = store.joinLeague("participant-session", {
      inviteCode: "LOCK12",
      participantName: "Team Lock",
      teamName: "Team Lock",
    });
    const players = database.prepare("SELECT id FROM players ORDER BY name").all() as Array<{ id: string }>;

    database.prepare(`
      INSERT INTO auctions (id, league_id, player_id, nominated_by, current_bid, highest_bidder_id)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run("auction-one", league.id, players[0].id, participant.id, participant.id);

    assert.throws(() => database.prepare(`
      INSERT INTO auctions (id, league_id, player_id, nominated_by, current_bid, highest_bidder_id)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run("auction-two", league.id, players[1].id, participant.id, participant.id));
  } finally {
    database.close();
  }
});

test("un giocatore può avere un solo acquisto attivo ma può essere ricomprato dopo lo svincolo", () => {
  const database = openLocalDatabase(":memory:");
  try {
    const store = new LeagueStore(database);
    store.createSession("admin-token", "admin-session");
    store.createSession("participant-token", "participant-session");
    const league = store.createLeague("admin-session", setup, "BUY123");
    const participant = store.joinLeague("participant-session", {
      inviteCode: "BUY123",
      participantName: "Team Buy",
      teamName: "Team Buy",
    });
    const player = database.prepare("SELECT id FROM players LIMIT 1").get() as { id: string };

    const insertAuction = database.prepare(`
      INSERT INTO auctions (id, league_id, player_id, nominated_by, current_bid, highest_bidder_id, status)
      VALUES (?, ?, ?, ?, 10, ?, 'AWARDED')
    `);
    const insertPurchase = database.prepare(`
      INSERT INTO purchases (id, league_id, auction_id, participant_id, player_id, price)
      VALUES (?, ?, ?, ?, ?, 10)
    `);

    insertAuction.run("auction-one", league.id, player.id, participant.id, participant.id);
    insertAuction.run("auction-two", league.id, player.id, participant.id, participant.id);
    insertPurchase.run("purchase-one", league.id, "auction-one", participant.id, player.id);
    assert.throws(() => insertPurchase.run("purchase-two", league.id, "auction-two", participant.id, player.id));

    database.prepare("UPDATE purchases SET released_at = ? WHERE id = ?").run(new Date().toISOString(), "purchase-one");
    assert.doesNotThrow(() => insertPurchase.run("purchase-two", league.id, "auction-two", participant.id, player.id));
  } finally {
    database.close();
  }
});

test("un errore durante createLeague non lascia dati parziali", () => {
  const database = openLocalDatabase(":memory:");
  try {
    const store = new LeagueStore(database);
    store.createSession("admin-token", "admin-session");
    store.createLeague("admin-session", setup, "SAME12");

    assert.throws(() => store.createLeague("admin-session", setup, "SAME12"));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM leagues").get() as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM league_rules").get() as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM players").get() as { count: number }).count, 2);
  } finally {
    database.close();
  }
});

test("migrazioni e dati persistono dopo la riapertura del file", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "fantasta-sqlite-"));
  const databasePath = join(temporaryDirectory, "fantasta.db");

  try {
    const firstDatabase = openLocalDatabase(databasePath);
    const firstStore = new LeagueStore(firstDatabase);
    firstStore.createSession("admin-token", "admin-session");
    firstStore.createLeague("admin-session", setup, "DISK12");
    firstDatabase.close();

    const reopenedDatabase = openLocalDatabase(databasePath);
    try {
      const reopenedStore = new LeagueStore(reopenedDatabase);
      assert.equal(reopenedStore.getLeagueOverview("DISK12")?.name, "Lega Desktop");
      assert.equal(
        (reopenedDatabase.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count,
        1,
      );
    } finally {
      reopenedDatabase.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("crea un backup SQLite consistente del database locale", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "fantasta-backup-"));
  const sourcePath = join(temporaryDirectory, "source.db");
  const backupPath = join(temporaryDirectory, "backup.db");
  const database = openLocalDatabase(sourcePath);
  try {
    const store = new LeagueStore(database);
    store.createSession("admin-token", "admin-session");
    store.createLeague("admin-session", setup, "BACK12");
    assert.ok(await createLocalBackup(database, backupPath) > 0);
    const restored = openLocalDatabase(backupPath);
    try {
      assert.equal(new LeagueStore(restored).getLeagueOverview("BACK12")?.name, "Lega Desktop");
    } finally {
      restored.close();
    }
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("esegue il flusso asta locale con pausa, rilancio, auto-award e svincolo", () => {
  const database = openLocalDatabase(":memory:");
  try {
    const store = new LeagueStore(database);
    store.createSession("admin-token", "admin-session");
    store.createSession("participant-one-token", "participant-one");
    store.createSession("participant-two-token", "participant-two");
    const league = store.createLeague("admin-session", setup, "FLOW12");
    const one = store.joinLeague("participant-one", {
      inviteCode: "FLOW12", participantName: "Team One", teamName: "Team One",
    });
    const two = store.joinLeague("participant-two", {
      inviteCode: "FLOW12", participantName: "Team Two", teamName: "Team Two",
    });
    const lobbyState = store.getLeagueState("FLOW12", "participant-one");
    assert.equal(lobbyState?.league.status, "SETUP");
    assert.equal(lobbyState?.participants.length, 2);
    assert.equal(lobbyState?.me?.id, one.id);
    store.setLeagueStatus("admin-session", league.id, "LIVE");

    const players = database.prepare("SELECT id, name FROM players ORDER BY name").all() as Array<{ id: string; name: string }>;
    const firstAuction = store.nominatePlayer("participant-one", players[0].id);
    assert.equal(firstAuction.currentBid, 1);
    assert.equal(firstAuction.highestBidderId, one.id);
    const activeState = store.getLeagueState("FLOW12", "participant-two");
    assert.equal(activeState?.activeAuction?.id, firstAuction.id);
    assert.equal(activeState?.activeAuction?.highest_bidder_id, one.id);
    const raised = store.placeBid("participant-two", firstAuction.id, 15);
    assert.equal(raised.currentBid, 15);
    const firstPurchase = store.awardPlayer("admin-session", firstAuction.id);
    assert.equal(firstPurchase.participantId, two.id);
    assert.equal((database.prepare("SELECT budget_remaining FROM participants WHERE id = ?").get(two.id) as { budget_remaining: number }).budget_remaining, 485);

    const secondAuction = store.nominatePlayer("participant-one", players[1].id);
    store.setLeagueStatus("admin-session", league.id, "PAUSED");
    assert.equal((database.prepare("SELECT bid_deadline FROM auctions WHERE id = ?").get(secondAuction.id) as { bid_deadline: string | null }).bid_deadline, null);
    assert.throws(() => store.placeBid("participant-two", secondAuction.id, 10), (error) => error instanceof LocalStoreError && error.code === "LEAGUE_NOT_LIVE");
    store.setLeagueStatus("admin-session", league.id, "LIVE");
    const resumed = database.prepare("SELECT bid_deadline FROM auctions WHERE id = ?").get(secondAuction.id) as { bid_deadline: string | null };
    assert.ok(resumed.bid_deadline);
    store.placeBid("participant-one", secondAuction.id, 12);
    const secondPurchase = store.awardPlayer("admin-session", secondAuction.id);
    assert.equal(secondPurchase.price, 12);

    const released = store.releasePlayer("participant-two", players[0].id);
    assert.equal(released.releasedAt !== null, true);
    assert.equal((database.prepare("SELECT status FROM players WHERE id = ?").get(players[0].id) as { status: string }).status, "AVAILABLE");
    assert.equal((database.prepare("SELECT budget_remaining FROM participants WHERE id = ?").get(two.id) as { budget_remaining: number }).budget_remaining, 493);

    store.setLeaguePhase("admin-session", league.id, "P");
    const canceled = store.nominatePlayer("participant-two", players[0].id);
    store.cancelAuction("admin-session", canceled.id);
    assert.equal((database.prepare("SELECT status, highest_bidder_id FROM auctions WHERE id = ?").get(canceled.id) as { status: string; highest_bidder_id: string | null }).status, "CANCELLED");
    assert.equal((database.prepare("SELECT highest_bidder_id FROM auctions WHERE id = ?").get(canceled.id) as { highest_bidder_id: string | null }).highest_bidder_id, null);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM bids WHERE auction_id = ?").get(canceled.id) as { count: number }).count, 0);

    const recycled = store.nominatePlayer("participant-two", players[0].id);
    database.prepare("UPDATE auctions SET bid_deadline = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second') WHERE id = ?").run(recycled.id);
    const automatic = store.resolveAuction("participant-one", recycled.id);
    assert.equal(automatic?.price, 1);
    assert.equal(store.resolveAuction("participant-two", recycled.id), null);
  } finally {
    database.close();
  }
});

test("trasferisce una squadra a un nuovo dispositivo e conserva l'avviso per il vecchio", () => {
  const database = openLocalDatabase(":memory:");
  try {
    const store = new LeagueStore(database);
    store.createSession("admin-token", "admin-session");
    store.createSession("old-device-token", "old-device");
    store.createSession("new-device-token", "new-device");
    const league = store.createLeague("admin-session", setup, "MOVE12");
    const original = store.joinLeague("old-device", {
      inviteCode: "MOVE12", participantName: "Team Move", teamName: "Team Move",
    });

    const result = store.rejoinLeague("new-device", { inviteCode: "MOVE12", teamName: " team move " });
    assert.equal(result.moved, true);
    assert.equal(result.participant.id, original.id);
    assert.equal(result.participant.sessionId, "new-device");
    assert.equal(store.getMyTransfer("old-device", "MOVE12")?.teamName, "Team Move");
    assert.equal(store.rejoinLeague("new-device", { inviteCode: "MOVE12", teamName: "Team Move" }).moved, false);
    store.deleteLeague("admin-session", league.id);
    assert.equal(store.getLeagueOverview("MOVE12"), null);
  } finally {
    database.close();
  }
});

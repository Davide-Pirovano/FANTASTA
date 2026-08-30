import { randomBytes, randomUUID } from "node:crypto";
import {
  joinLeagueCommandSchema,
  rejoinLeagueCommandSchema,
  setupInputSchema,
  type JoinLeagueCommand,
  type RejoinLeagueCommand,
  type SetupInput,
} from "@fantasta/contracts";
import {
  buildTeamSummaries,
  maxBid,
  refundForRelease,
  type AsteMode,
  type LeagueOverview,
  type LeagueRow,
  type LeagueState,
  type LeagueStatus,
  type ParticipantRow,
  type PlayerRole,
  type PlayerRow,
  type PurchaseRow,
  type ReleaseRefund,
  type RoleSlots,
} from "@fantasta/domain";
import { type LocalDatabase, withImmediateTransaction } from "./database.js";

export type LocalLeague = {
  id: string;
  inviteCode: string;
  name: string;
};

export type LocalParticipant = {
  id: string;
  leagueId: string;
  sessionId: string;
  teamName: string;
  budgetRemaining: number;
  turnOrder: number;
};

export type LocalAuction = {
  id: string;
  leagueId: string;
  playerId: string;
  nominatedBy: string;
  currentBid: number;
  highestBidderId: string | null;
  status: "ACTIVE" | "AWARDED" | "CANCELLED";
  bidDeadline: string | null;
  version: number;
};

export type LocalPurchase = {
  id: string;
  leagueId: string;
  auctionId: string;
  participantId: string;
  playerId: string;
  price: number;
  releasedAt: string | null;
};

export class LocalStoreError extends Error {
  constructor(
    public readonly code:
      | "LEAGUE_NOT_FOUND"
      | "LEAGUE_UNAVAILABLE"
      | "LOBBY_FULL"
      | "SESSION_NOT_FOUND"
      | "TEAM_ALREADY_EXISTS"
      | "AUCTION_NOT_FOUND"
      | "PLAYER_NOT_FOUND"
      | "PLAYER_UNAVAILABLE"
      | "LEAGUE_NOT_LIVE"
      | "NOT_YOUR_TURN"
      | "ACTIVE_AUCTION_EXISTS"
      | "ROLE_SLOTS_FULL"
      | "ROSTER_FULL"
      | "BID_TOO_LOW"
      | "BID_DEADLINE_PASSED"
      | "BID_TOO_HIGH"
      | "NOT_A_MEMBER"
      | "NOT_ADMIN"
      | "NO_BIDDER"
      | "AUCTION_NOT_EXPIRED"
      | "INVALID_AUCTION_STATE"
      | "PURCHASE_NOT_FOUND"
      | "RELEASE_NOT_ALLOWED"
      | "NO_PARTICIPANTS",
    message: string,
  ) {
    super(message);
    this.name = "LocalStoreError";
  }
}

function newInviteCode() {
  return randomBytes(3).toString("hex").toUpperCase();
}

type LocalLeagueRow = {
  id: string;
  owner_session_id: string;
  status: LeagueStatus;
  participant_limit: number;
  initial_budget: number;
  min_bid: number;
  current_turn: number;
  auction_phase: PlayerRole;
  aste_mode: AsteMode;
};

export type LocalLeagueSummary = {
  id: string;
  name: string;
  invite_code: string;
  status: LeagueStatus;
  participant_limit: number;
  participant_count: number;
};

type LocalRulesRow = {
  goalkeeper_slots: number;
  defender_slots: number;
  midfielder_slots: number;
  attacker_slots: number;
  auction_timer_seconds: number;
  release_refund: ReleaseRefund;
};

type LocalAuctionRow = LocalAuction & { bid_deadline: string | null };

function toAuction(row: LocalAuctionRow): LocalAuction {
  return {
    id: row.id,
    leagueId: row.leagueId,
    playerId: row.playerId,
    nominatedBy: row.nominatedBy,
    currentBid: row.currentBid,
    highestBidderId: row.highestBidderId,
    status: row.status,
    bidDeadline: row.bidDeadline,
    version: row.version,
  };
}

function roleSlotLimit(rules: LocalRulesRow, role: PlayerRole) {
  return ({ P: rules.goalkeeper_slots, D: rules.defender_slots, C: rules.midfielder_slots, A: rules.attacker_slots })[role];
}

export class LeagueStore {
  constructor(private readonly database: LocalDatabase) {}

  createSession(tokenHash: string, id: string = randomUUID()) {
    this.database.prepare("INSERT INTO sessions (id, token_hash) VALUES (?, ?)").run(id, tokenHash);
    return id;
  }

  createLeague(ownerSessionId: string, input: SetupInput, inviteCode = newInviteCode()): LocalLeague {
    const setup = setupInputSchema.parse(input);
    const leagueId = randomUUID();

    return withImmediateTransaction(this.database, () => {
      const owner = this.database.prepare("SELECT id FROM sessions WHERE id = ?").get(ownerSessionId);
      if (!owner) throw new LocalStoreError("SESSION_NOT_FOUND", "Sessione admin non valida");

      this.database.prepare(`
        INSERT INTO leagues (
          id, owner_session_id, name, invite_code, status, participant_limit,
          initial_budget, min_bid, aste_mode
        ) VALUES (?, ?, ?, ?, 'SETUP', ?, ?, ?, ?)
      `).run(
        leagueId,
        ownerSessionId,
        setup.leagueName,
        inviteCode.toUpperCase(),
        setup.participantLimit,
        setup.initialBudget,
        setup.minBid,
        setup.asteMode,
      );

      this.database.prepare(`
        INSERT INTO league_rules (
          league_id, goalkeeper_slots, defender_slots, midfielder_slots,
          attacker_slots, auction_timer_seconds, release_refund
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        leagueId,
        setup.slots.P,
        setup.slots.D,
        setup.slots.C,
        setup.slots.A,
        setup.auctionTimerSeconds,
        setup.releaseRefund,
      );

      const insertPlayer = this.database.prepare(`
        INSERT OR IGNORE INTO players (
          id, league_id, name, real_team, role, quotation, is_trequartista
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const player of setup.players) {
        insertPlayer.run(
          randomUUID(),
          leagueId,
          player.name,
          player.real_team,
          player.role,
          player.quotation,
          player.is_trequartista ? 1 : 0,
        );
      }

      return { id: leagueId, inviteCode: inviteCode.toUpperCase(), name: setup.leagueName };
    });
  }

  listLeaguesByAdmin(adminSessionId: string): LocalLeagueSummary[] {
    return this.database.prepare(`
      SELECT l.id, l.name, l.invite_code, l.status, l.participant_limit,
        COUNT(p.id) AS participant_count
      FROM leagues l
      LEFT JOIN participants p ON p.league_id = l.id
      WHERE l.owner_session_id = ?
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `).all(adminSessionId) as LocalLeagueSummary[];
  }

  getLeagueOverview(inviteCode: string): LeagueOverview | null {
    const row = this.database.prepare(`
      SELECT
        l.id,
        l.name,
        l.status,
        l.participant_limit,
        l.initial_budget,
        l.min_bid,
        COUNT(p.id) AS participant_count
      FROM leagues l
      LEFT JOIN participants p ON p.league_id = l.id
      WHERE l.invite_code = ? COLLATE NOCASE
      GROUP BY l.id
    `).get(inviteCode) as LeagueOverview | undefined;
    return row ?? null;
  }

  getLeagueState(inviteCode: string, sessionId: string | null): LeagueState | null {
    const league = this.database.prepare(`
      SELECT l.id, l.owner_session_id AS ownerId, l.name, l.status,
        l.participant_limit AS participantLimit, l.initial_budget AS initialBudget,
        l.min_bid AS minBid, l.current_turn AS currentTurn,
        l.auction_phase AS auctionPhase, l.aste_mode AS asteMode,
        COUNT(p.id) AS participantCount
      FROM leagues l LEFT JOIN participants p ON p.league_id = l.id
      WHERE l.invite_code = ? COLLATE NOCASE
      GROUP BY l.id
    `).get(inviteCode) as {
      id: string; ownerId: string; name: string; status: LeagueStatus;
      participantLimit: number; initialBudget: number; minBid: number;
      currentTurn: number; auctionPhase: PlayerRole; asteMode: AsteMode;
      participantCount: number;
    } | undefined;
    if (!league) return null;
    const rules = this.getRules(league.id);
    if (!rules) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Regole lega non trovate");
    const slots: RoleSlots = {
      P: rules.goalkeeper_slots,
      D: rules.defender_slots,
      C: rules.midfielder_slots,
      A: rules.attacker_slots,
    };
    const participants = this.database.prepare(`
      SELECT id, display_name, team_name, budget_remaining, turn_order
      FROM participants WHERE league_id = ? ORDER BY turn_order
    `).all(league.id) as ParticipantRow[];
    const activeRaw = this.database.prepare(`
      SELECT a.id, a.current_bid, a.highest_bidder_id, a.bid_deadline,
        p.id AS player_id, p.name, p.real_team, p.role, p.quotation, p.is_trequartista
      FROM auctions a JOIN players p ON p.id = a.player_id
      WHERE a.league_id = ? AND a.status = 'ACTIVE'
    `).get(league.id) as {
      id: string; current_bid: number; highest_bidder_id: string | null;
      bid_deadline: string | null; player_id: string; name: string;
      real_team: string; role: PlayerRole; quotation: number; is_trequartista: number;
    } | undefined;
    const activeAuction = activeRaw ? {
      id: activeRaw.id,
      current_bid: activeRaw.current_bid,
      highest_bidder_id: activeRaw.highest_bidder_id,
      bid_deadline: activeRaw.bid_deadline,
      player: {
        id: activeRaw.player_id,
        name: activeRaw.name,
        real_team: activeRaw.real_team,
        role: activeRaw.role,
        quotation: activeRaw.quotation,
        is_trequartista: Boolean(activeRaw.is_trequartista),
      } satisfies PlayerRow,
    } : null;
    const purchases = this.database.prepare(`
      SELECT pu.id, pu.price, pu.created_at, pu.participant_id, pu.player_id,
        pu.released_at, p.name AS player_name, p.real_team, p.role
      FROM purchases pu JOIN players p ON p.id = pu.player_id
      WHERE pu.league_id = ? ORDER BY pu.created_at DESC
    `).all(league.id) as PurchaseRow[];
    const availablePlayers = this.database.prepare(`
      SELECT id, name, real_team, role, quotation, is_trequartista
      FROM players WHERE league_id = ? AND status = 'AVAILABLE' ORDER BY name
    `).all(league.id) as Array<{
      id: string; name: string; real_team: string; role: PlayerRole;
      quotation: number; is_trequartista: number;
    }>;
    const me = sessionId
      ? participants.find((participant) => participant.id === (this.getParticipantBySession(sessionId, league.id)?.id ?? "")) ?? null
      : null;
    const nextCaller = participants.length > 0
      ? participants[((league.currentTurn % participants.length) + participants.length) % participants.length]
      : null;
    const leagueRow: LeagueRow = {
      id: league.id,
      name: league.name,
      status: league.status,
      participant_limit: league.participantLimit,
      initial_budget: league.initialBudget,
      min_bid: league.minBid,
      participant_count: league.participantCount,
      owner_id: league.ownerId,
      invite_code: inviteCode.toUpperCase(),
      current_turn: league.currentTurn,
      auction_phase: league.auctionPhase,
      aste_mode: league.asteMode,
    };
    return {
      league: leagueRow,
      slots,
      phase: league.auctionPhase,
      asteMode: league.asteMode,
      auctionTimerSeconds: rules.auction_timer_seconds,
      releaseRefund: rules.release_refund,
      participants,
      me,
      isOwner: sessionId === league.ownerId,
      activeAuction,
      nextCaller,
      purchases,
      availablePlayers: availablePlayers.map((player) => ({ ...player, is_trequartista: Boolean(player.is_trequartista) })),
      teams: buildTeamSummaries(participants, purchases),
    };
  }

  joinLeague(sessionId: string, input: JoinLeagueCommand): LocalParticipant {
    const command = joinLeagueCommandSchema.parse(input);

    return withImmediateTransaction(this.database, () => {
      const session = this.database.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
      if (!session) throw new LocalStoreError("SESSION_NOT_FOUND", "Sessione partecipante non valida");

      const league = this.database.prepare(`
        SELECT id, status, participant_limit, initial_budget
        FROM leagues
        WHERE invite_code = ? COLLATE NOCASE
      `).get(command.inviteCode) as {
        id: string;
        status: string;
        participant_limit: number;
        initial_budget: number;
      } | undefined;

      if (!league) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega non trovata");
      if (league.status !== "SETUP" && league.status !== "LOBBY") {
        throw new LocalStoreError("LEAGUE_UNAVAILABLE", "Lega non disponibile");
      }

      const countRow = this.database
        .prepare("SELECT COUNT(*) AS count FROM participants WHERE league_id = ?")
        .get(league.id) as { count: number };
      if (countRow.count >= league.participant_limit) {
        throw new LocalStoreError("LOBBY_FULL", "Lobby completa");
      }

      const participantId = randomUUID();
      try {
        this.database.prepare(`
          INSERT INTO participants (
            id, league_id, session_id, display_name, team_name,
            budget_remaining, turn_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          participantId,
          league.id,
          sessionId,
          command.participantName,
          command.teamName,
          league.initial_budget,
          countRow.count,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("participants.league_id, participants.team_name")) {
          throw new LocalStoreError("TEAM_ALREADY_EXISTS", "Esiste già una squadra con questo nome");
        }
        throw error;
      }

      return {
        id: participantId,
        leagueId: league.id,
        sessionId,
        teamName: command.teamName,
        budgetRemaining: league.initial_budget,
        turnOrder: countRow.count,
      };
    });
  }

  rejoinLeague(sessionId: string, input: RejoinLeagueCommand) {
    const command = rejoinLeagueCommandSchema.parse(input);
    return withImmediateTransaction(this.database, () => {
      if (!this.database.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)) {
        throw new LocalStoreError("SESSION_NOT_FOUND", "Sessione partecipante non valida");
      }
      const league = this.database.prepare(
        "SELECT id FROM leagues WHERE invite_code = ? COLLATE NOCASE",
      ).get(command.inviteCode) as { id: string } | undefined;
      if (!league) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega non trovata");

      const participant = this.database.prepare(`
        SELECT id, league_id AS leagueId, session_id AS sessionId,
          team_name AS teamName, budget_remaining AS budgetRemaining,
          turn_order AS turnOrder
        FROM participants
        WHERE league_id = ? AND team_name = ? COLLATE NOCASE
      `).get(league.id, command.teamName) as LocalParticipant | undefined;
      if (!participant) throw new LocalStoreError("TEAM_ALREADY_EXISTS", "Nessuna squadra con questo nome in questa lega");
      const moved = participant.sessionId !== sessionId;
      if (!moved) {
        this.database.prepare("UPDATE participants SET connected = 1 WHERE id = ?").run(participant.id);
        return { participant: { ...participant, sessionId }, moved: false };
      }
      if (this.database.prepare(
        "SELECT 1 FROM participants WHERE league_id = ? AND session_id = ? AND id <> ?",
      ).get(league.id, sessionId, participant.id)) {
        throw new LocalStoreError("TEAM_ALREADY_EXISTS", "Questa sessione è già collegata a un'altra squadra");
      }
      this.database.prepare(`
        INSERT INTO participant_transfers (id, league_id, team_name, old_session_id, new_session_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), league.id, participant.teamName, participant.sessionId, sessionId);
      this.database.prepare(
        "UPDATE participants SET session_id = ?, connected = 1 WHERE id = ?",
      ).run(sessionId, participant.id);
      this.bumpLeague(league.id);
      return { participant: { ...participant, sessionId }, moved: true };
    });
  }

  getMyTransfer(sessionId: string, inviteCode: string) {
    return this.database.prepare(`
      SELECT t.team_name AS teamName, t.moved_at AS movedAt
      FROM participant_transfers t
      JOIN leagues l ON l.id = t.league_id
      WHERE l.invite_code = ? COLLATE NOCASE AND t.old_session_id = ?
      ORDER BY t.moved_at DESC LIMIT 1
    `).get(inviteCode, sessionId) as { teamName: string; movedAt: string } | undefined;
  }

  private getLeague(leagueId: string) {
    return this.database.prepare(`
      SELECT id, owner_session_id, status, participant_limit, initial_budget,
        min_bid, current_turn, auction_phase, aste_mode
      FROM leagues WHERE id = ?
    `).get(leagueId) as LocalLeagueRow | undefined;
  }

  private getRules(leagueId: string) {
    return this.database.prepare(`
      SELECT goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots,
        auction_timer_seconds, release_refund
      FROM league_rules WHERE league_id = ?
    `).get(leagueId) as LocalRulesRow | undefined;
  }

  private isAdmin(sessionId: string, leagueId: string) {
    return Boolean(this.database.prepare(
      "SELECT 1 FROM leagues WHERE id = ? AND owner_session_id = ?",
    ).get(leagueId, sessionId));
  }

  private getParticipantBySession(sessionId: string, leagueId: string) {
    return this.database.prepare(`
      SELECT id, league_id AS leagueId, session_id AS sessionId, display_name,
        team_name AS teamName, budget_remaining AS budgetRemaining,
        turn_order AS turnOrder
      FROM participants WHERE league_id = ? AND session_id = ?
    `).get(leagueId, sessionId) as LocalParticipant | undefined;
  }

  private isMember(sessionId: string, leagueId: string) {
    return this.isAdmin(sessionId, leagueId) || Boolean(this.getParticipantBySession(sessionId, leagueId));
  }

  private ownedCount(participantId: string, role?: PlayerRole) {
    if (role) {
      return (this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM purchases pu JOIN players p ON p.id = pu.player_id
        WHERE pu.participant_id = ? AND pu.released_at IS NULL AND p.role = ?
      `).get(participantId, role) as { count: number }).count;
    }
    return (this.database.prepare(
      "SELECT COUNT(*) AS count FROM purchases WHERE participant_id = ? AND released_at IS NULL",
    ).get(participantId) as { count: number }).count;
  }

  private totalSlots(rules: LocalRulesRow) {
    return rules.goalkeeper_slots + rules.defender_slots + rules.midfielder_slots + rules.attacker_slots;
  }

  private bumpLeague(leagueId: string) {
    this.database.prepare(`
      UPDATE leagues
      SET state_version = state_version + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(leagueId);
  }

  private audit(leagueId: string, actorSessionId: string, actionType: string, payload: object = {}) {
    this.database.prepare(`
      INSERT INTO admin_actions (league_id, actor_session_id, action_type, payload)
      VALUES (?, ?, ?, ?)
    `).run(leagueId, actorSessionId, actionType, JSON.stringify(payload));
  }

  private nextEligibleTurn(leagueId: string, fromTurn: number, phase: PlayerRole | null) {
    const league = this.getLeague(leagueId);
    const rules = this.getRules(leagueId);
    if (!league || !rules) return null;
    const participants = this.database.prepare(`
      SELECT id, turn_order FROM participants WHERE league_id = ? ORDER BY turn_order
    `).all(leagueId) as Array<{ id: string; turn_order: number }>;
    if (participants.length === 0) return null;

    for (let offset = 1; offset <= participants.length; offset += 1) {
      const participant = participants[(fromTurn + offset + participants.length) % participants.length];
      const eligible = phase
        ? this.ownedCount(participant.id, phase) < roleSlotLimit(rules, phase)
        : this.ownedCount(participant.id) < this.totalSlots(rules);
      if (eligible) return participant.turn_order;
    }
    return null;
  }

  private advanceLeague(leagueId: string) {
    const league = this.getLeague(leagueId);
    if (!league) return;
    if (league.aste_mode === "libero") {
      const next = this.nextEligibleTurn(leagueId, league.current_turn, null);
      if (next !== null) {
        this.database.prepare("UPDATE leagues SET current_turn = ? WHERE id = ?").run(next, leagueId);
        this.bumpLeague(leagueId);
      }
      return;
    }

    const phases: PlayerRole[] = ["P", "D", "C", "A"];
    const currentIndex = phases.indexOf(league.auction_phase);
    for (let index = currentIndex; index < phases.length; index += 1) {
      const phase = phases[index];
      const next = this.nextEligibleTurn(leagueId, index === currentIndex ? league.current_turn : -1, phase);
      if (next !== null) {
        this.database.prepare(`
          UPDATE leagues SET auction_phase = ?, current_turn = ? WHERE id = ?
        `).run(phase, next, leagueId);
        this.bumpLeague(leagueId);
        return;
      }
    }
  }

  private activeAuction(auctionId: string) {
    return this.database.prepare(`
      SELECT id, league_id AS leagueId, player_id AS playerId,
        nominated_by AS nominatedBy, current_bid AS currentBid,
        highest_bidder_id AS highestBidderId, status,
        bid_deadline AS bidDeadline, version
      FROM auctions WHERE id = ?
    `).get(auctionId) as LocalAuction | undefined;
  }

  private completeAuction(auctionId: string, actorSessionId: string, actionType: string): LocalPurchase {
    const auction = this.database.prepare(`
      SELECT id, league_id AS leagueId, player_id AS playerId,
        current_bid AS currentBid, highest_bidder_id AS highestBidderId,
        status FROM auctions WHERE id = ?
    `).get(auctionId) as {
      id: string; leagueId: string; playerId: string; currentBid: number;
      highestBidderId: string | null; status: string;
    } | undefined;
    if (!auction) throw new LocalStoreError("AUCTION_NOT_FOUND", "Asta inesistente");
    if (auction.status !== "ACTIVE") throw new LocalStoreError("INVALID_AUCTION_STATE", "Asta non attiva");
    if (!auction.highestBidderId) throw new LocalStoreError("NO_BIDDER", "Nessun offerente");

    const budgetUpdate = this.database.prepare(`
      UPDATE participants
      SET budget_remaining = budget_remaining - ?
      WHERE id = ? AND budget_remaining >= ?
    `).run(auction.currentBid, auction.highestBidderId, auction.currentBid);
    if (budgetUpdate.changes !== 1) throw new LocalStoreError("BID_TOO_HIGH", "Budget insufficiente");

    const playerUpdate = this.database.prepare(
      "UPDATE players SET status = 'SOLD' WHERE id = ? AND status = 'NOMINATED'",
    ).run(auction.playerId);
    if (playerUpdate.changes !== 1) throw new LocalStoreError("INVALID_AUCTION_STATE", "Stato giocatore non valido");

    this.database.prepare(`
      UPDATE auctions SET status = 'AWARDED', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        version = version + 1 WHERE id = ? AND status = 'ACTIVE'
    `).run(auction.id);
    const purchaseId = randomUUID();
    this.database.prepare(`
      INSERT INTO purchases (id, league_id, auction_id, participant_id, player_id, price)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(purchaseId, auction.leagueId, auction.id, auction.highestBidderId, auction.playerId, auction.currentBid);
    this.bumpLeague(auction.leagueId);
    this.advanceLeague(auction.leagueId);
    this.audit(auction.leagueId, actorSessionId, actionType, { purchase_id: purchaseId });
    return {
      id: purchaseId,
      leagueId: auction.leagueId,
      auctionId: auction.id,
      participantId: auction.highestBidderId,
      playerId: auction.playerId,
      price: auction.currentBid,
      releasedAt: null,
    };
  }

  setLeagueStatus(adminSessionId: string, leagueId: string, status: LeagueStatus) {
    return withImmediateTransaction(this.database, () => {
      const league = this.getLeague(leagueId);
      if (!league) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega non trovata");
      if (!this.isAdmin(adminSessionId, leagueId)) throw new LocalStoreError("NOT_ADMIN", "Solo admin");
      if (status === "LIVE" && !(this.database.prepare(
        "SELECT 1 FROM participants WHERE league_id = ? LIMIT 1",
      ).get(leagueId))) throw new LocalStoreError("NO_PARTICIPANTS", "Serve almeno un partecipante");

      if (status === "PAUSED") {
        this.database.prepare(
          "UPDATE auctions SET bid_deadline = NULL WHERE league_id = ? AND status = 'ACTIVE'",
        ).run(leagueId);
      } else if (status === "LIVE") {
        const rules = this.getRules(leagueId);
        if (rules) this.database.prepare(`
          UPDATE auctions SET bid_deadline = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ? || ' seconds')
          WHERE league_id = ? AND status = 'ACTIVE' AND bid_deadline IS NULL
        `).run(rules.auction_timer_seconds, leagueId);
      }
      this.database.prepare("UPDATE leagues SET status = ? WHERE id = ?").run(status, leagueId);
      this.bumpLeague(leagueId);
      this.audit(leagueId, adminSessionId, "SET_STATUS", { status });
    });
  }

  setLeaguePhase(adminSessionId: string, leagueId: string, phase: PlayerRole) {
    return withImmediateTransaction(this.database, () => {
      if (!this.getLeague(leagueId)) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega non trovata");
      if (!this.isAdmin(adminSessionId, leagueId)) throw new LocalStoreError("NOT_ADMIN", "Solo admin");
      this.database.prepare("UPDATE leagues SET auction_phase = ? WHERE id = ?").run(phase, leagueId);
      const next = this.nextEligibleTurn(leagueId, -1, phase);
      if (next !== null) this.database.prepare("UPDATE leagues SET current_turn = ? WHERE id = ?").run(next, leagueId);
      this.bumpLeague(leagueId);
      this.audit(leagueId, adminSessionId, "SET_PHASE", { phase });
    });
  }

  nominatePlayer(sessionId: string, playerId: string): LocalAuction {
    return withImmediateTransaction(this.database, () => {
      const player = this.database.prepare(`
        SELECT id, league_id, role, status FROM players WHERE id = ?
      `).get(playerId) as { id: string; league_id: string; role: PlayerRole; status: string } | undefined;
      if (!player) throw new LocalStoreError("PLAYER_NOT_FOUND", "Giocatore inesistente");
      if (player.status !== "AVAILABLE") throw new LocalStoreError("PLAYER_UNAVAILABLE", "Giocatore non disponibile");

      const league = this.getLeague(player.league_id);
      const rules = this.getRules(player.league_id);
      if (!league || !rules) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega non trovata");
      if (league.status !== "LIVE") throw new LocalStoreError("LEAGUE_NOT_LIVE", "Lega non in corso");

      const expired = this.database.prepare(`
        SELECT id FROM auctions
        WHERE league_id = ? AND status = 'ACTIVE' AND bid_deadline IS NOT NULL
          AND bid_deadline <= datetime('now')
      `).all(league.id) as Array<{ id: string }>;
      for (const item of expired) {
        try { this.completeAuction(item.id, sessionId, "AUTO_AWARD"); } catch { /* best effort, come la RPC web */ }
      }

      const refreshedLeague = this.getLeague(player.league_id);
      const caller = this.getParticipantBySession(sessionId, player.league_id);
      if (!refreshedLeague || !caller || caller.turnOrder !== refreshedLeague.current_turn) {
        throw new LocalStoreError("NOT_YOUR_TURN", "Non è il tuo turno");
      }
      if (refreshedLeague.aste_mode === "libero") {
        if (this.ownedCount(caller.id) >= this.totalSlots(rules)) throw new LocalStoreError("ROSTER_FULL", "Rosa completa");
      } else {
        if (player.role !== refreshedLeague.auction_phase) throw new LocalStoreError("NOT_YOUR_TURN", `Fase corrente: ${refreshedLeague.auction_phase}`);
        if (this.ownedCount(caller.id, player.role) >= roleSlotLimit(rules, player.role)) {
          throw new LocalStoreError("ROLE_SLOTS_FULL", "Slot ruolo completati");
        }
      }
      if (this.database.prepare(
        "SELECT 1 FROM auctions WHERE league_id = ? AND status = 'ACTIVE'",
      ).get(player.league_id)) throw new LocalStoreError("ACTIVE_AUCTION_EXISTS", "Esiste già un giocatore all'asta");

      const auctionId = randomUUID();
      const deadline = new Date(Date.now() + rules.auction_timer_seconds * 1000).toISOString();
      this.database.prepare("UPDATE players SET status = 'NOMINATED' WHERE id = ? AND status = 'AVAILABLE'").run(player.id);
      this.database.prepare(`
        INSERT INTO auctions (id, league_id, player_id, nominated_by, current_bid, highest_bidder_id, bid_deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(auctionId, player.league_id, player.id, caller.id, refreshedLeague.min_bid, caller.id, deadline);
      this.database.prepare(
        "INSERT INTO bids (auction_id, participant_id, amount) VALUES (?, ?, ?)",
      ).run(auctionId, caller.id, refreshedLeague.min_bid);
      this.bumpLeague(player.league_id);
      const auction = this.activeAuction(auctionId);
      if (!auction) throw new LocalStoreError("AUCTION_NOT_FOUND", "Asta non creata");
      return auction;
    });
  }

  placeBid(sessionId: string, auctionId: string, amount: number): LocalAuction {
    return withImmediateTransaction(this.database, () => {
      if (!Number.isInteger(amount) || amount <= 0) throw new LocalStoreError("BID_TOO_LOW", "Importo non valido");
      const auction = this.database.prepare(`
        SELECT a.id, a.league_id, a.player_id, a.current_bid, a.highest_bidder_id,
          a.status, a.bid_deadline, p.role
        FROM auctions a JOIN players p ON p.id = a.player_id WHERE a.id = ?
      `).get(auctionId) as {
        id: string; league_id: string; player_id: string; current_bid: number;
        highest_bidder_id: string | null; status: string; bid_deadline: string | null; role: PlayerRole;
      } | undefined;
      if (!auction) throw new LocalStoreError("AUCTION_NOT_FOUND", "Asta inesistente");
      if (auction.status !== "ACTIVE") throw new LocalStoreError("INVALID_AUCTION_STATE", "Asta non attiva");
      if (amount <= auction.current_bid) throw new LocalStoreError("BID_TOO_LOW", "Offerta troppo bassa");
      const league = this.getLeague(auction.league_id);
      const rules = this.getRules(auction.league_id);
      const bidder = this.getParticipantBySession(sessionId, auction.league_id);
      if (!league || !rules) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega non trovata");
      if (league.status !== "LIVE") throw new LocalStoreError("LEAGUE_NOT_LIVE", "La lega non è in corso");
      if (!bidder) throw new LocalStoreError("NOT_A_MEMBER", "Non partecipi a questa lega");
      if (!auction.bid_deadline || Date.parse(auction.bid_deadline) <= Date.now()) throw new LocalStoreError("BID_DEADLINE_PASSED", "Tempo scaduto");
      if (league.aste_mode === "libero") {
        if (this.ownedCount(bidder.id) >= this.totalSlots(rules)) throw new LocalStoreError("ROSTER_FULL", "Rosa completa");
      } else if (this.ownedCount(bidder.id, auction.role) >= roleSlotLimit(rules, auction.role)) {
        throw new LocalStoreError("ROLE_SLOTS_FULL", "Slot ruolo completati");
      }
      const slotsLeft = this.totalSlots(rules) - this.ownedCount(bidder.id);
      const limit = maxBid(bidder.budgetRemaining, slotsLeft, league.min_bid);
      if (amount > limit) throw new LocalStoreError("BID_TOO_HIGH", `Budget massimo disponibile: ${limit}`);

      const deadline = new Date(Date.now() + rules.auction_timer_seconds * 1000).toISOString();
      this.database.prepare(
        "INSERT INTO bids (auction_id, participant_id, amount) VALUES (?, ?, ?)",
      ).run(auction.id, bidder.id, amount);
      this.database.prepare(`
        UPDATE auctions SET current_bid = ?, highest_bidder_id = ?, bid_deadline = ?, version = version + 1
        WHERE id = ? AND status = 'ACTIVE'
      `).run(amount, bidder.id, deadline, auction.id);
      this.bumpLeague(league.id);
      const updated = this.activeAuction(auction.id);
      if (!updated) throw new LocalStoreError("AUCTION_NOT_FOUND", "Asta non trovata");
      return updated;
    });
  }

  awardPlayer(adminSessionId: string, auctionId: string) {
    return withImmediateTransaction(this.database, () => {
      const auction = this.activeAuction(auctionId);
      if (!auction) throw new LocalStoreError("AUCTION_NOT_FOUND", "Asta inesistente");
      if (!this.isAdmin(adminSessionId, auction.leagueId)) throw new LocalStoreError("NOT_ADMIN", "Solo admin");
      return this.completeAuction(auctionId, adminSessionId, "AWARD_PLAYER");
    });
  }

  resolveAuction(sessionId: string, auctionId: string) {
    return withImmediateTransaction(this.database, () => {
      const auction = this.activeAuction(auctionId);
      if (!auction) throw new LocalStoreError("AUCTION_NOT_FOUND", "Asta inesistente");
      if (auction.status !== "ACTIVE") return null;
      if (!this.isMember(sessionId, auction.leagueId)) throw new LocalStoreError("NOT_A_MEMBER", "Non partecipi a questa lega");
      const league = this.getLeague(auction.leagueId);
      if (!league || league.status !== "LIVE") throw new LocalStoreError("LEAGUE_NOT_LIVE", "La lega non è in corso");
      if (!auction.bidDeadline || Date.parse(auction.bidDeadline) > Date.now()) throw new LocalStoreError("AUCTION_NOT_EXPIRED", "Il tempo non è ancora scaduto");
      return this.completeAuction(auctionId, sessionId, "AUTO_AWARD");
    });
  }

  cancelAuction(adminSessionId: string, auctionId: string) {
    return withImmediateTransaction(this.database, () => {
      const auction = this.activeAuction(auctionId);
      if (!auction) throw new LocalStoreError("AUCTION_NOT_FOUND", "Asta inesistente");
      if (!this.isAdmin(adminSessionId, auction.leagueId)) throw new LocalStoreError("NOT_ADMIN", "Solo admin");
      this.database.prepare("DELETE FROM bids WHERE auction_id = ?").run(auctionId);
      this.database.prepare("UPDATE auctions SET status = 'CANCELLED', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1 WHERE id = ?").run(auctionId);
      this.database.prepare("UPDATE auctions SET highest_bidder_id = NULL WHERE id = ?").run(auctionId);
      this.database.prepare("UPDATE players SET status = 'AVAILABLE' WHERE id = ? AND status = 'NOMINATED'").run(auction.playerId);
      this.bumpLeague(auction.leagueId);
      this.audit(auction.leagueId, adminSessionId, "CANCEL_AUCTION", { auction_id: auctionId });
    });
  }

  deleteLeague(adminSessionId: string, leagueId: string) {
    return withImmediateTransaction(this.database, () => {
      if (!this.getLeague(leagueId)) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega non trovata");
      if (!this.isAdmin(adminSessionId, leagueId)) throw new LocalStoreError("NOT_ADMIN", "Solo admin");
      this.database.prepare("DELETE FROM bids WHERE auction_id IN (SELECT id FROM auctions WHERE league_id = ?)").run(leagueId);
      this.database.prepare("DELETE FROM purchases WHERE league_id = ?").run(leagueId);
      this.database.prepare("DELETE FROM auctions WHERE league_id = ?").run(leagueId);
      this.database.prepare("DELETE FROM admin_actions WHERE league_id = ?").run(leagueId);
      this.database.prepare("DELETE FROM participant_transfers WHERE league_id = ?").run(leagueId);
      this.database.prepare("DELETE FROM participants WHERE league_id = ?").run(leagueId);
      this.database.prepare("DELETE FROM players WHERE league_id = ?").run(leagueId);
      this.database.prepare("DELETE FROM league_rules WHERE league_id = ?").run(leagueId);
      const deleted = this.database.prepare("DELETE FROM leagues WHERE id = ?").run(leagueId);
      if (deleted.changes !== 1) throw new LocalStoreError("LEAGUE_NOT_FOUND", "Lega inesistente");
    });
  }

  releasePlayer(sessionId: string, playerId: string) {
    return withImmediateTransaction(this.database, () => {
      const purchase = this.database.prepare(`
        SELECT pu.id, pu.league_id AS leagueId, pu.participant_id AS participantId,
          pu.player_id AS playerId, pu.price, pu.released_at AS releasedAt,
          l.status, l.owner_session_id AS ownerSessionId, r.release_refund AS releaseRefund
        FROM purchases pu JOIN leagues l ON l.id = pu.league_id
        JOIN league_rules r ON r.league_id = pu.league_id
        WHERE pu.player_id = ? AND pu.released_at IS NULL
      `).get(playerId) as (LocalPurchase & {
        status: LeagueStatus; ownerSessionId: string; releaseRefund: ReleaseRefund;
      }) | undefined;
      if (!purchase) throw new LocalStoreError("PURCHASE_NOT_FOUND", "Giocatore non acquistato o già svincolato");
      if (!["LIVE", "PAUSED", "COMPLETED"].includes(purchase.status)) throw new LocalStoreError("RELEASE_NOT_ALLOWED", "La lega non è in corso");
      const participant = this.database.prepare("SELECT session_id FROM participants WHERE id = ?").get(purchase.participantId) as { session_id: string } | undefined;
      if (!participant || (participant.session_id !== sessionId && purchase.ownerSessionId !== sessionId)) throw new LocalStoreError("RELEASE_NOT_ALLOWED", "Non puoi svincolare questo giocatore");
      const refund = refundForRelease(purchase.releaseRefund, purchase.price);
      this.database.prepare("UPDATE participants SET budget_remaining = budget_remaining + ? WHERE id = ?").run(refund, purchase.participantId);
      this.database.prepare("UPDATE players SET status = 'AVAILABLE' WHERE id = ?").run(playerId);
      const releasedAt = new Date().toISOString();
      this.database.prepare("UPDATE purchases SET released_at = ? WHERE id = ? AND released_at IS NULL").run(releasedAt, purchase.id);
      this.bumpLeague(purchase.leagueId);
      this.audit(purchase.leagueId, sessionId, "RELEASE_PLAYER", { player_id: playerId, refund });
      return { ...purchase, releasedAt };
    });
  }
}

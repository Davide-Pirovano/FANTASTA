export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_local_schema",
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      CREATE TABLE leagues (
        id TEXT PRIMARY KEY,
        owner_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
        invite_code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(invite_code) BETWEEN 4 AND 12),
        status TEXT NOT NULL DEFAULT 'SETUP' CHECK (status IN ('SETUP', 'LOBBY', 'LIVE', 'PAUSED', 'COMPLETED')),
        participant_limit INTEGER NOT NULL CHECK (participant_limit BETWEEN 2 AND 30),
        initial_budget INTEGER NOT NULL CHECK (initial_budget > 0),
        min_bid INTEGER NOT NULL CHECK (min_bid > 0),
        current_turn INTEGER NOT NULL DEFAULT 0 CHECK (current_turn >= 0),
        auction_phase TEXT NOT NULL DEFAULT 'P' CHECK (auction_phase IN ('P', 'D', 'C', 'A')),
        aste_mode TEXT NOT NULL DEFAULT 'per_ruoli' CHECK (aste_mode IN ('per_ruoli', 'libero')),
        state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      CREATE TABLE league_rules (
        league_id TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
        goalkeeper_slots INTEGER NOT NULL CHECK (goalkeeper_slots >= 0),
        defender_slots INTEGER NOT NULL CHECK (defender_slots >= 0),
        midfielder_slots INTEGER NOT NULL CHECK (midfielder_slots >= 0),
        attacker_slots INTEGER NOT NULL CHECK (attacker_slots >= 0),
        auction_timer_seconds INTEGER NOT NULL DEFAULT 15 CHECK (auction_timer_seconds BETWEEN 1 AND 60),
        release_refund TEXT NOT NULL DEFAULT 'half' CHECK (release_refund IN ('full', 'half', 'one', 'zero', 'quotation')),
        CHECK (goalkeeper_slots + defender_slots + midfielder_slots + attacker_slots > 0)
      ) STRICT;

      CREATE TABLE participants (
        id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 50),
        team_name TEXT NOT NULL COLLATE NOCASE CHECK (length(team_name) BETWEEN 2 AND 50),
        budget_remaining INTEGER NOT NULL CHECK (budget_remaining >= 0),
        turn_order INTEGER NOT NULL CHECK (turn_order >= 0),
        connected INTEGER NOT NULL DEFAULT 1 CHECK (connected IN (0, 1)),
        joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (league_id, session_id),
        UNIQUE (league_id, turn_order),
        UNIQUE (league_id, team_name)
      ) STRICT;

      CREATE TABLE players (
        id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 2 AND 100),
        real_team TEXT NOT NULL COLLATE NOCASE CHECK (length(real_team) BETWEEN 1 AND 80),
        role TEXT NOT NULL CHECK (role IN ('P', 'D', 'C', 'A')),
        quotation INTEGER NOT NULL DEFAULT 1 CHECK (quotation > 0),
        is_trequartista INTEGER NOT NULL DEFAULT 0 CHECK (is_trequartista IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'NOMINATED', 'SOLD')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (league_id, name, real_team)
      ) STRICT;

      CREATE TABLE auctions (
        id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        nominated_by TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
        current_bid INTEGER NOT NULL CHECK (current_bid > 0),
        highest_bidder_id TEXT REFERENCES participants(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'AWARDED', 'CANCELLED')),
        bid_deadline TEXT,
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        completed_at TEXT,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
      ) STRICT;

      CREATE TABLE bids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
        amount INTEGER NOT NULL CHECK (amount > 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      CREATE TABLE purchases (
        id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        auction_id TEXT NOT NULL UNIQUE REFERENCES auctions(id) ON DELETE RESTRICT,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        price INTEGER NOT NULL CHECK (price > 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        released_at TEXT
      ) STRICT;

      CREATE TABLE participant_transfers (
        id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        team_name TEXT NOT NULL,
        old_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        new_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        moved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      CREATE TABLE admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        actor_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        action_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      CREATE UNIQUE INDEX one_active_auction_per_league
        ON auctions (league_id) WHERE status = 'ACTIVE';
      CREATE UNIQUE INDEX purchases_active_player_unique
        ON purchases (player_id) WHERE released_at IS NULL;
      CREATE INDEX participants_league_idx ON participants (league_id);
      CREATE INDEX players_filter_idx ON players (league_id, status, role, real_team);
      CREATE INDEX auctions_league_started_idx ON auctions (league_id, started_at DESC);
      CREATE INDEX bids_auction_created_idx ON bids (auction_id, created_at DESC);
      CREATE INDEX purchases_league_created_idx ON purchases (league_id, created_at DESC);
      CREATE INDEX participant_transfers_old_session_idx
        ON participant_transfers (league_id, old_session_id, moved_at DESC);
    `,
  },
  {
    version: 2,
    name: "repair_auction_link",
    sql: `ALTER TABLE leagues ADD COLUMN repair_of_league_id TEXT REFERENCES leagues(id) ON DELETE SET NULL; CREATE INDEX leagues_repair_of_idx ON leagues(repair_of_league_id);`,
  },
  {
    version: 3,
    name: "repair_imported_teams",
    sql: `
      CREATE TABLE repair_imported_teams (
        id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        team_name TEXT NOT NULL COLLATE NOCASE,
        budget_remaining INTEGER NOT NULL CHECK (budget_remaining >= 0),
        turn_order INTEGER NOT NULL CHECK (turn_order >= 0),
        roster TEXT NOT NULL DEFAULT '[]',
        claimed_participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
        UNIQUE (league_id, team_name),
        UNIQUE (league_id, turn_order)
      ) STRICT;
      CREATE INDEX repair_imported_teams_league_idx ON repair_imported_teams(league_id);
    `,
  },
  {
    version: 4,
    name: "release_refund_quotation",
    sql: `
      ALTER TABLE league_rules RENAME TO league_rules_old;
      CREATE TABLE league_rules (
        league_id TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
        goalkeeper_slots INTEGER NOT NULL CHECK (goalkeeper_slots >= 0),
        defender_slots INTEGER NOT NULL CHECK (defender_slots >= 0),
        midfielder_slots INTEGER NOT NULL CHECK (midfielder_slots >= 0),
        attacker_slots INTEGER NOT NULL CHECK (attacker_slots >= 0),
        auction_timer_seconds INTEGER NOT NULL DEFAULT 15 CHECK (auction_timer_seconds BETWEEN 1 AND 60),
        release_refund TEXT NOT NULL DEFAULT 'half' CHECK (release_refund IN ('full','half','one','zero','quotation')),
        CHECK (goalkeeper_slots + defender_slots + midfielder_slots + attacker_slots > 0)
      ) STRICT;
      INSERT INTO league_rules SELECT * FROM league_rules_old;
      DROP TABLE league_rules_old;
    `,
  },
  {
    version: 5,
    name: "repair_initial_roster_marker",
    sql: "ALTER TABLE purchases ADD COLUMN is_initial_roster INTEGER NOT NULL DEFAULT 0;",
  },
];

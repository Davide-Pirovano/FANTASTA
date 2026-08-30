/**
 * Nomi dell'API applicativa corrente. Il futuro adapter SQLite implementerà
 * gli stessi casi d'uso, senza dipendere dai nomi dei parametri PostgreSQL.
 */
export const APPLICATION_OPERATIONS = [
  "getLeagueOverview",
  "getMyTransfer",
  "createLeague",
  "importPlayers",
  "joinLeague",
  "rejoinLeague",
  "setLeagueStatus",
  "setLeaguePhase",
  "nominatePlayer",
  "placeBid",
  "awardPlayer",
  "resolveAuction",
  "cancelAuction",
  "releasePlayer",
  "deleteLeague",
] as const;

export type ApplicationOperation = (typeof APPLICATION_OPERATIONS)[number];

export const SUPABASE_RPC = {
  getLeagueOverview: "get_league_overview",
  getMyTransfer: "get_my_transfer",
  createLeague: "create_league",
  importPlayers: "import_players",
  joinLeague: "join_league",
  rejoinLeague: "rejoin_league",
  setLeagueStatus: "set_league_status",
  setLeaguePhase: "set_league_phase",
  nominatePlayer: "nominate_player",
  placeBid: "place_bid",
  awardPlayer: "award_player",
  resolveAuction: "resolve_auction",
  cancelAuction: "cancel_auction",
  releasePlayer: "release_player",
  deleteLeague: "delete_league",
} as const satisfies Record<ApplicationOperation, string>;

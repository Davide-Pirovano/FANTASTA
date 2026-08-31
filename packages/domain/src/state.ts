import type { PlayerRole, ReleaseRefund, RoleSlots } from "./auction";

export const LEAGUE_STATUSES = ["SETUP", "LOBBY", "LIVE", "PAUSED", "COMPLETED"] as const;
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];

/** Modalità di svolgimento dell'asta. */
export const AUCTION_MODES = ["per_ruoli", "libero"] as const;
export type AsteMode = (typeof AUCTION_MODES)[number];

export type { ReleaseRefund };

export type LeagueOverview = {
  id: string;
  name: string;
  status: LeagueStatus;
  participant_limit: number;
  initial_budget: number;
  min_bid: number;
  participant_count: number;
};

export type LeagueRow = LeagueOverview & {
  owner_id: string;
  invite_code: string;
  current_turn: number;
  /** Fase dell'asta per ruolo: P → D → C → A (usata solo se aste_mode = "per_ruoli"). */
  auction_phase: PlayerRole;
  /** Modalità d'asta: per ruoli (fasi) o ordine sparso. */
  aste_mode: AsteMode;
};

export type ParticipantRow = {
  id: string;
  display_name: string;
  team_name: string;
  budget_remaining: number;
  turn_order: number;
};

export type PlayerRow = {
  id: string;
  name: string;
  real_team: string;
  role: PlayerRole;
  quotation: number;
  is_trequartista: boolean;
};

export type ActiveAuction = {
  id: string;
  current_bid: number;
  highest_bidder_id: string | null;
  /** Istante (ISO) in cui l'asta si aggiudica in automatico; null per aste legacy. */
  bid_deadline: string | null;
  player: PlayerRow;
};

export type PurchaseRow = {
  id: string;
  price: number;
  created_at: string;
  participant_id: string;
  /** Id del giocatore acquistato (per svincolo / re-nomina). */
  player_id: string;
  player_name: string;
  real_team: string;
  role: PlayerRole;
  /** Quotazione nel listone al momento dell'acquisto, disponibile negli export recenti. */
  quotation?: number;
  /** Data di svincolo; null se l'acquisto è ancora attivo in rosa. */
  released_at: string | null;
  /** Giocatore ereditato dalla rosa iniziale di un'asta di riparazione. */
  is_initial_roster?: boolean;
};

export type TeamSummary = {
  participant: ParticipantRow;
  spent: number;
  rosterSize: number;
  ownedByRole: RoleSlots;
  roster: PurchaseRow[];
};

export type LeagueState = {
  league: LeagueRow;
  slots: RoleSlots;
  /** Fase corrente dell'asta (ruolo che si può chiamare); pertinente solo se aste_mode = "per_ruoli". */
  phase: PlayerRole;
  /** Modalità d'asta (per_ruoli | libero). */
  asteMode: AsteMode;
  /** Secondi del timer di aggiudicazione automatica (default 15). */
  auctionTimerSeconds: number;
  /** Politica di rimborso allo svincolo (full | half | one | zero). */
  releaseRefund: ReleaseRefund;
  participants: ParticipantRow[];
  /** Partecipante collegato a questa sessione (null per l'owner admin non iscritto). */
  me: ParticipantRow | null;
  isOwner: boolean;
  activeAuction: ActiveAuction | null;
  nextCaller: ParticipantRow | null;
  purchases: PurchaseRow[];
  availablePlayers: PlayerRow[];
  teams: TeamSummary[];
};

export function buildTeamSummaries(
  participants: ParticipantRow[],
  purchases: PurchaseRow[]
): TeamSummary[] {
  const byParticipant = new Map<string, PurchaseRow[]>();
  // Gli acquisti svincolati non fanno più parte della rosa (restano solo nello storico).
  for (const purchase of purchases) {
    if (purchase.released_at) continue;
    const bucket = byParticipant.get(purchase.participant_id);
    if (bucket) bucket.push(purchase);
    else byParticipant.set(purchase.participant_id, [purchase]);
  }
  return participants.map((participant) => {
    const roster = [...(byParticipant.get(participant.id) ?? [])].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
    const ownedByRole: RoleSlots = { P: 0, D: 0, C: 0, A: 0 };
    let spent = 0;
    for (const item of roster) {
      ownedByRole[item.role] += 1;
      spent += item.price;
    }
    const rosterSize = roster.length;
    return {
      participant,
      spent,
      rosterSize,
      ownedByRole,
      roster,
    };
  });
}

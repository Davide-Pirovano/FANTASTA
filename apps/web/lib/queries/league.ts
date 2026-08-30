import { createClient } from "@/lib/supabase/server";
import { SUPABASE_RPC } from "@fantasta/contracts";
import { type PlayerRole, type RoleSlots } from "@fantasta/domain/auction";
import {
  buildTeamSummaries,
  type ActiveAuction,
  type LeagueOverview,
  type LeagueRow,
  type LeagueState,
  type ParticipantRow,
  type PlayerRow,
  type PurchaseRow,
  type ReleaseRefund,
} from "@fantasta/domain/state";

const PLAYER_FIELDS = "id, name, real_team, role, quotation, is_trequartista";

type RulesRow = {
  goalkeeper_slots: number;
  defender_slots: number;
  midfielder_slots: number;
  attacker_slots: number;
  auction_timer_seconds: number;
  release_refund: ReleaseRefund;
};

function rulesToSlots(rules: RulesRow): RoleSlots {
  return {
    P: rules.goalkeeper_slots,
    D: rules.defender_slots,
    C: rules.midfielder_slots,
    A: rules.attacker_slots,
  };
}

export async function fetchLeagueOverview(code: string): Promise<LeagueOverview | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc(SUPABASE_RPC.getLeagueOverview, { invite: code }).maybeSingle();
  return (data as LeagueOverview | null) ?? null;
}

/** Righe lega+regole visibili solo a membri o owner (RLS). */
export async function fetchLeagueByCode(code: string): Promise<(LeagueRow & { rules?: RulesRow }) | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select(
      "id, owner_id, name, invite_code, status, participant_limit, initial_budget, min_bid, current_turn, auction_phase, aste_mode, rules:league_rules(goalkeeper_slots, defender_slots, midfielder_slots, attacker_slots, auction_timer_seconds, release_refund)"
    )
    .eq("invite_code", code.toUpperCase())
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as Omit<LeagueRow, keyof RulesRow> & { rules?: RulesRow };
  return { ...row };
}

export async function buildLeagueState(
  league: LeagueRow & { rules?: RulesRow },
  userId: string | null
): Promise<LeagueState> {
  const supabase = await createClient();
  const leagueId = league.id;

  const [participantsRes, auctionRes, purchasesRes, availableRes] = await Promise.all([
    supabase.from("participants").select("*").eq("league_id", leagueId).order("turn_order"),
    supabase
      .from("auctions")
      .select(`id, current_bid, highest_bidder_id, bid_deadline, players(${PLAYER_FIELDS})`)
      .eq("league_id", leagueId)
      .eq("status", "ACTIVE")
      .maybeSingle(),
    supabase
      .from("purchases")
      .select(`id, price, created_at, participant_id, player_id, released_at, players(role, name, real_team)`)
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false }),
    supabase
      .from("players")
      .select(PLAYER_FIELDS)
      .eq("league_id", leagueId)
      .eq("status", "AVAILABLE")
      .order("name"),
  ]);

  if (participantsRes.error || purchasesRes.error || availableRes.error) {
    throw new Error(participantsRes.error?.message ?? purchasesRes.error?.message ?? availableRes.error?.message);
  }

  const participants = (participantsRes.data ?? []) as ParticipantRow[];

  const rawPurchases = (purchasesRes.data ?? []) as unknown as Array<{
    id: string;
    price: number;
    created_at: string;
    participant_id: string;
    player_id: string;
    released_at: string | null;
    players: { role: string; name: string; real_team: string } | null;
  }>;
  const purchases: PurchaseRow[] = rawPurchases.flatMap((row) => {
    const player = row.players;
    if (!player) return [];
    return [
      {
        id: row.id,
        price: row.price,
        created_at: row.created_at,
        participant_id: row.participant_id,
        player_id: row.player_id,
        player_name: player.name,
        real_team: player.real_team,
        role: player.role as PurchaseRow["role"],
        released_at: row.released_at ?? null,
      },
    ];
  });

  const slots: RoleSlots =
    league.rules ? rulesToSlots(league.rules) : { P: 3, D: 8, C: 8, A: 6 };

  let activeAuction: ActiveAuction | null = null;
  if (auctionRes.data && !auctionRes.error) {
    const raw = auctionRes.data as unknown as {
      id: string;
      current_bid: number;
      highest_bidder_id: string | null;
      bid_deadline: string | null;
      players: Record<string, unknown> | null;
    };
    const player = raw.players as unknown as PlayerRow | null;
    if (player) {
      activeAuction = {
        id: raw.id,
        current_bid: raw.current_bid,
        highest_bidder_id: raw.highest_bidder_id,
        bid_deadline: raw.bid_deadline,
        player: {
          ...player,
          role: player.role as PlayerRole,
        },
      };
    }
  }

  const leagueRow: LeagueRow = { ...league };

  const rawParticipants = (participantsRes.data ?? []) as Array<ParticipantRow & { user_id: string }>;
  const meFull = userId ? rawParticipants.find((p) => p.user_id === userId) : undefined;
  const me: ParticipantRow | null = meFull
    ? {
        id: meFull.id,
        display_name: meFull.display_name,
        team_name: meFull.team_name,
        budget_remaining: meFull.budget_remaining,
        turn_order: meFull.turn_order,
      }
    : null;

  const turnIndex = ((leagueRow.current_turn % Math.max(participants.length, 1)) + participants.length) % Math.max(participants.length, 1);
  const nextCaller = participants.length > 0 ? participants[turnIndex] : null;

  return {
    league: leagueRow,
    slots,
    phase: leagueRow.auction_phase ?? "P",
    asteMode: leagueRow.aste_mode ?? "per_ruoli",
    auctionTimerSeconds: league.rules?.auction_timer_seconds ?? 15,
    releaseRefund: league.rules?.release_refund ?? "half",
    participants,
    me,
    isOwner: Boolean(userId && league.owner_id === userId),
    activeAuction,
    nextCaller,
    purchases,
    availablePlayers: (availableRes.data ?? []) as PlayerRow[],
    teams: buildTeamSummaries(participants, [...purchases].reverse()),
  };
}

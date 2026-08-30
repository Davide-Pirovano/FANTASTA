"use server";

import { revalidatePath } from "next/cache";
import {
  awardPlayerCommandSchema,
  cancelAuctionCommandSchema,
  deleteLeagueCommandSchema,
  nominatePlayerCommandSchema,
  placeBidCommandSchema,
  releasePlayerCommandSchema,
  resolveAuctionCommandSchema,
  setLeaguePhaseCommandSchema,
  setLeagueStatusCommandSchema,
  SUPABASE_RPC,
} from "@fantasta/contracts";
import { createClient } from "@/lib/supabase/server";
import type { LeagueStatus } from "@fantasta/domain/state";

export async function placeBidAction(auctionId: string, amount: number, leagueCode: string) {
  const parsed = placeBidCommandSchema.parse({ auctionId, amount, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.placeBid, { target_auction: parsed.auctionId, new_amount: parsed.amount });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function resolveAuctionAction(auctionId: string, leagueCode: string) {
  const parsed = resolveAuctionCommandSchema.parse({ auctionId, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.resolveAuction, { target_auction: parsed.auctionId });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function awardPlayerAction(auctionId: string, leagueCode: string) {
  const parsed = awardPlayerCommandSchema.parse({ auctionId, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.awardPlayer, { target_auction: parsed.auctionId });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function nominatePlayerAction(playerId: string, leagueCode: string) {
  const parsed = nominatePlayerCommandSchema.parse({ playerId, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.nominatePlayer, { target_player: parsed.playerId });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function setLeagueStatusAction(leagueId: string, status: LeagueStatus, leagueCode: string) {
  const parsed = setLeagueStatusCommandSchema.parse({ leagueId, status, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.setLeagueStatus, {
    target_league: parsed.leagueId,
    new_status: parsed.status,
  });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function setLeaguePhaseAction(leagueId: string, phase: string, leagueCode: string) {
  const parsed = setLeaguePhaseCommandSchema.parse({ leagueId, phase, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.setLeaguePhase, {
    target_league: parsed.leagueId,
    new_phase: parsed.phase,
  });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function deleteLeagueAction(leagueId: string, leagueCode: string) {
  const parsed = deleteLeagueCommandSchema.parse({ leagueId, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.deleteLeague, { target_league: parsed.leagueId });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath("/", "layout");
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function releasePlayerAction(playerId: string, leagueCode: string) {
  const parsed = releasePlayerCommandSchema.parse({ playerId, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.releasePlayer, { target_player: parsed.playerId });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

export async function cancelAuctionAction(auctionId: string, leagueCode: string) {
  const parsed = cancelAuctionCommandSchema.parse({ auctionId, leagueCode });
  const supabase = await createClient();
  const { error } = await supabase.rpc(SUPABASE_RPC.cancelAuction, { target_auction: parsed.auctionId });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath(`/league/${parsed.leagueCode}`, "layout");
  return { ok: true as const };
}

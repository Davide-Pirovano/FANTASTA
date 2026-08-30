import { z } from "zod";
import {
  AUCTION_MODES,
  LEAGUE_STATUSES,
  RELEASE_REFUNDS,
  ROLES,
} from "@fantasta/domain";

export const uuidSchema = z.string().uuid();
export const leagueCodeSchema = z.string().trim().min(4).max(12);
export const teamNameSchema = z.string().trim().min(2).max(50);

const auctionTargetSchema = z.object({
  auctionId: uuidSchema,
  leagueCode: leagueCodeSchema,
});

const playerTargetSchema = z.object({
  playerId: uuidSchema,
  leagueCode: leagueCodeSchema,
});

export const placeBidCommandSchema = auctionTargetSchema.extend({
  amount: z.number().int().positive(),
});
export const resolveAuctionCommandSchema = auctionTargetSchema;
export const awardPlayerCommandSchema = auctionTargetSchema;
export const cancelAuctionCommandSchema = auctionTargetSchema;
export const nominatePlayerCommandSchema = playerTargetSchema;
export const releasePlayerCommandSchema = playerTargetSchema;

export const setLeagueStatusCommandSchema = z.object({
  leagueId: uuidSchema,
  status: z.enum(LEAGUE_STATUSES),
  leagueCode: leagueCodeSchema,
});

export const setLeaguePhaseCommandSchema = z.object({
  leagueId: uuidSchema,
  phase: z.enum(ROLES),
  leagueCode: leagueCodeSchema,
});

export const deleteLeagueCommandSchema = z.object({
  leagueId: uuidSchema,
  leagueCode: leagueCodeSchema,
});

export const joinLeagueCommandSchema = z.object({
  inviteCode: leagueCodeSchema,
  participantName: teamNameSchema,
  teamName: teamNameSchema,
});

export const rejoinLeagueCommandSchema = z.object({
  inviteCode: leagueCodeSchema,
  teamName: teamNameSchema,
});

export const importedPlayerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  real_team: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  quotation: z.number().int().min(1),
  is_trequartista: z.boolean(),
});

export const setupInputSchema = z.object({
  leagueName: z.string().trim().min(2).max(80),
  participantLimit: z.number().int().min(2).max(30),
  initialBudget: z.number().int().min(1),
  minBid: z.number().int().min(1),
  slots: z.object({
    P: z.number().int().min(0),
    D: z.number().int().min(0),
    C: z.number().int().min(0),
    A: z.number().int().min(0),
  }).refine((slots) => Object.values(slots).some((value) => value > 0), {
    message: "La rosa deve prevedere almeno uno slot.",
  }),
  auctionTimerSeconds: z.number().int().min(1).max(60),
  asteMode: z.enum(AUCTION_MODES).default("per_ruoli"),
  releaseRefund: z.enum(RELEASE_REFUNDS).default("half"),
  players: z.array(importedPlayerSchema),
});

export type SetupInput = z.infer<typeof setupInputSchema>;
export type PlaceBidCommand = z.infer<typeof placeBidCommandSchema>;
export type JoinLeagueCommand = z.infer<typeof joinLeagueCommandSchema>;
export type RejoinLeagueCommand = z.infer<typeof rejoinLeagueCommandSchema>;

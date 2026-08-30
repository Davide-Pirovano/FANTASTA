"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  awardPlayerAction,
  cancelAuctionAction,
  nominatePlayerAction,
  placeBidAction,
  releasePlayerAction,
  resolveAuctionAction,
  setLeaguePhaseAction,
  setLeagueStatusAction,
} from "@/app/actions/auction";
import type { LeagueStatus } from "@fantasta/domain/state";
import type { PlayerRole } from "@fantasta/domain/auction";

export type AuctionActionResult = { ok: true } | { ok: false; message: string };

/** Contratto UI: web e desktop cambiano soltanto il trasporto dei comandi. */
export type AuctionActions = {
  placeBid: (auctionId: string, amount: number, leagueCode: string) => Promise<AuctionActionResult>;
  resolveAuction: (auctionId: string, leagueCode: string) => Promise<AuctionActionResult>;
  awardPlayer: (auctionId: string, leagueCode: string) => Promise<AuctionActionResult>;
  nominatePlayer: (playerId: string, leagueCode: string) => Promise<AuctionActionResult>;
  setLeagueStatus: (leagueId: string, status: LeagueStatus, leagueCode: string) => Promise<AuctionActionResult>;
  setLeaguePhase: (leagueId: string, phase: PlayerRole, leagueCode: string) => Promise<AuctionActionResult>;
  cancelAuction: (auctionId: string, leagueCode: string) => Promise<AuctionActionResult>;
  releasePlayer: (playerId: string, leagueCode: string) => Promise<AuctionActionResult>;
};

const webActions: AuctionActions = {
  placeBid: placeBidAction,
  resolveAuction: resolveAuctionAction,
  awardPlayer: awardPlayerAction,
  nominatePlayer: nominatePlayerAction,
  setLeagueStatus: setLeagueStatusAction,
  setLeaguePhase: setLeaguePhaseAction,
  cancelAuction: cancelAuctionAction,
  releasePlayer: releasePlayerAction,
};

const AuctionActionsContext = createContext<AuctionActions>(webActions);

export function AuctionActionsProvider({ actions, children }: { actions: AuctionActions; children: ReactNode }) {
  return <AuctionActionsContext value={actions}>{children}</AuctionActionsContext>;
}

export function useAuctionActions(): AuctionActions {
  return useContext(AuctionActionsContext);
}

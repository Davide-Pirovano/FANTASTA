"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalLanClient } from "@fantasta/desktop/client";
import type { RepairAuctionInput } from "@fantasta/contracts";
import { RepairWizard } from "@/components/setup/repair-wizard";

export function LocalRepairShell({ baseUrl, sessionId, initialSourceId }: { baseUrl: string; sessionId: string; initialSourceId?:string }) {
  const client = useMemo(() => new LocalLanClient(baseUrl, sessionId), [baseUrl, sessionId]);
  const [sources, setSources] = useState<Array<{ id:string; name:string; initial_budget:number; min_bid:number }> | null>(null);
  useEffect(() => { let active=true; void (async () => { try { const leagues=await client.listLeagues(); const completed=leagues.filter((league)=>league.status==="COMPLETED"); const states=await Promise.all(completed.map((league)=>client.getLeagueState(league.invite_code))); if(active)setSources(states.flatMap((state)=>state ? [{ id:state.league.id,name:state.league.name,initial_budget:state.league.initial_budget,min_bid:state.league.min_bid }] : [])); } catch { if(active)setSources([]); } })(); return()=>{active=false}; }, [client]);
  const createRepair = useCallback(async (input: RepairAuctionInput) => { try { const league=await client.command<{inviteCode:string}>("createRepairAuction", input); return { ok:true, league:{ invite_code:league.inviteCode } }; } catch (error) { return { ok:false, error:error instanceof Error ? error.message : "Creazione non riuscita" }; } }, [client]);
  if (sources === null) return <main className="grid min-h-dvh place-items-center text-sm font-bold text-[var(--muted)]">Caricamento aste concluse…</main>;
  return <RepairWizard sources={sources} createRepair={createRepair} adminHref={(code) => `/local/admin?${new URLSearchParams({server:baseUrl,session:sessionId,league:code})}`} homeHref={`/local/home?${new URLSearchParams({server:baseUrl,session:sessionId})}`} initialSourceId={initialSourceId} />;
}

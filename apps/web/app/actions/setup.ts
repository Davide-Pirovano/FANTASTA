"use server";

import { setupInputSchema, SUPABASE_RPC, type SetupInput } from "@fantasta/contracts";
import { createClient } from "@/lib/supabase/server";

export async function createLeagueWithPlayersAction(data: SetupInput) {
  try {
    const parsed = setupInputSchema.parse(data);
    const supabase = await createClient();

    // Verifica / Crea sessione utente
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
      if (anonError || !anonData.user) {
        return { ok: false as const, error: `Autenticazione non riuscita: ${anonError?.message}` };
      }
    }

    // 1. Creazione lega via RPC
    const { data: league, error: leagueError } = await supabase.rpc(SUPABASE_RPC.createLeague, {
      league_name: parsed.leagueName,
      team_limit: parsed.participantLimit,
      starting_budget: parsed.initialBudget,
      minimum_bid: parsed.minBid,
      goalkeeper_slots: parsed.slots.P,
      defender_slots: parsed.slots.D,
      midfielder_slots: parsed.slots.C,
      attacker_slots: parsed.slots.A,
      auction_timer_seconds: parsed.auctionTimerSeconds,
      auction_mode: parsed.asteMode,
      release_refund: parsed.releaseRefund,
    });

    if (leagueError || !league) {
      return { ok: false as const, error: `Errore creazione lega: ${leagueError?.message}` };
    }

    // 2. Importazione massiva giocatori (se presenti)
    let importedCount = 0;
    if (parsed.players.length > 0) {
      const { data: count, error: importError } = await supabase.rpc(SUPABASE_RPC.importPlayers, {
        target_league: league.id,
        player_rows: parsed.players,
      });

      if (importError) {
        return {
          ok: false as const,
          error: `Lega creata (codice: ${league.invite_code}), ma errore nell'import dei giocatori: ${importError.message}`,
        };
      }
      importedCount = count ?? 0;
    }

    return {
      ok: true as const,
      league: {
        id: league.id as string,
        invite_code: league.invite_code as string,
        name: league.name as string,
      },
      importedCount,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore imprevisto durante il setup";
    return { ok: false as const, error: message };
  }
}

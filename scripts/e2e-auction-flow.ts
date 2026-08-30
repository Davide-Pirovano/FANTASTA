/**
 * E2E del motore asta reale (nessun mock): verifica l'intero flusso contro il
 * database Supabase locale usando utenti anonimi distinti (admin + partecipanti).
 *
 * Flusso: crea lega → import giocatori → join ×2 → LIVE → fasi per ruolo
 * (P → D → C → A): chiamata solo del ruolo corrente, turno solo tra chiamanti
 * idonei, avanzamento automatico di fase, cambio fase manuale (admin), offerte
 * (valide e non valide, slot ruolo pieni), timer con aggiudicazione automatica,
 * annullamento asta, rollback e rientro dopo perdita di sessione.
 *
 * Esecuzione: node scripts/e2e-auction-flow.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY mancante");

  const anon = (await createClient(url, anonKey).auth.signInAnonymously()).data.session;
  const anon2 = (await createClient(url, anonKey).auth.signInAnonymously()).data.session;
  const anon3 = (await createClient(url, anonKey).auth.signInAnonymously()).data.session;
  if (!anon || !anon2 || !anon3) throw new Error("sign-in anonimo fallito");

  const admin = createClient(url, anonKey);
  const p1 = createClient(url, anonKey);
  const p2 = createClient(url, anonKey);
  await Promise.all([
    admin.auth.setSession({ access_token: anon.access_token, refresh_token: anon.refresh_token }),
    p1.auth.setSession({ access_token: anon2.access_token, refresh_token: anon2.refresh_token }),
    p2.auth.setSession({ access_token: anon3.access_token, refresh_token: anon3.refresh_token }),
  ]);

  const leagueName = `E2E ${new Date().toISOString().slice(11, 19)}`;

  // 1. Creazione lega (1 slot per ruolo: ogni fase dura 2 aste con 2 squadre)
  console.log("\n1. Creazione lega");
  const { data: league, error: leagueErr } = await admin.rpc("create_league", {
    league_name: leagueName,
    team_limit: 4,
    starting_budget: 500,
    minimum_bid: 1,
    goalkeeper_slots: 1,
    defender_slots: 1,
    midfielder_slots: 1,
    attacker_slots: 1,
  });
  check("create_league", !leagueErr && Boolean(league?.id), leagueErr?.message);
  if (!league?.id) return;
  check("fase iniziale = Portieri", league?.auction_phase === "P" || (league as { auction_phase?: string }).auction_phase === "P", JSON.stringify(league?.auction_phase));

  // 2. Import giocatori (2 per ruolo)
  console.log("\n2. Import listone");
  const playerRows = [
    { name: "Portiere A", real_team: "Roma", role: "P", quotation: 10, is_trequartista: false },
    { name: "Portiere B", real_team: "Lazio", role: "P", quotation: 8, is_trequartista: false },
    { name: "Difensore A", real_team: "Napoli", role: "D", quotation: 12, is_trequartista: false },
    { name: "Difensore B", real_team: "Milan", role: "D", quotation: 9, is_trequartista: false },
    { name: "Centrocampista A", real_team: "Inter", role: "C", quotation: 20, is_trequartista: true },
    { name: "Centrocampista B", real_team: "Juventus", role: "C", quotation: 18, is_trequartista: false },
    { name: "Attaccante A", real_team: "Atalanta", role: "A", quotation: 35, is_trequartista: false },
    { name: "Attaccante B", real_team: "Torino", role: "A", quotation: 30, is_trequartista: false },
  ];
  const { data: imported, error: importErr } = await admin.rpc("import_players", {
    target_league: league.id,
    player_rows: playerRows,
  });
  check("import_players (8)", !importErr && imported === 8, importErr?.message);

  // 3. Join partecipanti
  console.log("\n3. Join partecipanti");
  const { error: join1 } = await p1.rpc("join_league", {
    invite: league.invite_code, participant_name: "Luca", fantasy_team: "Real Luca",
  });
  const { error: join2 } = await p2.rpc("join_league", {
    invite: league.invite_code, participant_name: "Mario", fantasy_team: "FC Mario",
  });
  check("join_league ×2", !join1 && !join2, join1?.message ?? join2?.message);

  const { data: overviewRaw, error: overviewErr } = await createClient(url, anonKey)
    .rpc("get_league_overview", { invite: league.invite_code }).maybeSingle();
  const overview = overviewRaw as { participant_count: number } | null;
  check("get_league_overview (anon)", !overviewErr && overview?.participant_count === 2, overviewErr?.message ?? JSON.stringify(overview));

  // 4. Avvio asta
  console.log("\n4. Avvio asta (LOBBY → LIVE)");
  const { error: liveErr } = await admin.rpc("set_league_status", {
    target_league: league.id, new_status: "LIVE",
  });
  check("set_league_status LIVE", !liveErr, liveErr?.message);

  const { data: p1PartRaw } = await p1
    .from("participants").select("id, turn_order").eq("league_id", league.id).eq("team_name", "Real Luca").single();
  const p1Part = p1PartRaw as { id: string; turn_order: number } | null;
  check("recupero participant p1", Boolean(p1Part?.id), JSON.stringify(p1PartRaw));

  async function pickPlayer(role: string, status = "AVAILABLE") {
    const { data, error } = await p1.from("players")
      .select("id, name, role, status").eq("league_id", league.id)
      .eq("status", status).eq("role", role).order("name").limit(1).maybeSingle();
    if (error) throw new Error(`pickPlayer ${role}: ${error.message}`);
    return data as { id: string; name: string } | null;
  }

  // 5. Fase PORTIERI
  console.log("\n5. Fase Portieri");
  const d1 = await pickPlayer("D");
  const { error: wrongPhaseErr } = await p1.rpc("nominate_player", { target_player: d1!.id });
  check("nomina difensore in fase P rifiutata", Boolean(wrongPhaseErr), "doveva fallire");

  const p1a = await pickPlayer("P");
  const { data: auction1, error: nomErr1 } = await p1.rpc("nominate_player", { target_player: p1a!.id });
  check(
    "nomina portiere: base 1 + chiamante miglior offerente + timer",
    !nomErr1 && auction1?.current_bid === 1 && auction1?.highest_bidder_id === p1Part?.id && Boolean(auction1?.bid_deadline),
    nomErr1?.message ?? JSON.stringify(auction1)
  );

  // Offerte
  const { error: lowErr } = await p1.rpc("place_bid", { target_auction: auction1.id, new_amount: 1 });
  check("offerta non superiore rifiutata", Boolean(lowErr), "doveva fallire");
  const { error: overErr } = await p1.rpc("place_bid", { target_auction: auction1.id, new_amount: 499 });
  check("offerta oltre max_bid rifiutata", Boolean(overErr), "doveva fallire");
  const { error: bidP2 } = await p2.rpc("place_bid", { target_auction: auction1.id, new_amount: 15 });
  check("offerta 15 (p2)", !bidP2, bidP2?.message);

  const { data: purchase1, error: awardErr1 } = await admin.rpc("award_player", { target_auction: auction1.id });
  check("award portiere (p2 a 15)", !awardErr1 && Boolean(purchase1?.id), awardErr1?.message);

  const { data: stateAfterP1 } = await p1.from("leagues").select("auction_phase, current_turn").eq("id", league.id).single();
  check("fase ancora P (p2 ha 1/1? no: slot P=1 → p2 pieno, p1 vuoto)", stateAfterP1?.auction_phase === "P", JSON.stringify(stateAfterP1));
  check("turno torna a Real Luca (unico con slot P liberi)", stateAfterP1?.current_turn === 0, String(stateAfterP1?.current_turn));

  const p1b = await pickPlayer("P");
  const { data: auction2, error: nomErr2 } = await p1.rpc("nominate_player", { target_player: p1b!.id });
  check("secondo portiere (p1, base 1)", !nomErr2 && auction2?.current_bid === 1, nomErr2?.message);
  const { error: fullSlotBid } = await p2.rpc("place_bid", { target_auction: auction2.id, new_amount: 20 });
  check("p2 non può offrire sul portiere: slot P completati", Boolean(fullSlotBid), "doveva fallire");
  const { data: purchase2, error: awardErr2 } = await admin.rpc("award_player", { target_auction: auction2.id });
  check("award portiere (p1 a 1)", !awardErr2 && purchase2?.price === 1, awardErr2?.message);

  const { data: stateAfterP2 } = await p1.from("leagues").select("auction_phase, current_turn").eq("id", league.id).single();
  check("fase avanzata automaticamente a D (slot P tutti pieni)", stateAfterP2?.auction_phase === "D", JSON.stringify(stateAfterP2));
  check("turno su Real Luca (fase D)", stateAfterP2?.current_turn === 0, String(stateAfterP2?.current_turn));

  // 6. Fase DIFENSORI + timer automatico
  console.log("\n6. Fase Difensori");
  const d2 = await pickPlayer("D");
  const { data: auction3, error: nomErr3 } = await p1.rpc("nominate_player", { target_player: d2!.id });
  check("nomina difensore (fase D)", !nomErr3 && auction3?.current_bid === 1, nomErr3?.message);
  const { error: bidD } = await p2.rpc("place_bid", { target_auction: auction3.id, new_amount: 7 });
  check("offerta 7 (p2)", !bidD, bidD?.message);
  const { data: purchase3, error: awardErr3 } = await admin.rpc("award_player", { target_auction: auction3.id });
  check("award difensore (p2 a 7)", !awardErr3 && purchase3?.price === 7, awardErr3?.message);

  const { error: nomWrongTurn } = await p2.rpc("nominate_player", { target_player: (await pickPlayer("D"))!.id });
  check("p2 (slot D pieni) non può chiamare difensore", Boolean(nomWrongTurn), "doveva fallire");

  const d3 = await pickPlayer("D");
  const { data: auction4, error: nomErr4 } = await p1.rpc("nominate_player", { target_player: d3!.id });
  check("secondo difensore (p1)", !nomErr4 && Boolean(auction4?.id), nomErr4?.message);

  if (serviceKey) {
    const svc = createClient(url, serviceKey);
    const { error: expireErr } = await svc
      .from("auctions").update({ bid_deadline: new Date(Date.now() - 1000).toISOString() }).eq("id", auction4.id);
    check("scadenza timer forzata (test)", !expireErr, expireErr?.message);

    const { error: lateBid } = await p1.rpc("place_bid", { target_auction: auction4.id, new_amount: 5 });
    check("offerta dopo la scadenza rifiutata", Boolean(lateBid), "doveva fallire");

    const { data: autoPurchase, error: resolveErr } = await p1.rpc("resolve_auction", { target_auction: auction4.id });
    check("resolve_auction: aggiudicazione automatica a 1 (p1)", !resolveErr && autoPurchase?.price === 1, resolveErr?.message ?? JSON.stringify(autoPurchase));

    const { error: resolve2Err } = await p2.rpc("resolve_auction", { target_auction: auction4.id });
    check("resolve_auction idempotente (seconda chiamata no-op)", !resolve2Err, resolve2Err?.message);

    const { data: stateAfterD } = await p1.from("leagues").select("auction_phase, current_turn").eq("id", league.id).single();
    check("fase avanzata a C (slot D pieni)", stateAfterD?.auction_phase === "C", JSON.stringify(stateAfterD));
    check("turno su Real Luca (fase C)", stateAfterD?.current_turn === 0, String(stateAfterD?.current_turn));
  } else {
    console.log("  (skip timer: SUPABASE_SERVICE_ROLE_KEY non impostata)");
  }

  // 7. Fase CENTROCAMPISTI + cambio fase manuale
  console.log("\n7. Fase Centrocampisti");
  const { error: phaseJumpErr } = await admin.rpc("set_league_phase", { target_league: league.id, new_phase: "P" });
  check("set_league_phase manuale → P", !phaseJumpErr, phaseJumpErr?.message);

  const c1 = await pickPlayer("C");
  const { error: wrongPhase2Err } = await p1.rpc("nominate_player", { target_player: c1!.id });
  check("nomina centrocampista in fase P rifiutata", Boolean(wrongPhase2Err), "doveva fallire");

  const { error: phaseJumpErr2 } = await admin.rpc("set_league_phase", { target_league: league.id, new_phase: "C" });
  check("set_league_phase manuale → C", !phaseJumpErr2, phaseJumpErr2?.message);

  const c2 = await pickPlayer("C");
  const { data: auction5, error: nomErr5 } = await p1.rpc("nominate_player", { target_player: c2!.id });
  check("nomina centrocampista (fase C)", !nomErr5 && auction5?.current_bid === 1, nomErr5?.message);
  const { error: bidC } = await p2.rpc("place_bid", { target_auction: auction5.id, new_amount: 10 });
  check("offerta 10 (p2)", !bidC, bidC?.message);
  const { data: purchase5, error: awardErr5 } = await admin.rpc("award_player", { target_auction: auction5.id });
  check("award centrocampista (p2 a 10)", !awardErr5 && purchase5?.price === 10, awardErr5?.message);

  // 8. Annullamento asta (correzione admin)
  console.log("\n8. Annullamento asta");
  const c3 = await pickPlayer("C");
  const { data: auction6, error: nomErr6 } = await p1.rpc("nominate_player", { target_player: c3!.id });
  check("nomina secondo centrocampista (p1)", !nomErr6 && Boolean(auction6?.id), nomErr6?.message);

  const { error: cancelErr } = await admin.rpc("cancel_auction", { target_auction: auction6.id });
  check("cancel_auction", !cancelErr, cancelErr?.message);

  const { data: playerAfterCancel } = await p1.from("players").select("status").eq("id", c3!.id).single();
  check("giocatore di nuovo AVAILABLE", playerAfterCancel?.status === "AVAILABLE", String(playerAfterCancel?.status));

  const { data: auction6After } = await p1.from("auctions").select("status, highest_bidder_id").eq("id", auction6.id).single();
  check("asta CANCELLED senza offerente", auction6After?.status === "CANCELLED" && auction6After?.highest_bidder_id === null, JSON.stringify(auction6After));

  const { data: auction6b, error: nomErr6b } = await p1.rpc("nominate_player", { target_player: c3!.id });
  check("ri-nomina dopo annullamento", !nomErr6b && Boolean(auction6b?.id), nomErr6b?.message);
  const { data: purchase6, error: awardErr6 } = await admin.rpc("award_player", { target_auction: auction6b.id });
  check("award secondo centrocampista (p1 a 1)", !awardErr6 && purchase6?.price === 1, awardErr6?.message);

  const { data: stateAfterC } = await p1.from("leagues").select("auction_phase, current_turn").eq("id", league.id).single();
  check("fase avanzata a A (slot C pieni)", stateAfterC?.auction_phase === "A", JSON.stringify(stateAfterC));

  // 9. Fase ATTACCANTI + fine asta
  console.log("\n9. Fase Attaccanti");
  const a1 = await pickPlayer("A");
  const { data: auction7, error: nomErr7 } = await p1.rpc("nominate_player", { target_player: a1!.id });
  check("nomina attaccante (p1, fase A)", !nomErr7 && Boolean(auction7?.id), nomErr7?.message);
  const { data: purchase7, error: awardErr7 } = await admin.rpc("award_player", { target_auction: auction7.id });
  check("award attaccante (p1 a 1)", !awardErr7 && purchase7?.price === 1, awardErr7?.message);

  const { data: turnAfterA1 } = await p1.from("leagues").select("current_turn").eq("id", league.id).single();
  check("turno passa a FC Mario (unico con slot A liberi)", turnAfterA1?.current_turn === 1, String(turnAfterA1?.current_turn));

  const a2 = await pickPlayer("A");
  const { data: auction8, error: nomErr8 } = await p2.rpc("nominate_player", { target_player: a2!.id });
  check("nomina attaccante (p2, fase A)", !nomErr8 && Boolean(auction8?.id), nomErr8?.message);
  const { data: purchase8, error: awardErr8 } = await admin.rpc("award_player", { target_auction: auction8.id });
  check("award attaccante (p2 a 1)", !awardErr8 && purchase8?.price === 1, awardErr8?.message);

  // Budget finali
  const { data: p1Budget } = await p1.from("participants").select("budget_remaining").eq("league_id", league.id).eq("team_name", "Real Luca").single();
  const { data: p2Budget } = await p2.from("participants").select("budget_remaining").eq("league_id", league.id).eq("team_name", "FC Mario").single();
  check("crediti p1 = 496 (500 − 1×4)", p1Budget?.budget_remaining === 496, JSON.stringify(p1Budget));
  check("crediti p2 = 467 (500 − 15 − 7 − 10 − 1)", p2Budget?.budget_remaining === 467, JSON.stringify(p2Budget));

  const { count: purchasesCount } = await p1.from("purchases").select("id", { count: "exact", head: true }).eq("league_id", league.id);
  check("acquisti totali = 8", purchasesCount === 8, String(purchasesCount));

  // 10. Rollback acquisto (correzione admin)
  console.log("\n10. Rollback acquisto");
  if (serviceKey) {
    const svc = createClient(url, serviceKey);
    const { error: delErr } = await svc.from("purchases").delete().eq("id", purchase7.id);
    const { error: restoreErr } = await svc.from("players").update({ status: "AVAILABLE" }).eq("id", a1!.id);
    const { error: budgetErr } = await svc
      .from("participants").update({ budget_remaining: 497 }).eq("league_id", league.id).eq("team_name", "Real Luca");
    const { error: turnErr } = await svc.from("leagues").update({ current_turn: 0 }).eq("id", league.id);
    check("rollback acquisto (purchase/player/budget/turno)", !delErr && !restoreErr && !budgetErr && !turnErr,
      delErr?.message ?? restoreErr?.message ?? budgetErr?.message ?? turnErr?.message);
  } else {
    console.log("  (skip: SUPABASE_SERVICE_ROLE_KEY non impostata)");
  }

  // 11. Rientro dopo perdita sessione (nuovo browser = nuova sessione anonima)
  console.log("\n11. Rientro dopo perdita sessione");
  const { data: anon4Data } = await createClient(url, anonKey).auth.signInAnonymously();
  const anon4 = anon4Data.session;
  if (!anon4) throw new Error("sign-in anonimo fallito (4)");
  const p3 = createClient(url, anonKey);
  await p3.auth.setSession({ access_token: anon4.access_token, refresh_token: anon4.refresh_token });

  const { error: dupJoinErr } = await p3.rpc("join_league", {
    invite: league.invite_code, participant_name: "Luca", fantasy_team: "Real Luca",
  });
  check("join in lega LIVE / nome già preso rifiutato (serve il rientro)", Boolean(dupJoinErr), "doveva fallire");

  const { error: wrongRejoinErr } = await p3.rpc("rejoin_league", {
    invite: league.invite_code, fantasy_team: "Squadra Inesistente",
  });
  check("rejoin con nome inesistente rifiutato", Boolean(wrongRejoinErr), "doveva fallire");

  const { data: rejoinRaw, error: rejoinErr } = await p3.rpc("rejoin_league", {
    invite: league.invite_code, fantasy_team: "Real Luca",
  });
  const rejoined = (Array.isArray(rejoinRaw) ? rejoinRaw[0] : rejoinRaw) as { participant?: { id: string }; moved?: boolean } | null;
  check(
    "rejoin_league: stessa squadra adottata dalla nuova sessione",
    !rejoinErr && rejoined?.participant?.id === p1Part?.id && rejoined?.moved === true,
    rejoinErr?.message ?? JSON.stringify(rejoinRaw)
  );

  const { data: myPart } = await p3.from("participants")
    .select("id, team_name, budget_remaining")
    .eq("league_id", league.id).eq("user_id", anon4.user.id).single();
  check(
    "nuova sessione vede la squadra adottata (stesso id, stesso nome)",
    myPart?.id === p1Part?.id && myPart?.team_name === "Real Luca",
    JSON.stringify(myPart)
  );

  // 11b. Modalità libera (ordine sparso): niente fasi, si chiama qualsiasi ruolo
  console.log("\n11b. Modalità asta libera (ordine sparso)");
  const { data: freeLeagueRaw, error: freeLeagueErr } = await admin.rpc("create_league", {
    league_name: `${leagueName} libera`,
    team_limit: 2,
    starting_budget: 500,
    minimum_bid: 1,
    goalkeeper_slots: 1,
    defender_slots: 1,
    midfielder_slots: 1,
    attacker_slots: 2,
    auction_mode: "libero",
  });
  const freeLeague = freeLeagueRaw as { id: string; invite_code: string; auction_phase: string } | null;
  check("create_league (libero)", !freeLeagueErr && Boolean(freeLeague?.id), freeLeagueErr?.message);
  check("aste_mode = libero (fase ignota, resta P di default)", freeLeague?.auction_phase === "P", JSON.stringify(freeLeague?.auction_phase));

  if (freeLeague?.id) {
    // Import 1 giocatore per ruolo.
    const freePlayers = [
      { name: "Libero Portiere", real_team: "Roma", role: "P", quotation: 10, is_trequartista: false },
      { name: "Libero Attaccante", real_team: "Inter", role: "A", quotation: 30, is_trequartista: false },
    ];
    const { error: freeImportErr } = await admin.rpc("import_players", {
      target_league: freeLeague.id, player_rows: freePlayers,
    });
    check("import giocatori (libero)", !freeImportErr, freeImportErr?.message);

    const freeJoin1 = await p1.rpc("join_league", { invite: freeLeague.invite_code, participant_name: "L1", fantasy_team: "Lega Libera Uno" });
    const freeJoin2 = await p2.rpc("join_league", { invite: freeLeague.invite_code, participant_name: "L2", fantasy_team: "Lega Libera Due" });
    check("join ×2 (libero)", !freeJoin1.error && !freeJoin2.error, freeJoin1.error?.message ?? freeJoin2.error?.message);

    const { error: freeLiveErr } = await admin.rpc("set_league_status", { target_league: freeLeague.id, new_status: "LIVE" });
    check("lega libera in LIVE", !freeLiveErr, freeLiveErr?.message);

    // Squadra di turno (p1) chiama un ATTACCANTE pur essendo in "fase P" di default:
    // in modalità libera il vincolo di ruolo non deve valere.
    const attPlayer = (await p1.from("players").select("id").eq("league_id", freeLeague.id).eq("name", "Libero Attaccante").single()).data as { id: string } | null;
    const { data: att, error: attErr } = await p1.rpc("nominate_player", { target_player: attPlayer?.id });
    check("nomina attaccante in modalità libera (fase P ignorata)", !attErr && Boolean(att?.id), attErr?.message);

    // Un'altra squadra non può chiamare mentre è all'asta.
    const busyPlayer = (await p2.from("players").select("id").eq("league_id", freeLeague.id).eq("name", "Libero Portiere").single()).data as { id: string } | null;
    const { error: busyErr } = await p2.rpc("nominate_player", { target_player: busyPlayer?.id });
    check("nomina bloccata con asta attiva (libero)", Boolean(busyErr), "doveva fallire");

    // Verifica che purchase del giocatore differenziato per ruolo coesista col turno libero.
    const { error: freeDelErr } = await admin.rpc("delete_league", { target_league: freeLeague.id });
    check("delete_league (libera, owner)", !freeDelErr, freeDelErr?.message);
  }

  // 11c. Svincolo giocatori con rimborso configurabile (half / full / one / zero)
  console.log("\n11c. Svincolo giocatori (rimborso configurabile)");

  async function releaseLeagueFlow(releaseRefund: "full" | "half" | "one" | "zero", expectedRefund: number) {
    // Lega con 1 solo slot per ruolo, 1 partecipante: nomina -> rilancio a 15 -> aggiudicazione -> svincolo.
    const { data: relLeagueRaw, error: relLeagueErr } = await admin.rpc("create_league", {
      league_name: `${leagueName} svincolo ${releaseRefund}`,
      team_limit: 2,
      starting_budget: 500,
      minimum_bid: 1,
      goalkeeper_slots: 1,
      defender_slots: 1,
      midfielder_slots: 1,
      attacker_slots: 1,
      auction_mode: "libero",
      release_refund: releaseRefund,
    });
    const relLeague = relLeagueRaw as { id: string; invite_code: string } | null;
    check(`create_league (svincolo ${releaseRefund})`, !relLeagueErr && Boolean(relLeague?.id), relLeagueErr?.message);
    if (!relLeague?.id) return;

    const { error: relImportErr } = await admin.rpc("import_players", {
      target_league: relLeague.id,
      player_rows: [{ name: `Portiere ${releaseRefund}`, real_team: "Roma", role: "P", quotation: 10, is_trequartista: false }],
    });
    check(`import (svincolo ${releaseRefund})`, !relImportErr, relImportErr?.message);

    const relJoin = await p1.rpc("join_league", { invite: relLeague.invite_code, participant_name: "S1", fantasy_team: `Squadra ${releaseRefund}` });
    check(`join (svincolo ${releaseRefund})`, !relJoin.error, relJoin.error?.message);
    const { error: relLiveErr } = await admin.rpc("set_league_status", { target_league: relLeague.id, new_status: "LIVE" });
    check(`LIVE (svincolo ${releaseRefund})`, !relLiveErr, relLiveErr?.message);

    const relPlayer = (await p1.from("players").select("id, name").eq("league_id", relLeague.id).single()).data as { id: string; name: string } | null;
    const { data: relAuction, error: relNomErr } = await p1.rpc("nominate_player", { target_player: relPlayer?.id });
    check(`nomina (svincolo ${releaseRefund})`, !relNomErr && Boolean(relAuction?.id), relNomErr?.message);
    const { error: relBidErr } = await p1.rpc("place_bid", { target_auction: relAuction?.id, new_amount: 15 });
    check(`rilancio a 15 (svincolo ${releaseRefund})`, !relBidErr, relBidErr?.message);
    const { error: relAwardErr } = await admin.rpc("award_player", { target_auction: relAuction?.id });
    check(`aggiudicazione a 15 (svincolo ${releaseRefund})`, !relAwardErr, relAwardErr?.message);

    const { data: relPurchRaw } = await p1.from("purchases").select("id, price, released_at").eq("league_id", relLeague.id).single();
    const relPurch = relPurchRaw as { id: string; price: number; released_at: string | null } | null;
    check(`acquisto attivo a 15 (svincolo ${releaseRefund})`, relPurch?.price === 15 && relPurch?.released_at === null, JSON.stringify(relPurch));

    const { error: relReleaseErr } = await p1.rpc("release_player", { target_player: relPlayer?.id });
    check(`release_player (${releaseRefund})`, !relReleaseErr, relReleaseErr?.message);

    const { data: relPurchAfter } = await p1.from("purchases").select("released_at").eq("league_id", relLeague.id).single();
    check(`acquisto marcato svincolato (${releaseRefund})`, Boolean(relPurchAfter?.released_at), JSON.stringify(relPurchAfter));

    const { data: relPlayerAfter } = await p1.from("players").select("status").eq("league_id", relLeague.id).single();
    check(`giocatore di nuovo AVAILABLE (${releaseRefund})`, relPlayerAfter?.status === "AVAILABLE", JSON.stringify(relPlayerAfter));

    const { data: relBudget } = await p1.from("participants").select("budget_remaining").eq("league_id", relLeague.id).single();
    check(`rimborso = ${expectedRefund} crediti (${releaseRefund})`, relBudget?.budget_remaining === 500 - 15 + expectedRefund, JSON.stringify(relBudget));

    // Doppio svincolo rifiutato: il giocatore non è più acquistato.
    const { error: relDoubleErr } = await p1.rpc("release_player", { target_player: relPlayer?.id });
    check(`doppio svincolo rifiutato (${releaseRefund})`, Boolean(relDoubleErr), "doveva fallire");

    // Il giocatore svincolato può essere ricomprato (lo slot si libera e in
    // modalità libera non c'è vincolo di fase): nuova asta aperta con successo.
    const { data: reNom, error: reNomErr } = await p1.rpc("nominate_player", { target_player: relPlayer?.id });
    check(`svincolato ricomprabile (${releaseRefund})`, !reNomErr && Boolean(reNom?.id), reNomErr?.message);

    const { error: relDelErr } = await admin.rpc("delete_league", { target_league: relLeague.id });
    check(`delete_league (svincolo ${releaseRefund})`, !relDelErr, relDelErr?.message);
  }

  // half: metà arrotondata per eccesso; full: prezzo pieno; one: 1 credito; zero: nessun rimborso.
  await releaseLeagueFlow("half", 8);
  await releaseLeagueFlow("full", 15);
  await releaseLeagueFlow("one", 1);
  await releaseLeagueFlow("zero", 0);

  // 12. Eliminazione lega (solo owner)
  console.log("\n12. Eliminazione lega");
  const { error: deleteForbiddenErr } = await p1.rpc("delete_league", { target_league: league.id });
  check("delete_league da partecipante rifiutato", Boolean(deleteForbiddenErr), "doveva fallire");

  const { error: deleteErr } = await admin.rpc("delete_league", { target_league: league.id });
  check("delete_league (owner)", !deleteErr, deleteErr?.message);

  const { data: gone } = await createClient(url, anonKey)
    .rpc("get_league_overview", { invite: league.invite_code }).maybeSingle();
  check("lega eliminata (overview non più disponibile)", gone === null, JSON.stringify(gone));

  // Pulizia di sicurezza con service key (se la delete non fosse andata a buon fine)
  if (serviceKey) {
    await createClient(url, serviceKey).from("leagues").delete().eq("id", league.id);
  }

  console.log(failures === 0 ? "\n✓ E2E ASTA: TUTTI I CONTROLLI PASSATI" : `\n✗ E2E ASTA: ${failures} CONTROLLI FALLITI`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

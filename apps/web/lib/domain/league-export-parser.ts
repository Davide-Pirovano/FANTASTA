import type { PlayerRole } from "@fantasta/domain/auction";

export type ImportedRoster = { teamName: string; initialBudget: number; remainingBudget: number; purchases: Array<{ name: string; realTeam: string; role: PlayerRole; price: number; quotation: number | null }> };
type Sheet = { sheet: string; data: unknown[][] };
const roles = new Set<PlayerRole>(["P", "D", "C", "A"]);
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => { const raw=String(value ?? "").trim(); if (!raw) return null; const parsed = Number(raw.replace(",", ".")); return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null; };

/** Legge il file generato da “Export lega completa”. Richiede il foglio
 * Acquisti, mentre Riepilogo squadre fornisce i crediti reali di ogni rosa. */
export function parseLeagueExport(sheets: Sheet[]): { ok: true; teams: ImportedRoster[] } | { ok: false; error: string } {
  const purchasesSheet = sheets.find((sheet) => sheet.sheet.trim().toLocaleLowerCase() === "acquisti");
  const summarySheet = sheets.find((sheet) => sheet.sheet.trim().toLocaleLowerCase() === "riepilogo squadre");
  if (!purchasesSheet || !summarySheet) return { ok: false, error: "Usa l'Excel esportato da Fantasta: mancano i fogli Acquisti o Riepilogo squadre." };
  const summary = new Map<string, { initialBudget: number; remainingBudget: number }>();
  for (const row of summarySheet.data.slice(1)) { const team=text(row[0]); const initial=number(row[1]); const remaining=number(row[3]); if(team && initial !== null && remaining !== null) summary.set(team.toLocaleLowerCase(), { initialBudget: initial, remainingBudget: remaining }); }
  const teams = new Map<string, ImportedRoster>();
  for (const row of summarySheet.data.slice(1)) {
    const teamName=text(row[0]); const credits=summary.get(teamName.toLocaleLowerCase());
    if (teamName && credits) teams.set(teamName.toLocaleLowerCase(),{teamName,...credits,purchases:[]});
  }
  for (const row of purchasesSheet.data.slice(1)) {
    const teamName=text(row[0]); const role=text(row[1]).toUpperCase() as PlayerRole; const name=text(row[2]); const realTeam=text(row[3]); const price=number(row[4]); const quotation=number(row[5]);
    if (!teamName || !name || !realTeam || !roles.has(role) || price === null || price < 1) continue;
    const key=teamName.toLocaleLowerCase(); let team=teams.get(key);
    if (!team) { const credits=summary.get(key); if (!credits) return { ok:false, error:`Manca il riepilogo crediti per ${teamName}.` }; team={teamName, ...credits, purchases:[]}; teams.set(key, team); }
    team.purchases.push({name, realTeam, role, price, quotation});
  }
  if (!teams.size || ![...teams.values()].some((team)=>team.purchases.length)) return { ok:false, error:"Il foglio Acquisti non contiene giocatori validi." };
  return { ok:true, teams:[...teams.values()] };
}

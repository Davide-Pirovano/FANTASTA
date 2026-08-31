type ExportPlayer = { role: string; player: string; realTeam: string; price: number; quotation?: number };
type ExportTeam = { name: string; initialBudget: number; remainingBudget: number; players: ExportPlayer[] };

function safeSheetName(value: string) {
  return value.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "Squadra";
}

export async function exportLeague(leagueName: string, teams: ExportTeam[]) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const summary = teams.map((team) => ({
    Squadra: team.name,
    "Crediti iniziali": team.initialBudget,
    "Crediti spesi": team.initialBudget - team.remainingBudget,
    "Crediti rimasti": team.remainingBudget,
    "Giocatori acquistati": team.players.length,
  }));
  const header = (values: string[]) => values.map((value) => ({ value, fontWeight: "bold" as const, backgroundColor: "#E3F4E8" }));
  const sheets = [{
    sheet: "Riepilogo squadre",
    data: [header(["Squadra", "Crediti iniziali", "Crediti spesi", "Crediti rimasti", "Giocatori acquistati"]), ...summary.map((row) => Object.values(row))],
    columns: [{ width: 24 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 24 }],
  }];
  teams.forEach((team) => {
    sheets.push({
      sheet: safeSheetName(team.name),
      data: [header(["Ruolo", "Giocatore", "Squadra reale", "Prezzo", "Quotazione listone"]), ...team.players.map((player) => [player.role, player.player, player.realTeam, player.price, player.quotation ?? ""])],
      columns: [{ width: 10 }, { width: 28 }, { width: 20 }, { width: 12 }, { width: 20 }],
    });
  });
  const purchases = teams.flatMap((team) => team.players.map((player) => ({ Squadra: team.name, ...player }))).map((row) => ({ Squadra: row.Squadra, Ruolo: row.role, Giocatore: row.player, "Squadra reale": row.realTeam, Prezzo: row.price, "Quotazione listone": row.quotation ?? "" }));
  sheets.push({
    sheet: "Acquisti",
    data: [header(["Squadra", "Ruolo", "Giocatore", "Squadra reale", "Prezzo", "Quotazione listone"]), ...purchases.map((row) => Object.values(row))],
    columns: [{ width: 24 }, { width: 10 }, { width: 28 }, { width: 20 }, { width: 12 }, { width: 20 }],
  });
  const result = (await writeExcelFile(sheets)) as unknown as { toBlob: () => Promise<Blob> };
  const blob = await result.toBlob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeSheetName(leagueName)}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

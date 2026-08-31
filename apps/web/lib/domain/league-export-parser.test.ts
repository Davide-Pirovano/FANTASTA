import assert from "node:assert/strict";
import test from "node:test";
import { parseLeagueExport } from "./league-export-parser";

test("ricostruisce squadre, crediti e acquisti dall'export completo", () => {
  const parsed = parseLeagueExport([
    { sheet: "Riepilogo squadre", data: [
      ["Squadra","Crediti iniziali","Crediti spesi","Crediti rimasti","Giocatori acquistati"],
      ["Team Uno",500,20,480,1], ["Team Due",500,0,500,0],
    ] },
    { sheet: "Acquisti", data: [
      ["Squadra","Ruolo","Giocatore","Squadra reale","Prezzo","Quotazione listone"],
      ["Team Uno","P","Rossi","Roma",20,12],
    ] },
  ]);
  assert.equal(parsed.ok,true);
  if (!parsed.ok) return;
  assert.equal(parsed.teams.length,2);
  assert.equal(parsed.teams[0].remainingBudget,480);
  assert.equal(parsed.teams[0].purchases[0].quotation,12);
  assert.equal(parsed.teams[1].purchases.length,0);
});

test("usa null per la quotazione assente negli export storici", () => {
  const parsed = parseLeagueExport([
    { sheet:"Riepilogo squadre",data:[["Squadra","Iniziali","Spesi","Rimasti"],["A Team",100,10,90],["B Team",100,0,100]] },
    { sheet:"Acquisti",data:[["Squadra","Ruolo","Giocatore","Squadra reale","Prezzo"],["A Team","P","Rossi","Roma",10]] },
  ]);
  assert.equal(parsed.ok,true);
  if (parsed.ok) assert.equal(parsed.teams[0].purchases[0].quotation,null);
});

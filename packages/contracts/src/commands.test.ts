import assert from "node:assert/strict";
import test from "node:test";
import {
  joinLeagueCommandSchema,
  setLeagueStatusCommandSchema,
  setupInputSchema,
} from "./commands";
import { APPLICATION_OPERATIONS, SUPABASE_RPC } from "./rpc";

const validSetup = {
  leagueName: "  Lega Test  ",
  participantLimit: 8,
  initialBudget: 500,
  minBid: 1,
  slots: { P: 3, D: 8, C: 8, A: 6 },
  auctionTimerSeconds: 15,
  players: [],
};

test("normalizza gli input testuali e applica i default di setup", () => {
  const setup = setupInputSchema.parse(validSetup);
  assert.equal(setup.leagueName, "Lega Test");
  assert.equal(setup.asteMode, "per_ruoli");
  assert.equal(setup.releaseRefund, "half");

  const join = joinLeagueCommandSchema.parse({
    inviteCode: " ABC123 ",
    participantName: " Team Uno ",
    teamName: " Team Uno ",
  });
  assert.deepEqual(join, { inviteCode: "ABC123", participantName: "Team Uno", teamName: "Team Uno" });
});

test("rifiuta una rosa senza slot e uno stato non supportato", () => {
  assert.equal(setupInputSchema.safeParse({ ...validSetup, slots: { P: 0, D: 0, C: 0, A: 0 } }).success, false);
  assert.equal(
    setLeagueStatusCommandSchema.safeParse({
      leagueId: "11111111-1111-4111-8111-111111111111",
      leagueCode: "ABC123",
      status: "ARCHIVED",
    }).success,
    false,
  );
});

test("ogni operazione applicativa ha una RPC Supabase esplicita", () => {
  assert.deepEqual(Object.keys(SUPABASE_RPC), [...APPLICATION_OPERATIONS]);
});

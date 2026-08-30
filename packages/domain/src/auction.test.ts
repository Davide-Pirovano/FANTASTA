import assert from "node:assert/strict";
import test from "node:test";
import {
  canBid,
  maxBid,
  refundForRelease,
  remainingSlots,
} from "./auction";

test("calcola i rimborsi come la RPC release_player", () => {
  assert.equal(refundForRelease("full", 15), 15);
  assert.equal(refundForRelease("half", 15), 8);
  assert.equal(refundForRelease("half", 14), 7);
  assert.equal(refundForRelease("half", 1), 1);
  assert.equal(refundForRelease("one", 15), 1);
  assert.equal(refundForRelease("zero", 15), 0);
});

test("riserva il minimo necessario per tutti gli slot rimanenti", () => {
  assert.equal(maxBid(100, 5, 1), 96);
  assert.equal(maxBid(100, 5, 3), 88);
  assert.equal(maxBid(100, 0, 1), 0);
  assert.equal(maxBid(2, 3, 1), 0);
});

test("valida una nuova offerta contro prezzo e budget massimo", () => {
  assert.deepEqual(canBid({ amount: 16, currentBid: 15, budgetRemaining: 20, slotsRemaining: 3, minBid: 1 }), {
    ok: true,
    limit: 18,
  });
  assert.equal(canBid({ amount: 15, currentBid: 15, budgetRemaining: 20, slotsRemaining: 3, minBid: 1 }).ok, false);
  assert.equal(canBid({ amount: 19, currentBid: 15, budgetRemaining: 20, slotsRemaining: 3, minBid: 1 }).ok, false);
  assert.equal(canBid({ amount: 16.5, currentBid: 15, budgetRemaining: 20, slotsRemaining: 3, minBid: 1 }).ok, false);
});

test("conta soltanto gli slot ancora da riempire", () => {
  assert.equal(
    remainingSlots(
      { P: 3, D: 8, C: 8, A: 6 },
      { P: 1, D: 9, C: 4, A: 0 },
    ),
    12,
  );
});

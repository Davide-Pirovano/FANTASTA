import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamSummaries, type ParticipantRow, type PurchaseRow } from "./state";

const participants: ParticipantRow[] = [
  { id: "team-1", display_name: "Uno", team_name: "Team Uno", budget_remaining: 80, turn_order: 0 },
  { id: "team-2", display_name: "Due", team_name: "Team Due", budget_remaining: 90, turn_order: 1 },
];

const purchases: PurchaseRow[] = [
  {
    id: "purchase-2",
    participant_id: "team-1",
    player_id: "player-2",
    player_name: "Difensore",
    real_team: "Club",
    role: "D",
    price: 8,
    created_at: "2026-08-28T10:01:00.000Z",
    released_at: null,
  },
  {
    id: "purchase-released",
    participant_id: "team-1",
    player_id: "player-released",
    player_name: "Svincolato",
    real_team: "Club",
    role: "A",
    price: 25,
    created_at: "2026-08-28T10:02:00.000Z",
    released_at: "2026-08-28T10:03:00.000Z",
  },
  {
    id: "purchase-1",
    participant_id: "team-1",
    player_id: "player-1",
    player_name: "Portiere",
    real_team: "Club",
    role: "P",
    price: 12,
    created_at: "2026-08-28T10:00:00.000Z",
    released_at: null,
  },
];

test("costruisce rose attive ordinate e ignora gli svincoli", () => {
  const summaries = buildTeamSummaries(participants, purchases);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].spent, 20);
  assert.equal(summaries[0].rosterSize, 2);
  assert.deepEqual(summaries[0].ownedByRole, { P: 1, D: 1, C: 0, A: 0 });
  assert.deepEqual(summaries[0].roster.map((purchase) => purchase.id), ["purchase-1", "purchase-2"]);
  assert.equal(summaries[1].spent, 0);
  assert.deepEqual(summaries[1].roster, []);
});

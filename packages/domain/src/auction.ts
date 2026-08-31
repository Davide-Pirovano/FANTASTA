export const ROLES = ["P", "D", "C", "A"] as const;
export type PlayerRole = (typeof ROLES)[number];

export type RoleSlots = Record<PlayerRole, number>;

/** Politica di rimborso allo svincolo (allineata a league_rules.release_refund). */
export const RELEASE_REFUNDS = ["full", "half", "one", "zero", "quotation"] as const;
export type ReleaseRefund = (typeof RELEASE_REFUNDS)[number];

/** Crediti restituiti svincolando un giocatore acquistato a un certo prezzo. */
export function refundForRelease(refund: ReleaseRefund, price: number, quotation = price) {
  if (refund === "zero") return 0;
  if (refund === "full") return price;
  if (refund === "one") return 1;
  if (refund === "quotation") return Math.max(0, quotation);
  return Math.max(1, Math.ceil(price / 2));
}

export function remainingSlots(slots: RoleSlots, owned: RoleSlots) {
  return ROLES.reduce((total, role) => total + Math.max(0, slots[role] - owned[role]), 0);
}

export function maxBid(budgetRemaining: number, slotsRemaining: number, minBid: number) {
  if (slotsRemaining <= 0) return 0;
  return Math.max(0, budgetRemaining - (slotsRemaining - 1) * minBid);
}

export function canBid(input: {
  amount: number;
  currentBid: number;
  budgetRemaining: number;
  slotsRemaining: number;
  minBid: number;
}) {
  const limit = maxBid(input.budgetRemaining, input.slotsRemaining, input.minBid);
  if (!Number.isInteger(input.amount)) return { ok: false, reason: "Inserisci un importo intero." };
  if (input.amount <= input.currentBid) return { ok: false, reason: "L'offerta deve superare quella attuale." };
  if (input.amount > limit) return { ok: false, reason: `Puoi offrire al massimo ${limit} crediti.` };
  return { ok: true, limit };
}

export const ROLE_LABELS: Record<PlayerRole, string> = {
  P: "Portiere",
  D: "Difensore",
  C: "Centrocampista",
  A: "Attaccante",
};

/** Ordine delle fasi dell'asta: prima i portieri, poi difensori, centrocampisti, attaccanti. */
export const PHASE_ORDER: readonly PlayerRole[] = ROLES;

export const PHASE_LABELS: Record<PlayerRole, string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

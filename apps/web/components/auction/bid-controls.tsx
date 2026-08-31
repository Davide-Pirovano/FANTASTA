"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { maxBid } from "@fantasta/domain/auction";
import type { PlayerRole, RoleSlots } from "@fantasta/domain/auction";
import type { ActiveAuction, ParticipantRow } from "@fantasta/domain/state";
import { useAuctionActions } from "@/components/auction/auction-actions";

const INCREMENTS = [1, 5, 10] as const;

export function BidControls({ auction, me, slots, ownedByRole, minBid, leagueCode }: {
  auction: ActiveAuction;
  me: ParticipantRow;
  slots: RoleSlots;
  ownedByRole: Record<PlayerRole, number>;
  minBid: number;
  leagueCode: string;
}) {
  const [custom, setCustom] = useState("");
  const [pending, startTransition] = useTransition();
  const { placeBid } = useAuctionActions();

  const totalSlots = Object.values(slots).reduce((sum, n) => sum + n, 0);
  const ownedTotal = Object.values(ownedByRole).reduce((sum, n) => sum + n, 0);
  const slotsLeft = Math.max(0, totalSlots - ownedTotal);
  const roleFull = ownedByRole[auction.player.role] >= slots[auction.player.role];
  const effectiveLimit = slotsLeft === 0 ? 0 : maxBid(me.budget_remaining, slotsLeft, minBid);
  // Se la puntata attuale è già tua, non ha senso rilanciare su te stesso.
  const isWinning = auction.highest_bidder_id === me.id;
  // Crediti che resterebbero in cassa se la presente offerta venisse aggiudicata.
  const remainingIfWon = me.budget_remaining - auction.current_bid;

  if (isWinning) {
    return (
      <section className="rounded-[1.4rem] border border-[var(--brand)] bg-[var(--brand-soft)]/60 p-3 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-[var(--brand-dark)] sm:text-base">Stai vincendo l&apos;asta 🏆</h2>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] text-[var(--brand-dark)]/70 sm:text-xs">Dopo l&apos;aggiudicazione</p>
            <p className="numeric text-lg font-black text-[var(--brand-dark)] sm:text-xl">{remainingIfWon} cr</p>
          </div>
        </div>
      </section>
    );
  }

  if (slotsLeft === 0 || effectiveLimit === 0) {
    return (
      <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-3 text-center sm:p-5">
        <p className="font-black">Crediti o slot insufficienti</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Con {me.budget_remaining} crediti e {slotsLeft} slot da completare non puoi rilanciare su questo giocatore.
        </p>
      </section>
    );
  }

  if (roleFull) {
    return (
      <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-3 text-center sm:p-5">
        <p className="font-black">Hai completato gli slot per questo ruolo</p>
        <p className="mt-1 text-sm text-[var(--muted)]">Aspetta il prossimo giocatore chiamato all&apos;asta.</p>
      </section>
    );
  }

  function bid(amount: number) {
    if (!Number.isInteger(amount)) {
      toast.error("Inserisci un importo intero.");
      return;
    }
    if (amount <= auction.current_bid) {
      toast.error(`Serve almeno ${auction.current_bid + 1} credito.`);
      return;
    }
    if (amount > effectiveLimit) {
      toast.error(`Puoi offrire al massimo ${effectiveLimit} crediti.`);
      return;
    }
    startTransition(async () => {
      const res = await placeBid(auction.id, amount, leagueCode);
      if (!res.ok) toast.error(res.message);
    });
  }

  return (
    <section className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black sm:text-base">Fai la tua offerta</h2>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)] sm:text-sm">
            {me.team_name} · {auction.current_bid < effectiveLimit ? `rilancia da ${auction.current_bid + 1}` : "ultimo rilancio possibile"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-[var(--muted)] sm:text-xs">Crediti</p>
          <p className="numeric text-lg font-black sm:text-xl">{me.budget_remaining}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:gap-3">
        {INCREMENTS.map((increment) => {
          const amount = auction.current_bid + increment;
          const remainingIfWon = me.budget_remaining - amount;
          const disabled = pending || amount > effectiveLimit;
          return (
            <button
              key={increment}
              disabled={disabled}
              onClick={() => bid(amount)}
              aria-label={`Rilancia a ${amount} crediti`}
              className="pressable flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-[var(--ink)] font-black text-white hover:bg-[var(--brand-dark)] disabled:pointer-events-none disabled:opacity-40 sm:min-h-20"
            >
              <span className="text-lg leading-none sm:text-xl">{amount}</span>
              <span className="mt-1 text-[11px] font-bold leading-none opacity-75">{disabled ? "—" : `restano ${remainingIfWon}`}</span>
            </button>
          );
        })}
      </div>

      <form
        className="mt-2 flex gap-2 sm:mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(custom);
          setCustom("");
          bid(value);
        }}
      >
        <label className="sr-only" htmlFor="custom-bid">Offerta personalizzata</label>
        <input
          id="custom-bid"
          inputMode="numeric"
          value={custom}
          onChange={(event) => setCustom(event.target.value.replace(/[^\d]/g, ""))}
          placeholder={`${auction.current_bid + 1} – ${effectiveLimit}`}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--background)] px-3 font-bold outline-none focus:border-[var(--brand)] sm:min-h-12 sm:px-4"
        />
        <Button type="submit" variant="secondary" disabled={pending || !custom}>Offri</Button>
      </form>

      {(() => {
        const value = Number(custom);
        const valid =
          custom !== "" &&
          Number.isInteger(value) &&
          value > auction.current_bid &&
          value <= effectiveLimit;
        if (!valid) return null;
        return (
          <p className="mt-2 text-center text-sm font-black text-red-600">
            Crediti rimanenti: <span className="numeric">{me.budget_remaining - value}</span> crediti
          </p>
        );
      })()}

      <div className="mt-3 hidden items-start gap-2 rounded-xl bg-[var(--brand-soft)] px-2.5 py-2 text-[11px] leading-4 text-[var(--brand-dark)] sm:mt-4 sm:flex sm:px-3 sm:py-2.5 sm:text-xs sm:leading-5">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 sm:size-4" />
        <p>
          <strong>Massimo {effectiveLimit}.</strong> Dopo un rilancio di {auction.current_bid + 1} crediti ti resterebbero{" "}
          <span className="numeric font-black">{me.budget_remaining - (auction.current_bid + 1)}</span> crediti.
        </p>
      </div>
    </section>
  );
}

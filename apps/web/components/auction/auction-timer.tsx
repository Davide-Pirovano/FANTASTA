"use client";

import { useEffect, useRef, useState } from "react";
import { TimerReset } from "lucide-react";
import { useAuctionActions } from "@/components/auction/auction-actions";
import { cn } from "@/lib/utils";

/**
 * Timer di aggiudicazione automatica (5 → 0).
 *
 * La deadline è decisa dal server (auctions.bid_deadline) e arriva via
 * realtime a ogni rilancio: quando scende a zero questo componente chiama
 * resolve_auction, che è idempotente — la prima chiamata vince, le altre
 * sono no-op. Il server valida comunque che il tempo sia davvero scaduto.
 */
export function AuctionTimer({ deadline, auctionId, leagueCode, paused }: {
  deadline: string | null;
  auctionId: string;
  leagueCode: string;
  paused?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const { resolveAuction } = useAuctionActions();

  // Tic dell'orologio locale per il conteggio visivo (fermo se in pausa).
  useEffect(() => {
    if (!deadline || paused) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadline, paused]);

  // Allo zero (e solo lì) chiede al server di aggiudicare. Se nel frattempo
  // qualcuno ha rilanciato, la deadline è stata riazzerata e l'errore di
  // "tempo non ancora scaduto" va ignorato: il realtime aggiornerà il timer.
  // In pausa non parte MAI (la deadline è spenta lato server).
  useEffect(() => {
    if (!deadline || paused) return;
    fired.current = false;
    const fire = () => {
      if (Date.parse(deadline) - Date.now() > 0 || fired.current) return;
      fired.current = true;
      void resolveAuction(auctionId, leagueCode).then((res) => {
        if (!res.ok && res.message !== "Il tempo per le offerte non e ancora scaduto") {
          console.warn("resolve_auction:", res.message);
        }
      });
    };
    const id = setInterval(fire, 300);
    fire();
    return () => clearInterval(id);
  }, [deadline, auctionId, leagueCode, paused, resolveAuction]);

  if (!deadline) return null;

  if (paused) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 sm:px-4 sm:py-3">
        <span className="flex items-center gap-2 text-xs font-bold text-amber-800 sm:text-sm">
          <TimerReset className="size-4 shrink-0 sm:size-5" /> Asta in pausa
        </span>
        <span className="text-xs font-black uppercase tracking-wider text-amber-700">Timer fermo</span>
      </div>
    );
  }
  const remaining = Math.max(0, Date.parse(deadline) - now);
  const seconds = Math.ceil(remaining / 1000);
  const urgent = remaining <= 3000;

  return (
    <div
      role="timer"
      aria-live={urgent ? "assertive" : "off"}
      aria-atomic="true"
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 sm:px-4 sm:py-3",
        urgent
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
      )}
    >
      <span className="flex items-center gap-2 text-xs font-bold sm:text-sm">
        <TimerReset className={cn("size-4 shrink-0 sm:size-5", urgent ? "text-red-600 motion-safe:animate-pulse" : "text-[var(--brand)]")} />
        {urgent ? "Si chiude tra" : "Aggiudicazione automatica tra"}
      </span>
      <span
        className={cn(
          "numeric shrink-0 text-xl font-black tabular-nums sm:text-2xl",
          urgent ? "text-red-700" : "text-[var(--brand-dark)]"
        )}
      >
        {remaining === 0 ? "…" : `${seconds}s`}
      </span>
    </div>
  );
}

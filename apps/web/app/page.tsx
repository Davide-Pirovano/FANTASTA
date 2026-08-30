import Link from "next/link";
import { ArrowRight, Gavel, Github } from "lucide-react";
import { ActiveLeagues, EmptyLeagues, type OpenLeague } from "@/components/home/active-leagues";
import { JoinByCode } from "@/components/home/join-by-code";
import { createClient } from "@/lib/supabase/server";

const OPEN_STATUSES = ["SETUP", "LOBBY", "LIVE", "PAUSED"];
const ALL_STATUSES = [...OPEN_STATUSES, "COMPLETED"];

const STATUS_RANK: Record<string, number> = {
  LIVE: 0,
  PAUSED: 1,
  LOBBY: 2,
  SETUP: 3,
  COMPLETED: 4,
};

export default async function HomePage() {
  let ownedLeagues: OpenLeague[] = [];
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const userId = userData.user.id;
      // Tutte le leghe di cui sei owner (aperte e concluse): gestione ed eliminazione.
      const ownedRes = await supabase
        .from("leagues")
        .select("id, name, invite_code, status, participant_limit, participants(count)")
        .eq("owner_id", userId)
        .in("status", ALL_STATUSES)
        .order("created_at", { ascending: false });

      ownedLeagues = (ownedRes.data ?? [])
        .map((league) => {
          const embedded = league.participants as Array<{ count: number }> | null;
          return {
            id: league.id,
            name: league.name,
            invite_code: league.invite_code,
            status: league.status,
            participant_limit: league.participant_limit,
            participant_count: embedded?.[0]?.count ?? 0,
          };
        })
        .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
    }
  } catch {
    // Senza sessione (o Supabase irraggiungibile) la home resta statica.
    ownedLeagues = [];
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-hidden bg-[var(--background)]">
      {/* Come funziona: in alto a destra, sempre visibile */}
      <Link
        href="https://github.com/Davide-Pirovano/FANTASTA"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-4 top-4 z-20 inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)]/85 px-4 py-2 text-sm font-bold text-[var(--brand-dark)] shadow-[0_12px_30px_-18px_rgba(24,51,40,0.5)] backdrop-blur transition-colors hover:bg-[var(--brand-soft)] sm:right-8 sm:top-7"
      >
        <Github className="size-4" />
        Come funziona
      </Link>

      {/* Glow decorativi */}
      <div className="pointer-events-none absolute -left-40 -top-40 size-[34rem] rounded-full bg-[var(--brand-soft)]/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-52 -right-32 size-[36rem] rounded-full bg-amber-100/80 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--line)_1px,transparent_0)] bg-[size:26px_26px] opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      <section className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 content-center items-center gap-10 px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-28 sm:px-8 sm:pt-32 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-12 lg:py-20">
        {/* Colonna sinistra: wordmark + CTA */}
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-white shadow-[0_18px_36px_-14px_var(--brand)] sm:size-16 sm:rounded-[1.1rem]">
              <Gavel className="size-7 sm:size-8" strokeWidth={2.4} />
            </span>
            <h1 className="text-[3.4rem] font-black leading-none tracking-[-0.05em] text-[var(--ink)] sm:text-[5rem] lg:text-[5.5rem]">
              FANTA<span className="text-[var(--brand-dark)]">STA</span>
            </h1>
          </div>

          <p className="mt-6 max-w-md text-base leading-7 text-[var(--muted)] sm:text-lg sm:leading-8 lg:max-w-xl">
            Gestisci chiamate, rilanci, crediti e rose da uno stesso posto: tu dirigi dal PC, tutti gli altri giocano dal telefono.
          </p>

          <div className="mt-8 flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <Link
              href="/setup"
              aria-label="Crea una nuova asta"
              className="group pressable relative inline-flex min-h-[4.25rem] flex-1 items-center justify-center gap-4 overflow-hidden rounded-2xl bg-[var(--brand-dark)] pr-4 pl-7 text-lg font-black tracking-tight text-white shadow-[0_24px_50px_-14px_var(--brand)] ring-1 ring-black/5 transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand)] hover:shadow-[0_30px_60px_-16px_var(--brand)] sm:flex-none"
            >
              <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-white/20 to-transparent" />
              Crea asta
              <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 transition-transform duration-200 group-hover:translate-x-1 group-hover:bg-white/25">
                <ArrowRight className="size-5" />
              </span>
            </Link>

            <JoinByCode />
          </div>

        </div>

        {/* Colonna destra: le tue aste (storico) */}
        <div className="flex min-h-0 flex-col lg:max-h-[70vh]">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">
            Le tue aste
          </p>
          {ownedLeagues.length > 0 ? (
            <ActiveLeagues leagues={ownedLeagues} />
          ) : (
            <EmptyLeagues />
          )}
        </div>
      </section>
    </main>
  );
}

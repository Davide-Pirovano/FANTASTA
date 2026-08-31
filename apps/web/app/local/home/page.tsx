import Link from "next/link";
import { Gavel, Plus, RefreshCw } from "lucide-react";
import { LocalActiveLeagues } from "@/components/home/local-active-leagues";
import { LocalJoinByInviteLink } from "@/components/home/local-join-by-invite-link";

/**
 * Home del contesto desktop: replica il layout della landing web ma senza
 * Supabase. I CTA puntano alle route locali (/local/setup per creare,
 * /local/admin per rientrare in regia); la lista "LA TUA LEGA" mostra le
 * leghe della sessione admin con Entra/Elimina, come nella home web.
 */
export default async function LocalHomePage({ searchParams }: {
  searchParams: Promise<{ server?: string; session?: string }>;
}) {
  const params = await searchParams;
  const server = params.server;
  const session = params.session;

  const setupHref = server && session
    ? `/local/setup?server=${encodeURIComponent(server)}&session=${encodeURIComponent(session)}`
    : null;

  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-hidden bg-[var(--background)]">
      {/* Come funziona: in alto a destra, come la web */}
      {/* Il link GitHub è l'unica parte che punta all'esterno; il progetto è open source. */}
      <a
        href="https://github.com/Davide-Pirovano/FANTASTA"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-4 top-4 z-20 inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)]/85 px-4 py-2 text-sm font-bold text-[var(--brand-dark)] shadow-[0_12px_30px_-18px_rgba(24,51,40,0.5)] backdrop-blur transition-colors hover:bg-[var(--brand-soft)] sm:right-8 sm:top-7"
      >
        {/* Icona GitHub (il progetto è pubblicato) */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.66.41.35.77 1.05.77 2.12v3.16c0 .3.21.66.8.55A11.53 11.53 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>
        Come funziona
      </a>

      {/* Glow e griglia a puntini, come la web */}
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
            L&apos;asta di Fantacalcio sul tuo PC: i partecipanti si collegano dal telefono
            direttamente alla tua rete locale, senza server.
          </p>

          <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              href={setupHref ?? "/local/setup"}
              aria-label="Crea una nuova asta"
              className={`group pressable inline-flex min-h-[4.25rem] items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--surface)] px-5 text-lg font-black tracking-tight text-[var(--brand-dark)] shadow-[0_18px_40px_-18px_rgba(24,81,70,0.28)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-soft)] hover:shadow-[0_22px_42px_-18px_rgba(24,81,70,0.36)]${server && session ? "" : " sm:col-span-2"}`}
            >
              <Plus className="size-5" />
              Crea asta
            </Link>
            {server && session ? <Link href={`/local/repair?${new URLSearchParams({ server, session }).toString()}`} className="group pressable inline-flex min-h-[4.25rem] items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--surface)] px-5 text-lg font-black tracking-tight text-[var(--brand-dark)] shadow-[0_18px_40px_-18px_rgba(24,81,70,0.28)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-soft)] hover:shadow-[0_22px_42px_-18px_rgba(24,81,70,0.36)]"><RefreshCw className="size-5" />Asta di riparazione</Link> : null}

            <div className="sm:col-span-2">
              <LocalJoinByInviteLink fullWidth />
            </div>
          </div>
        </div>

        {/* Colonna destra: la tua lega */}
        <div className="flex min-h-0 flex-col lg:max-h-[70vh]">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">
            LA TUA LEGA
          </p>
          <div className="mt-4">
            {server && session ? (
              <LocalActiveLeagues baseUrl={server} sessionId={session} />
            ) : (
              <div className="flex w-full flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-[var(--line)] bg-white/40 px-6 py-8 text-center backdrop-blur">
                <span className="grid size-14 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                  <Plus className="size-7" />
                </span>
                <div>
                  <p className="text-base font-black text-[var(--ink)]">Nessuna asta ancora</p>
                  <p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-[var(--muted)]">
                    Le tue aste aperte e concluse compariranno qui.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

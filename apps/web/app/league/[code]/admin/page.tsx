import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { AdminView } from "@/components/auction/admin-view";
import { buildLeagueState, fetchLeagueByCode, fetchLeagueOverview } from "@/lib/queries/league";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLeaguePage({ params }: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalizedCode = code.toUpperCase();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    const overview = await fetchLeagueOverview(normalizedCode);
    if (!overview) notFound();
    return <AccessGate title="Regia admin bloccata" message="Apri la regia dallo stesso browser in cui hai creato la lega." showJoinHref={`/league/${normalizedCode}`} />;
  }

  const league = await fetchLeagueByCode(normalizedCode);

  if (!league) {
    const overview = await fetchLeagueOverview(normalizedCode);
    if (overview) {
      redirect(`/league/${normalizedCode}`);
    }
    notFound();
  }

  if (league.owner_id !== userData.user.id) {
    redirect(`/league/${normalizedCode}`);
  }

  const state = await buildLeagueState(league, userData.user.id);
  return <AdminView state={state} inviteCode={normalizedCode} />;
}

function AccessGate({ title, message, showJoinHref }: { title: string; message: string; showJoinHref?: string }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
      <section className="w-full rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface)] p-6 text-center surface-shadow">
        <Logo compact />
        <h1 className="mt-4 text-2xl font-black tracking-[-0.03em]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{message}</p>
        {showJoinHref ? (
          <Link
            href={showJoinHref}
            className="pressable mt-5 inline-flex min-h-11 items-center rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-bold hover:bg-[var(--surface-soft)]"
          >
            Vai alla lobby partecipante
          </Link>
        ) : null}
      </section>
    </main>
  );
}

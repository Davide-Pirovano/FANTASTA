import { notFound, redirect } from "next/navigation";
import { buildLeagueState, fetchLeagueByCode, fetchLeagueOverview } from "@/lib/queries/league";
import { SUPABASE_RPC } from "@fantasta/contracts";
import { createClient } from "@/lib/supabase/server";
import { JoinForm } from "@/components/auction/join-form";
import { MovedAwayNotice } from "@/components/auction/moved-away-notice";
import { ParticipantView } from "@/components/auction/participant-view";

export default async function ParticipantLeaguePage({ params }: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalizedCode = code.toUpperCase();

  const overview = await fetchLeagueOverview(normalizedCode);
  if (!overview) notFound();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  let league = null;
  if (userId) {
    league = await fetchLeagueByCode(normalizedCode);
  }
  const isOwner = Boolean(league && userId && league.owner_id === userId);
  const isMember = Boolean(league && userId && !isOwner);

  if (isOwner) {
    redirect(`/league/${normalizedCode}/admin`);
  }

  if (isMember && league) {
    const state = await buildLeagueState(league, userId);
    return <ParticipantView state={state} inviteCode={normalizedCode} />;
  }

  // Non membro: se la squadra è stata spostata su un altro dispositivo,
  // mostra l'avviso e riporta alla home invece del form di ingresso.
  if (userId) {
    const { data: transfer } = await supabase
      .rpc(SUPABASE_RPC.getMyTransfer, { invite: normalizedCode })
      .maybeSingle();
    const teamName = (transfer as { team_name?: string } | null)?.team_name;
    if (teamName) {
      return <MovedAwayNotice teamName={teamName} inviteCode={normalizedCode} />;
    }
  }

  const lobbyClosed = overview.status !== "SETUP" && overview.status !== "LOBBY";
  const lobbyFull = overview.participant_count >= overview.participant_limit;
  const blocked = lobbyClosed || lobbyFull;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-10 sm:px-6">
      <header className="text-center">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--brand-dark)]">Sei stato invitato</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{overview.name}</h1>
        <p className="numeric mt-2 text-sm font-semibold text-[var(--muted)]">
          {overview.participant_count}/{overview.participant_limit} partecipanti · {overview.initial_budget} crediti · min {overview.min_bid}
        </p>
      </header>

      <JoinForm inviteCode={normalizedCode} disabled={blocked} />

      {blocked ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-sm font-bold text-amber-800">
          {lobbyFull
            ? "La lobby è completa: contatta l'admin della lega."
            : "L'asta è già iniziata o conclusa: non è più possibile iscriversi."}
        </p>
      ) : null}
    </main>
  );
}

import { LocalParticipantShell } from "@/components/auction/local-participant-shell";

export default async function LocalLeaguePage({ params, searchParams }: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ server?: string }>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  if (!query.server) return <main className="grid min-h-dvh place-items-center px-4">Server locale non configurato.</main>;
  return <LocalParticipantShell baseUrl={query.server} inviteCode={code.toUpperCase()} />;
}

import { LocalSetupShell } from "@/components/setup/local-setup-shell";

export default async function LocalSetupPage({ searchParams }: {
  searchParams: Promise<{ server?: string; session?: string }>;
}) {
  const params = await searchParams;
  if (!params.server || !params.session) {
    return <main className="grid min-h-dvh place-items-center px-4">Configurazione desktop mancante.</main>;
  }
  return <LocalSetupShell baseUrl={params.server} sessionId={params.session} />;
}

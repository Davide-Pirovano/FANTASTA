import { LocalAdminShell } from "@/components/auction/local-admin-shell";

/**
 * Renderer interno per l'host Electron. Non è collegato alla navigazione web:
 * riceve configurazione dal launcher desktop e non accede a Supabase.
 */
export default async function LocalAdminPage({ searchParams }: {
  searchParams: Promise<{ server?: string; session?: string; league?: string }>;
}) {
  const params = await searchParams;
  const server = params.server;
  const session = params.session;
  const league = params.league?.toUpperCase();
  if (!server || !session || !league) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-4">
        <section className="w-full max-w-md rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface)] p-6 text-center surface-shadow">
          <h1 className="text-xl font-black">Regia locale non configurata</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Il launcher desktop deve fornire server locale, sessione admin e codice lega.</p>
        </section>
      </main>
    );
  }
  return <LocalAdminShell baseUrl={server} sessionId={session} inviteCode={league} />;
}

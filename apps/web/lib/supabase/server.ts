import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  // SUPABASE_SERVER_URL permette di puntare a un host diverso da quello del browser
  // (es. host.docker.internal dentro il container Next.js con Supabase in Docker).
  const url = process.env.SUPABASE_SERVER_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Variabili Supabase mancanti");
  return createServerClient(url, key, {
    // Stesso nome del client browser: il cookie di sessione resta condiviso anche
    // quando client e server puntano a host Supabase diversi (127.0.0.1 vs host.docker.internal).
    cookieOptions: { name: "fantasta-auth" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // I Server Components non possono scrivere cookie: il token resta nel cookie di sessione.
        }
      },
    },
  });
}

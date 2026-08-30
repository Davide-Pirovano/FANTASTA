import { createBrowserClient } from "@supabase/ssr";

/**
 * URL Supabase valido per QUESTO browser.
 *
 * NEXT_PUBLIC_SUPABASE_URL punta a 127.0.0.1 (build Docker locale): sul Mac
 * funziona, ma su un telefono che ha aperto l'app tramite l'IP locale della
 * rete, 127.0.0.1 sarebbe il telefono stesso. Se la pagina è servita da un
 * host non loopback, sostituiamo l'host con quello della pagina (stessa
 * macchina, stessa porta) così REST e realtime raggiungono Supabase.
 */
function browserUrl(raw: string): string {
  if (typeof window === "undefined") return raw;
  try {
    const url = new URL(raw);
    const host = window.location.hostname;
    const loopback = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
    if (loopback.includes(url.hostname) && host && !loopback.includes(host)) {
      url.hostname = host;
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Configura NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return createBrowserClient(browserUrl(url), key, {
    // Nome cookie fisso: il server usa un URL Supabase diverso (es. host.docker.internal
    // dentro Docker), quindi il nome di default sb-<ref>-auth-token non coinciderebbe.
    cookieOptions: { name: "fantasta-auth" },
  });
}

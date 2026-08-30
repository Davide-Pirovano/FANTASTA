"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function useLeagueRealtime(leagueId: string, enabled = true) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 80);
    };

    const subscribe = async () => {
      // Il token di sessione deve raggiungere il client realtime PRIMA della join
      // del canale: altrimenti la sottoscrizione parte come anonima e Postgres
      // Changes applica RLS, scartando ogni evento. getSession + setSession
      // propagano il token in modo deterministico prima di subscribe().
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session) {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      }
      if (disposed) return;

      // `bids` non ha la colonna league_id: le variazioni di offerta vengono già
      // intercettate tramite l'aggiornamento della riga `auctions` (prezzo + leader).
      const keyedTables = ["participants", "players", "auctions", "purchases"] as const;
      channel = supabase.channel(`league:${leagueId}`);
      for (const table of keyedTables) {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `league_id=eq.${leagueId}` },
          refresh
        );
      }
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leagues", filter: `id=eq.${leagueId}` },
        refresh
      );
      channel.subscribe();
    };

    void subscribe();

    return () => {
      disposed = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [leagueId, router, enabled]);
}

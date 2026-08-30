"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LogIn, QrCode } from "lucide-react";
import { toast } from "sonner";
import { joinLeagueCommandSchema, rejoinLeagueCommandSchema, SUPABASE_RPC } from "@fantasta/contracts";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function JoinForm({ inviteCode, disabled, initialRejoin }: {
  inviteCode: string;
  /** True quando la lega non è più raggiungibile (lobby chiusa). */
  disabled?: boolean;
  /** Apre direttamente il modulo di rientro (usato dal MovedAwayNotice). */
  initialRejoin?: boolean;
}) {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [rejoinTeam, setRejoinTeam] = useState("");
  const [rejoinMode, setRejoinMode] = useState(initialRejoin ?? false);
  const [rejoining, setRejoining] = useState(false);
  const [pending, startTransition] = useTransition();

  function join() {
    if (pending || disabled) return;
    if (teamName.trim().length < 2) return toast.error("Inserisci il nome della squadra (minimo 2 caratteri).");

    startTransition(async () => {
      try {
        const command = joinLeagueCommandSchema.parse({
          inviteCode,
          participantName: teamName,
          teamName,
        });
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          const signed = await supabase.auth.signInAnonymously();
          if (signed.error) throw new Error(`Accesso non riuscito: ${signed.error.message}`);
        }
        const res = await supabase.rpc(SUPABASE_RPC.joinLeague, {
          invite: command.inviteCode,
          participant_name: command.participantName,
          fantasy_team: command.teamName,
        });
        if (res.error) throw new Error(res.error.message);
        router.refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Errore inatteso durante l'accesso.");
      }
    });
  }

  function rejoin() {
    if (pending || rejoining) return;
    if (rejoinTeam.trim().length < 2) return toast.error("Inserisci il nome della tua squadra.");

    startTransition(async () => {
      setRejoining(true);
      try {
        const command = rejoinLeagueCommandSchema.parse({
          inviteCode,
          teamName: rejoinTeam,
        });
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          const signed = await supabase.auth.signInAnonymously();
          if (signed.error) throw new Error(`Accesso non riuscito: ${signed.error.message}`);
        }
        const res = await supabase.rpc(SUPABASE_RPC.rejoinLeague, {
          invite: command.inviteCode,
          fantasy_team: command.teamName,
        });
        if (res.error) throw new Error(res.error.message);
        // Squadra spostata da un altro dispositivo: avvisa subito il vecchio
        // device con un broadcast sul canale della lega (il realtime normale
        // non lo raggiunge perché la RLS gli nasconde la riga).
        const first = Array.isArray(res.data) ? res.data[0] : res.data;
        if (first?.moved && first.participant?.league_id) {
          const broadcast = supabase.channel(`team-moved:${first.participant.league_id}`);
          await broadcast.subscribe();
          await broadcast.send({
            type: "broadcast",
            event: "team-moved",
            payload: { team_name: first.participant.team_name },
          });
          void supabase.removeChannel(broadcast);
        }
        router.refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Errore inatteso durante il rientro.");
      } finally {
        setRejoining(false);
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <section className="surface-shadow rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7">
        <span className="grid size-11 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
          <QrCode className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-black tracking-[-0.03em]">Entra nella lega</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Codice invito <strong className="numeric tracking-wider text-[var(--ink)]">{inviteCode.toUpperCase()}</strong>
        </p>

        {rejoinMode ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              rejoin();
            }}
          >
            <label className="block">
              <span className="text-sm font-black">Nome della tua squadra</span>
              <input
                className="mt-1.5 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--background)] px-4 font-semibold outline-none focus:border-[var(--brand)]"
                value={rejoinTeam}
                onChange={(event) => setRejoinTeam(event.target.value)}
                placeholder="Es. AC TUA"
                maxLength={50}
                autoFocus
              />
            </label>
            <Button type="submit" size="lg" className="w-full" disabled={pending || rejoining}>
              {rejoining ? "Rientro in corso..." : "Rientra nella tua squadra"}
              {!rejoining ? <LogIn className="size-5" /> : null}
            </Button>
            <button
              type="button"
              onClick={() => setRejoinMode(false)}
              className="w-full text-center text-xs font-bold text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Non eri iscritto? Entra come nuovo partecipante
            </button>
          </form>
        ) : (
          <>
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                join();
              }}
            >
              <label className="block">
                <span className="text-sm font-black">Nome squadra fantacalcio</span>
                <input
                  className="mt-1.5 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--background)] px-4 font-semibold outline-none focus:border-[var(--brand)]"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  placeholder="Es. AC TUA"
                  maxLength={50}
                />
              </label>

              <Button type="submit" size="lg" className="w-full" disabled={pending || disabled}>
                {disabled ? "Lobby non disponibile" : pending ? "Accesso in corso..." : "Entra nella lobby"}
                {!disabled && !pending ? <ArrowRight className="size-5" /> : null}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => setRejoinMode(true)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-sm font-black text-[var(--brand-dark)] hover:border-[var(--brand)]"
            >
              <LogIn className="size-4" /> Sei già nella lega? Rientra con il nome della squadra
            </button>
          </>
        )}
      </section>
    </div>
  );
}

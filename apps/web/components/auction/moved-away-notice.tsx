"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, House } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JoinForm } from "@/components/auction/join-form";

/**
 * Mostrato al dispositivo che ha perso la squadra (qualcuno è rientrato da un
 * altro dispositivo): avvisa e riporta alla home. Permette anche di rientrare
 * da qui per riprendersi la squadra (l'ultimo che rientra vince).
 */
export function MovedAwayNotice({ teamName, inviteCode }: {
  teamName: string;
  inviteCode: string;
}) {
  const router = useRouter();
  const [rejoinHere, setRejoinHere] = useState(false);

  useEffect(() => {
    // Se l'utente sceglie di rientrare da qui, non riportare alla home.
    if (rejoinHere) return;
    const timer = setTimeout(() => router.replace("/"), 3000);
    return () => clearTimeout(timer);
  }, [router, rejoinHere]);

  if (rejoinHere) {
    return <JoinForm inviteCode={inviteCode} initialRejoin />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-4 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-3xl bg-amber-100 text-amber-700">
        <ArrowLeftRight className="size-7" />
      </span>
      <div>
        <h1 className="text-2xl font-black leading-tight tracking-[-0.03em]">
          La tua squadra è collegata a un altro dispositivo
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          “{teamName}” è stata spostata su un altro dispositivo. Se sei tu, rientra da
          quello. Tra pochi istanti questa pagina torna alla home.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button size="lg" className="w-full" onClick={() => router.replace("/")}>
          <House className="size-5" /> Torna alla home
        </Button>
        <button
          type="button"
          onClick={() => setRejoinHere(true)}
          className="w-full text-sm font-black text-[var(--brand-dark)] hover:underline"
        >
          Ero io: rientra da questo dispositivo
        </button>
      </div>
    </main>
  );
}

"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Database, FileSpreadsheet, House, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { RepairAuctionInput } from "@fantasta/contracts";
import { createRepairAuctionAction } from "@/app/actions/setup";
import { Logo } from "@/components/ui/logo";
import { processExcelSheets, type ParseExcelResult } from "@/lib/domain/excel-parser";
import { parseLeagueExport, type ImportedRoster } from "@/lib/domain/league-export-parser";
import { cn } from "@/lib/utils";

type Source = { id: string; name: string; initial_budget: number; min_bid: number };
type Result = { ok: boolean; error?: string; league?: { invite_code: string } };
const STEPS = ["Rose", "Regole", "Lobby"];
const REFUNDS = [["one", "1 credito"], ["half", "Metà crediti"], ["full", "Tutti i crediti"], ["quotation", "Quotazione listone"]] as const;
const inputClass = "min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 font-bold outline-none transition-colors focus:border-[var(--brand)]";

async function readWorkbook(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Carica un file Excel .xlsx");
  const readExcelFile = (await import("read-excel-file/browser")).default;
  const raw = await readExcelFile(file);
  return Array.isArray(raw) ? raw.map((sheet) => ({ sheet: sheet.sheet, data: sheet.data as unknown[][] })) : [];
}

export function RepairWizard({ sources, createRepair, adminHref, homeHref = "/", initialSourceId }: { sources: Source[]; createRepair?: (input: RepairAuctionInput) => Promise<Result>; adminHref?: (code: string) => string; homeHref?: string; initialSourceId?: string }) {
  const router = useRouter();
  const preferredSource = sources.find((source) => source.id === initialSourceId) ?? sources[0];
  const [step, setStep] = useState(0);
  const [sourceKind, setSourceKind] = useState<"league" | "excel">(preferredSource ? "league" : "excel");
  const [sourceLeagueId, setSourceLeagueId] = useState(preferredSource?.id ?? "");
  const [rosters, setRosters] = useState<ImportedRoster[] | null>(null);
  const [name, setName] = useState(preferredSource ? `${preferredSource.name} · Riparazione` : "Asta di riparazione");
  const [listone, setListone] = useState<ParseExcelResult | null>(null);
  const [releaseRefund, setReleaseRefund] = useState<"one" | "half" | "full" | "zero" | "quotation">("half");
  const [movedAwayRefund, setMovedAwayRefund] = useState<"one" | "half" | "full" | "quotation">("quotation");
  const [keepResiduals, setKeepResiduals] = useState(true);
  const [baseCredits, setBaseCredits] = useState("0");
  const [pending, startTransition] = useTransition();
  const selected = sources.find((source) => source.id === sourceLeagueId);
  const sourceReady = sourceKind === "league" ? Boolean(selected) : Boolean(rosters);
  const canContinue = step === 0 ? sourceReady && Boolean(listone) : true;
  const fixedCredits = Number(baseCredits);
  const creditMode = keepResiduals ? (fixedCredits > 0 ? "carry_plus" : "carry_over") : "fixed";

  async function importListone(file: File) {
    try {
      const parsed = processExcelSheets(await readWorkbook(file));
      if (!parsed.success) throw new Error(parsed.error);
      setListone(parsed);
      toast.success(`${parsed.players.length} giocatori nel nuovo listone`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossibile leggere il listone");
    }
  }

  async function importRosters(file: File) {
    try {
      const parsed = parseLeagueExport(await readWorkbook(file));
      if (!parsed.ok) throw new Error(parsed.error);
      setRosters(parsed.teams);
      const base = file.name.replace(/\.xlsx$/i, "").trim();
      if (base) setName(`${base} · Riparazione`);
      toast.success(`${parsed.teams.length} rose importate`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossibile leggere le rose");
    }
  }

  function submit() {
    if (!listone) return toast.error("Importa il nuovo listone");
    if (sourceKind === "league" && !selected) return toast.error("Seleziona l'asta iniziale");
    if (sourceKind === "excel" && !rosters) return toast.error("Importa l'Excel della lega iniziale");
    const input: RepairAuctionInput = {
      source: sourceKind === "league" ? { kind: "league", leagueId: sourceLeagueId } : { kind: "excel", teams: rosters! },
      leagueName: name,
      initialBudget: sourceKind === "league" ? selected!.initial_budget : Math.max(...rosters!.map((team) => team.initialBudget)),
      minBid: sourceKind === "league" ? selected!.min_bid : 1,
      auctionTimerSeconds: 15,
      asteMode: "per_ruoli",
      releaseRefund,
      movedAwayRefund,
      creditMode,
      fixedCredits: creditMode === "carry_over" ? undefined : fixedCredits,
      players: listone.players,
    };
    startTransition(async () => {
      const response = createRepair ? await createRepair(input) : await createRepairAuctionAction(input);
      if (!response.ok || !response.league) {
        toast.error(response.error ?? "Creazione non riuscita");
        return;
      }
      router.push(adminHref ? adminHref(response.league.invite_code) : `/league/${response.league.invite_code}/admin`);
    });
  }

  return (
    <main className="min-h-dvh bg-[var(--background)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href={homeHref}><Logo /></Link>
          <Link href={homeHref} className="pressable inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-sm font-black text-[var(--muted)] transition-colors hover:text-[var(--ink)]"><House className="size-4" /> Home</Link>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100dvh-73px)] max-w-6xl gap-6 px-5 py-5 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-6">
        <aside className="lg:pt-1">
          <ol className="grid grid-cols-3 gap-2 lg:block lg:space-y-2">
            {STEPS.map((label, index) => (
              <li key={label}>
                <button type="button" disabled={index > step || pending} onClick={() => setStep(index)} className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-bold transition-colors lg:px-3", index === step ? "bg-[var(--brand-soft)] text-[var(--brand-dark)] shadow-sm" : index < step ? "text-[var(--ink)] hover:bg-[var(--surface-soft)]" : "cursor-not-allowed text-[var(--muted)] opacity-60")}>
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-black", index < step ? "bg-[var(--brand)] text-white" : index === step ? "bg-[var(--brand-dark)] text-white" : "bg-[var(--surface-soft)] text-[var(--muted)]")}>{index < step ? <Check className="size-4" /> : index + 1}</span>
                  <span>{label}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="flex min-w-0 flex-col rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_50px_-38px_rgba(24,51,40,0.55)] sm:p-7">
          <header className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]"><RefreshCw className="size-5" /></span>
            <div><h1 className="text-2xl font-black tracking-tight text-[var(--ink)]">Asta di riparazione</h1><p className="mt-0.5 text-sm text-[var(--muted)]">{step === 0 ? "Importa rose e listone aggiornato." : step === 1 ? "Definisci rimborsi e crediti." : "Controlla e apri la nuova lobby."}</p></div>
          </header>

          <div className="mt-7 flex-1">
            {step === 0 ? (
              <div className="space-y-5">
                <section><h2 className="text-sm font-black">Da dove recuperiamo le rose?</h2><div className="mt-2 grid gap-2 sm:grid-cols-2"><SourceButton active={sourceKind === "league"} disabled={!sources.length} icon={<Database className="size-5" />} title="Asta salvata" detail={sources.length ? "Usa un'asta conclusa nell'app" : "Nessuna asta conclusa"} onClick={() => setSourceKind("league")} /><SourceButton active={sourceKind === "excel"} icon={<FileSpreadsheet className="size-5" />} title="Excel esportato" detail="Usa Export lega completa" onClick={() => setSourceKind("excel")} /></div></section>
                {sourceKind === "league" ? <label className="block text-sm font-black">Asta iniziale<select value={sourceLeagueId} onChange={(event) => { setSourceLeagueId(event.target.value); const found = sources.find((source) => source.id === event.target.value); if (found) setName(`${found.name} · Riparazione`); }} className={`${inputClass} mt-2`}>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label> : <Upload label="Excel della lega iniziale" ready={rosters ? `${rosters.length} rose pronte` : null} hint="Fogli Riepilogo squadre e Acquisti" onFile={importRosters} />}
                <Upload label="Nuovo listone aggiornato" ready={listone ? `${listone.players.length} giocatori pronti` : null} hint="Listone Excel aggiornato" onFile={importListone} />
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-6"><section className="grid gap-5 sm:grid-cols-2"><RuleSelect title="Svincoli volontari" value={releaseRefund} options={REFUNDS} onChange={(value) => setReleaseRefund(value as typeof releaseRefund)} /><RuleSelect title="Giocatori fuori listone" value={movedAwayRefund} options={REFUNDS} onChange={(value) => setMovedAwayRefund(value as typeof movedAwayRefund)} /></section><section><h2 className="text-sm font-black">Crediti alla partenza</h2><p className="mt-1 text-sm text-[var(--muted)]">Puoi conservare i residui e aggiungere una base uguale per ogni squadra.</p><div className="mt-3 space-y-3"><div className="flex flex-wrap items-center gap-3"><span className="text-sm font-black">Mantieni i residui dall'asta precedente?</span><div className="flex rounded-xl bg-[var(--surface-soft)] p-1"><button type="button" onClick={() => setKeepResiduals(true)} aria-pressed={keepResiduals} className={cn("min-h-10 rounded-lg px-5 text-sm font-bold transition-colors", keepResiduals ? "bg-[var(--brand)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")}>Sì</button><button type="button" onClick={() => setKeepResiduals(false)} aria-pressed={!keepResiduals} className={cn("min-h-10 rounded-lg px-5 text-sm font-bold transition-colors", !keepResiduals ? "bg-[var(--brand)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")}>No</button></div></div><label className="block text-sm font-black">Quota da aggiungere a tutti<input type="number" min={0} value={baseCredits} onChange={(event) => setBaseCredits(event.target.value)} aria-label="Quota aggiuntiva per squadra" className={`${inputClass} mt-2`} /></label></div></section></div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-5"><label className="block text-sm font-black">Nome della nuova asta<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={`${inputClass} mt-2`} /></label><div className="grid gap-3 sm:grid-cols-2"><Summary label="Rose di partenza" value={sourceKind === "league" ? selected?.name ?? "Asta salvata" : `${rosters?.length ?? 0} rose dall'Excel`} /><Summary label="Nuovo listone" value={`${listone?.players.length ?? 0} giocatori`} /><Summary label="Svincoli volontari" value={REFUNDS.find(([key]) => key === releaseRefund)?.[1] ?? ""} /><Summary label="Crediti" value={`${keepResiduals ? "Residui" : "Nessun residuo"}${fixedCredits > 0 ? ` + ${fixedCredits} a tutti` : ""}`} /></div>{sourceKind === "excel" && rosters ? <p className="rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-bold text-[var(--brand-dark)]">Ogni partecipante userà il nome esatto della propria squadra. L&apos;asta partirà quando tutte le {rosters.length} squadre saranno collegate.</p> : null}</div>
            ) : null}
          </div>

          <footer className="mt-7 flex items-center justify-between border-t border-[var(--line)] pt-5">
            {step > 0 ? <button type="button" onClick={() => setStep((current) => current - 1)} disabled={pending} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-black text-[var(--muted)] hover:bg-[var(--surface-soft)]"><ArrowLeft className="size-4" /> Indietro</button> : <span />}
            {step < 2 ? <button type="button" onClick={() => setStep((current) => current + 1)} disabled={!canContinue || pending} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-black text-white transition-colors hover:bg-[var(--brand-dark)] disabled:opacity-45">Continua <ArrowRight className="size-4" /></button> : <button type="button" onClick={submit} disabled={pending} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-black text-white transition-colors hover:bg-[var(--brand-dark)] disabled:opacity-45">{pending ? <Loader2 className="size-4 animate-spin" /> : null}{pending ? "Creazione in corso..." : "Crea lobby"}{!pending ? <ArrowRight className="size-4" /> : null}</button>}
          </footer>
        </section>
      </div>
    </main>
  );
}

function SourceButton({ active, disabled, icon, title, detail, onClick }: { active: boolean; disabled?: boolean; icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} aria-pressed={active} onClick={onClick} className={cn("flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left transition-colors disabled:opacity-45", active ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-soft)]")}><span className="text-[var(--brand-dark)]">{icon}</span><span><strong className="block text-sm">{title}</strong><span className="text-xs text-[var(--muted)]">{detail}</span></span></button>;
}

function Upload({ label, ready, hint, onFile }: { label: string; ready: string | null; hint: string; onFile: (file: File) => void | Promise<void> }) {
  return <section><h2 className="text-sm font-black">{label}</h2><label className="mt-2 flex min-h-20 cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--line)] p-5 transition-colors hover:bg-[var(--surface-soft)]"><FileSpreadsheet className="size-6 text-[var(--brand)]" /><span><strong className="block text-sm">{ready ?? "Scegli il file .xlsx"}</strong><span className="text-xs text-[var(--muted)]">{hint}</span></span><input type="file" accept=".xlsx" className="sr-only" onChange={(event) => event.target.files?.[0] && void onFile(event.target.files[0])} /></label></section>;
}

function RuleSelect({ title, value, options, onChange }: { title: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="text-sm font-black">{title}<select value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} mt-2`}>{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>;
}


function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-[var(--surface-soft)] px-4 py-3"><p className="text-xs font-black uppercase tracking-wide text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-black text-[var(--ink)]">{value}</p></div>;
}

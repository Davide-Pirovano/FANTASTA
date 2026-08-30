"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FileSpreadsheet,
  House,
  Loader2,
  Minus,
  Plus,
  Search,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import type { PlayerRole } from "@fantasta/domain/auction";
import { processExcelSheets, type ParseExcelResult } from "@/lib/domain/excel-parser";
import { createLeagueWithPlayersAction } from "@/app/actions/setup";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useLanOrigin } from "@/hooks/use-lan-origin";
import type { SetupInput } from "@fantasta/contracts";

const steps = ["Lega", "Listone", "Regole", "Lobby"];

const ROLE_COLORS: Record<PlayerRole, { bg: string; text: string; border: string }> = {
  P: { bg: "bg-white", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800" },
  D: { bg: "bg-white", text: "text-blue-700 dark:text-blue-400", border: "border-blue-200 dark:border-blue-800" },
  C: { bg: "bg-white", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800" },
  A: { bg: "bg-white", text: "text-rose-700 dark:text-rose-400", border: "border-rose-200 dark:border-rose-800" },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-[var(--ink)]">{label}</span>
      {hint ? <span className="ml-2 text-xs text-[var(--muted)]">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

const inputClass =
  "min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 font-semibold outline-none placeholder:text-[var(--muted)] focus:border-[var(--brand)] transition-colors";

type SetupResult =
  | { ok: true; league: { id: string; invite_code: string; name: string }; importedCount: number }
  | { ok: false; error: string };

type SetupWizardProps = {
  createLeague?: (input: SetupInput) => Promise<SetupResult>;
  subscribeParticipantCount?: (league: { id: string; invite_code: string }, onCount: (count: number) => void) => () => void;
  adminHref?: (inviteCode: string) => string;
  lobbyUrlForCode?: (inviteCode: string, origin: string | null) => string | null;
  /** Nel contesto desktop punta a /local/home con i parametri server/session. */
  homeHref?: string;
};

export function SetupWizard({
  createLeague = createLeagueWithPlayersAction,
  subscribeParticipantCount,
  adminHref = (inviteCode) => `/league/${inviteCode}/admin`,
  lobbyUrlForCode,
  homeHref = "/",
}: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Step 1: Lega
  const [leagueName, setLeagueName] = useState("Fanta League 2026");
  const [participantLimit, setParticipantLimit] = useState(8);
  const [initialBudget, setInitialBudget] = useState(500);

  // Step 2: Listone Excel
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [parseResult, setParseResult] = useState<ParseExcelResult | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>("ALL");

  // Step 3: Regole
  const [slots, setSlots] = useState<{ P: number; D: number; C: number; A: number }>({
    P: 3,
    D: 8,
    C: 8,
    A: 6,
  });
  const [minBid, setMinBid] = useState(1);
  const [auctionTimerSeconds, setAuctionTimerSeconds] = useState(15);
  const [asteMode, setAsteMode] = useState<"per_ruoli" | "libero">("per_ruoli");
  const [releaseRefund, setReleaseRefund] = useState<"full" | "half" | "one" | "zero">("half");

  // Step 4: Lega Creata nel DB
  const [createdLeague, setCreatedLeague] = useState<{ id: string; invite_code: string; name: string } | null>(null);
  const [importedCount, setImportedCount] = useState<number>(0);
  const [connectedCount, setConnectedCount] = useState(0);

  async function handleFileUpload(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Carica un file Excel con estensione .xlsx");
      return;
    }

    setIsReadingFile(true);
    try {
      // Caricamento dinamico del parser per risparmiare bundle iniziale
      const readExcelFileModule = await import("read-excel-file/browser");
      const readExcelFile = readExcelFileModule.default;

      // Legge tutti i fogli del file
      const rawSheets = await readExcelFile(file);

      // Normalizza formato per il nostro parser
      const sheetsData = Array.isArray(rawSheets)
        ? rawSheets.map((s) => ({
            sheet: s.sheet,
            data: s.data as unknown[][],
          }))
        : [];

      const result = processExcelSheets(sheetsData);

      if (!result.success || result.players.length === 0) {
        toast.error(result.error || "Nessun giocatore valido trovato nel file Excel.");
      } else {
        setParseResult(result);
      }
    } catch (err: unknown) {
      console.error("Errore lettura Excel:", err);
      toast.error("Impossibile leggere il file Excel. Verifica la formattazione.");
    } finally {
      setIsReadingFile(false);
    }
  }

  async function handleProceedToLobby() {
    startTransition(async () => {
      const res = await createLeague({
        leagueName,
        participantLimit,
        initialBudget,
        minBid,
        slots,
        auctionTimerSeconds,
        asteMode,
        releaseRefund,
        players: parseResult?.players ?? [],
      });

      if (res.ok) {
        setCreatedLeague(res.league);
        setImportedCount(res.importedCount);
        setStep(3);
      } else {
        toast.error(res.error || "Errore durante la creazione della lega.");
      }
    });
  }

  // Filtraggio giocatori per l'anteprima
  const filteredPlayers = (parseResult?.players ?? []).filter((p) => {
    const matchesSearch =
      !searchFilter ||
      p.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      p.real_team.toLowerCase().includes(searchFilter.toLowerCase());

    if (!matchesSearch) return false;

    if (selectedRoleFilter === "ALL") return true;
    if (selectedRoleFilter === "TRQ") return p.is_trequartista;
    return p.role === selectedRoleFilter;
  });

  const { origin } = useLanOrigin();
  const inviteCode = createdLeague?.invite_code || "ABCD12";
  const lobbyUrl = lobbyUrlForCode?.(inviteCode, origin) ?? (origin ? `${origin}/league/${inviteCode}` : null);

  // Aggiorna il contatore dei partecipanti collegati in tempo reale nella Lobby
  useEffect(() => {
    const leagueId = createdLeague?.id;
    if (!leagueId) return;

    if (subscribeParticipantCount) {
      return subscribeParticipantCount({ id: leagueId, invite_code: createdLeague.invite_code }, setConnectedCount);
    }

    const supabase = createClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const countParticipants = async () => {
      const { count } = await supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId);
      if (!disposed && typeof count === "number") setConnectedCount(count);
    };

    const refreshNow = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session) {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      }
      await countParticipants();
    };

    void refreshNow();

    const subscribe = async () => {
      await refreshNow();
      if (disposed) return;
      channel = supabase
        .channel(`setup-lobby:${leagueId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `league_id=eq.${leagueId}` }, () => {
          void countParticipants();
        })
        .subscribe();
    };
    void subscribe();

    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [createdLeague, subscribeParticipantCount]);

  return (
    <main className="min-h-dvh bg-[var(--background)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href={homeHref}>
            <Logo />
          </Link>
          <Link
            href={homeHref}
            className="pressable inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-sm font-black text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          >
            <House className="size-4" /> Home
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-4 sm:px-8 lg:grid-cols-[220px_1fr] lg:py-6">
        {/* Step Indicator */}
        <aside>
          <ol className="grid grid-cols-4 gap-2 lg:block lg:space-y-2">
            {steps.map((label, index) => (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => index <= step && !isPending && setStep(index)}
                  disabled={index > step || isPending}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-bold transition-all lg:px-3",
                    index === step
                      ? "bg-[var(--brand-soft)] text-[var(--brand-dark)] shadow-sm"
                      : index < step
                      ? "text-[var(--ink)] hover:bg-[var(--surface-soft)]"
                      : "cursor-not-allowed text-[var(--muted)] opacity-60"
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-xs font-black",
                      index < step
                        ? "bg-[var(--brand)] text-white"
                        : index === step
                        ? "bg-[var(--brand-dark)] text-white"
                        : "bg-[var(--surface-soft)] text-[var(--muted)]"
                    )}
                  >
                    {index < step ? <Check className="size-4" /> : index + 1}
                  </span>
                  <span className="hidden lg:block">{label}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        {/* Wizard Card */}
        <section className="surface-shadow min-w-0 rounded-[1.75rem] border border-[var(--line)] bg-[var(--surface)] px-5 py-5 sm:p-6">
          {/* STEP 1: LEGA */}
          {step === 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--brand-dark)]">Partiamo dalle basi</p>
              <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-[var(--ink)]">Crea la tua lega</h1>
              <p className="mt-3 max-w-xl leading-7 text-[var(--muted)]">
                Definisci il nome della lega, il numero di partecipanti e i crediti d'asta iniziali.
              </p>

              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Nome lega">
                    <input
                      className={inputClass}
                      value={leagueName}
                      onChange={(e) => setLeagueName(e.target.value)}
                      maxLength={80}
                      placeholder="Es. Fanta Champions 2026"
                      required
                    />
                  </Field>
                </div>
                <Field label="Numero partecipanti" hint="da 2 a 30">
                  <input
                    className={inputClass}
                    type="number"
                    value={participantLimit}
                    onChange={(e) => setParticipantLimit(Math.max(2, Math.min(30, parseInt(e.target.value) || 2)))}
                    min={2}
                    max={30}
                  />
                </Field>
                <Field label="Crediti iniziali per squadra" hint="minimo 1">
                  <input
                    className={inputClass}
                    type="number"
                    value={initialBudget}
                    onChange={(e) => setInitialBudget(Math.max(1, parseInt(e.target.value) || 1))}
                    min={1}
                  />
                </Field>
              </div>
            </div>
          )}

          {/* STEP 2: LISTONE EXCEL */}
          {step === 1 && (
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--brand-dark)]">Importazione automatica</p>
              <h1 className="mt-2 text-2xl font-black tracking-[-0.045em] text-[var(--ink)]">Carica il listone Excel</h1>

              {/* Upload Dropzone */}
              <label className="mt-4 flex min-h-14 cursor-pointer items-center gap-3.5 rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 transition-colors hover:border-[var(--brand)]">
                {isReadingFile ? (
                  <div className="flex items-center gap-3">
                    <Loader2 className="size-5 text-[var(--brand)] animate-spin" />
                    <span className="font-black text-sm">Analisi e decodifica del file Excel in corso...</span>
                  </div>
                ) : (
                  <>
                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Upload className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="block font-black text-sm text-[var(--ink)]">Trascina il file Excel o clicca per caricarlo</span>
                      <span className="block text-xs text-[var(--muted)]">Esporta la lista giocatori in formato .xlsx da Fantamaster o Leghe Fantacalcio e caricala qui!</span>
                    </div>
                  </>
                )}
                <input
                  className="sr-only"
                  type="file"
                  accept=".xlsx"
                  disabled={isReadingFile}
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                />
              </label>

              {/* Statistiche del Listone */}
              {parseResult && parseResult.success && (
                <div className="mt-4 space-y-4">
                  {/* Summary Bar */}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    <div className="rounded-xl border border-[var(--line)] bg-white p-2 text-center">
                      <p className="text-[10px] font-bold text-[var(--muted)]">Totale</p>
                      <p className="numeric text-xl font-black text-[var(--ink)]">{parseResult.stats.total}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-white p-2 text-center">
                      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">Portieri</p>
                      <p className="numeric text-xl font-black text-amber-700 dark:text-amber-300">{parseResult.stats.byRole.P}</p>
                    </div>
                    <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-white p-2 text-center">
                      <p className="text-[10px] font-bold text-blue-700 dark:text-blue-400">Difensori</p>
                      <p className="numeric text-xl font-black text-blue-700 dark:text-blue-300">{parseResult.stats.byRole.D}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-white p-2 text-center">
                      <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">Centrocampisti</p>
                      <p className="numeric text-xl font-black text-emerald-700 dark:text-emerald-300">{parseResult.stats.byRole.C}</p>
                    </div>
                    <div className="rounded-xl border border-purple-200 dark:border-purple-900 bg-white p-2 text-center">
                      <p className="text-[10px] font-bold text-purple-700 dark:text-purple-400">Trequartisti</p>
                      <p className="numeric text-xl font-black text-purple-700 dark:text-purple-300">{parseResult.stats.trequartisti}</p>
                    </div>
                    <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-white p-2 text-center">
                      <p className="text-[10px] font-bold text-rose-700 dark:text-rose-400">Attaccanti</p>
                      <p className="numeric text-xl font-black text-rose-700 dark:text-rose-300">{parseResult.stats.byRole.A}</p>
                    </div>
                  </div>

                  {/* Filter & Search */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[var(--muted)]" />
                      <input
                        className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] pl-10 pr-4 text-sm font-semibold outline-none focus:border-[var(--brand)]"
                        placeholder="Cerca per nome o squadra..."
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { id: "ALL", label: `Tutti (${parseResult.stats.total})` },
                        { id: "P", label: `P (${parseResult.stats.byRole.P})` },
                        { id: "D", label: `D (${parseResult.stats.byRole.D})` },
                        { id: "C", label: `C (${parseResult.stats.byRole.C})` },
                        { id: "TRQ", label: `TRQ (${parseResult.stats.trequartisti})` },
                        { id: "A", label: `A (${parseResult.stats.byRole.A})` },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSelectedRoleFilter(tab.id)}
                          className={cn(
                            "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                            selectedRoleFilter === tab.id
                              ? "bg-[var(--brand)] text-white shadow-sm"
                              : "bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--ink)]"
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Table Preview */}
                  <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
                    <div className="flex items-center justify-between bg-[var(--surface-soft)] px-3 py-2 border-b border-[var(--line)]">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                        Mostrati {filteredPlayers.length} di {parseResult.stats.total} giocatori
                      </p>
                      <span className="text-[11px] font-semibold text-[var(--brand-dark)]">
                        Fonte: {parseResult.sheetNameUsed || "Excel"}
                      </span>
                    </div>
                    <div className="max-h-[185px] overflow-auto">
                      <table className="w-full min-w-[300px] text-left text-sm">
                        <thead className="sticky top-0 bg-[var(--surface)] border-b border-[var(--line)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                          <tr>
                            <th className="px-3 py-1.5">Nome</th>
                            <th className="hidden px-3 py-1.5 sm:table-cell">Squadra</th>
                            <th className="px-3 py-1.5 text-center">Ruolo</th>
                            <th className="hidden px-3 py-1.5 text-center sm:table-cell">Trequartista</th>
                            <th className="px-3 py-1.5 text-right">Quotazione</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--line)]">
                          {filteredPlayers.slice(0, 50).map((player, index) => {
                            const roleColor = ROLE_COLORS[player.role];
                            return (
                              <tr key={index} className="transition-colors hover:bg-[var(--surface-soft)]/50">
                                <td className="px-3 py-1.5 font-bold text-[var(--ink)]">{player.name}</td>
                                <td className="hidden px-3 py-1.5 text-sm text-[var(--muted)] sm:table-cell">{player.real_team}</td>
                                <td className="px-3 py-1.5 text-center">
                                  <span
                                    className={cn(
                                      "inline-flex size-6 items-center justify-center rounded-md text-xs font-black border",
                                      roleColor.bg,
                                      roleColor.text,
                                      roleColor.border
                                    )}
                                  >
                                    {player.role}
                                  </span>
                                </td>
                                <td className="hidden px-3 py-1.5 text-center sm:table-cell">
                                  {player.is_trequartista ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-950/50 px-2 py-0.5 text-xs font-black text-purple-700 dark:text-purple-300">
                                      <Sparkles className="size-3" /> SI
                                    </span>
                                  ) : (
                                    <span className="text-xs text-[var(--muted)]">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-right font-black numeric text-[var(--ink)]">
                                  {player.quotation}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: REGOLE */}
          {step === 2 && (
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--brand-dark)]">Regole automatiche</p>
              <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-[var(--ink)]">Configura le rose</h1>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["P", "D", "C", "A"] as const).map((role) => {
                  const roleLabels = { P: "Portieri", D: "Difensori", C: "Centrocampisti", A: "Attaccanti" };
                  const roleColor = ROLE_COLORS[role];
                  const changeSlots = (delta: number) =>
                    setSlots((prev) => ({ ...prev, [role]: Math.max(0, prev[role] + delta) }));
                  return (
                    <div key={role} className="rounded-2xl border border-[var(--line)] bg-white p-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-lg text-xs font-black border",
                            roleColor.bg,
                            roleColor.text,
                            roleColor.border
                          )}
                        >
                          {role}
                        </span>
                        <span className="truncate text-sm font-black text-[var(--ink)]">{roleLabels[role]}</span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-1 rounded-xl bg-[var(--surface-soft)] p-1">
                        <button
                          type="button"
                          onClick={() => changeSlots(-1)}
                          aria-label={`Riduci ${roleLabels[role]}`}
                          className="grid size-7 shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand-dark)]"
                        >
                          <Minus className="size-4" />
                        </button>
                        <input
                          type="number"
                          min={0}
                          value={slots[role]}
                          onChange={(e) =>
                            setSlots((prev) => ({
                              ...prev,
                              [role]: Math.max(0, parseInt(e.target.value) || 0),
                            }))
                          }
                          className="numeric w-full bg-transparent text-center text-2xl font-black outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => changeSlots(1)}
                          aria-label={`Aumenta ${roleLabels[role]}`}
                          className="grid size-7 shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand-dark)]"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <Field label="Offerta minima iniziale">
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    value={minBid}
                    onChange={(e) => setMinBid(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </Field>
                <Field label="Conto alla rovescia">
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={60}
                    value={auctionTimerSeconds}
                    onChange={(e) => setAuctionTimerSeconds(Math.max(1, Math.min(60, parseInt(e.target.value) || 15)))}
                  />
                </Field>
                <Field label="Modalità asta">
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-soft)] p-1">
                    <button
                      type="button"
                      onClick={() => setAsteMode("per_ruoli")}
                      aria-pressed={asteMode === "per_ruoli"}
                      className={cn(
                        "pressable rounded-lg px-2 py-2 text-center text-xs font-black transition-colors sm:text-sm",
                        asteMode === "per_ruoli"
                          ? "bg-[var(--surface)] text-[var(--brand-dark)] shadow-sm"
                          : "text-[var(--muted)] hover:text-[var(--ink)]"
                      )}
                    >
                      Per ruoli
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsteMode("libero")}
                      aria-pressed={asteMode === "libero"}
                      className={cn(
                        "pressable rounded-lg px-2 py-2 text-center text-xs font-black transition-colors sm:text-sm",
                        asteMode === "libero"
                          ? "bg-[var(--surface)] text-[var(--brand-dark)] shadow-sm"
                          : "text-[var(--muted)] hover:text-[var(--ink)]"
                      )}
                    >
                      Ordine sparso
                    </button>
                  </div>
                </Field>
                <Field label="Svincolo giocatori">
                  <div className="grid grid-cols-4 gap-1 rounded-xl bg-[var(--surface-soft)] p-1">
                    {(
                      [
                        { value: "full", label: "Crediti pieni" },
                        { value: "half", label: "Metà crediti" },
                        { value: "one", label: "1 credito" },
                        { value: "zero", label: "0 crediti" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setReleaseRefund(option.value)}
                        aria-pressed={releaseRefund === option.value}
                        aria-label={option.label}
                        className={cn(
                          "pressable rounded-lg px-2 py-2 text-center text-sm font-black transition-colors",
                          releaseRefund === option.value
                            ? "bg-[var(--surface)] text-[var(--brand-dark)] shadow-sm"
                            : "text-[var(--muted)] hover:text-[var(--ink)]"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

            </div>
          )}

          {/* STEP 4: LOBBY & CONDIVISIONE */}
          {step === 3 && (
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--brand-dark)]">Tutto pronto</p>
              <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-[var(--ink)]">Lega creata con successo!</h1>
              <p className="mt-3 max-w-xl leading-7 text-[var(--muted)]">
                {importedCount > 0
                  ? `Popolati ${importedCount} calciatori nel database. `
                  : "Listone pronto. "}
                Condividi il link o mostra il QR per far entrare i partecipanti.
              </p>

              <div className="mt-7 grid gap-6 md:grid-cols-[240px_1fr]">
                <div className="grid place-items-center rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
                  {lobbyUrl ? (
                    <QRCodeSVG value={lobbyUrl} size={180} level="M" fgColor="#183328" />
                  ) : (
                    <span className="px-4 text-center text-xs font-semibold text-[var(--muted)]">Calcolo URL della lobby…</span>
                  )}
                </div>
                <div className="flex flex-col justify-center">
                  <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">Codice invito</p>
                  <p className="numeric mt-1 text-4xl font-black tracking-[0.08em] text-[var(--brand-dark)]">{inviteCode}</p>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      disabled={!lobbyUrl}
                      onClick={() => {
                        if (!lobbyUrl) return;
                        void navigator.clipboard.writeText(lobbyUrl).then(
                          () => toast.success("Link copiato"),
                          (cause) => toast.error("Copia non riuscita", { description: cause instanceof Error ? cause.message : undefined })
                        );
                      }}
                    >
                      <Copy className="size-4" /> Copia link
                    </Button>
                    {origin && origin !== window.location.origin ? (
                      <p className="text-xs leading-5 text-[var(--muted)]">
                        IP di rete locale rilevato automaticamente: il QR funziona da dispositivi sulla stessa Wi-Fi del Mac.
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-4 flex items-center gap-3 rounded-xl bg-[var(--brand-soft)]/50 p-4">
                    <span className="grid size-10 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                      <Users className="size-5" />
                    </span>
                    <div>
                      <p className="font-black text-sm text-[var(--ink)]">Lobby aperta ({connectedCount} di {participantLimit} collegati)</p>
                      <p className="text-xs text-[var(--muted)]">I partecipanti compariranno in tempo reale</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="mt-6 flex items-center justify-between pt-2">
            {step > 0 && step < 3 ? (
              <Button
                variant="ghost"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                disabled={isPending}
              >
                <ArrowLeft className="size-4" /> Indietro
              </Button>
            ) : (
              <div />
            )}

            {step < 2 && (
              <Button
                onClick={() => setStep((current) => current + 1)}
                disabled={(step === 1 && !parseResult?.success) || isPending}
              >
                Continua <ArrowRight className="size-4" />
              </Button>
            )}

            {step === 2 && (
              <Button onClick={handleProceedToLobby} disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Creazione lega e import in corso...
                  </>
                ) : (
                  <>
                    Crea lega e importa listone <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            )}

            {step === 3 && (
              <Link
                href={adminHref(inviteCode)}
                className="pressable inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-black text-white shadow-md hover:bg-[var(--brand-dark)] transition-colors"
              >
                <FileSpreadsheet className="size-4" /> Entra nella regia dell'asta
              </Link>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

import type { PlayerRole } from "@fantasta/domain/auction";

export type ParsedPlayer = {
  name: string;
  real_team: string;
  role: PlayerRole;
  quotation: number;
  is_trequartista: boolean;
};

export type ParseExcelResult = {
  success: boolean;
  players: ParsedPlayer[];
  sheetNameUsed: string;
  availableSheets: string[];
  stats: {
    total: number;
    byRole: Record<PlayerRole, number>;
    trequartisti: number;
    teamsCount: number;
    avgQuotation: number;
    maxQuotation: { name: string; quotation: number; real_team: string } | null;
  };
  warnings: string[];
  error?: string;
};

type SheetData = {
  sheet: string;
  data: unknown[][];
};

const ROLE_MAP: Record<string, PlayerRole> = {
  p: "P",
  por: "P",
  portiere: "P",
  portieri: "P",
  d: "D",
  dif: "D",
  difensore: "D",
  difensori: "D",
  c: "C",
  cen: "C",
  centrocampista: "C",
  centrocampisti: "C",
  a: "A",
  att: "A",
  attaccante: "A",
  attaccanti: "A",
};

const SHEET_ROLE_INFERENCE: Record<string, { role: PlayerRole; isTrq?: boolean }> = {
  portieri: { role: "P" },
  portiere: { role: "P" },
  difensori: { role: "D" },
  difensore: { role: "D" },
  centrocampisti: { role: "C" },
  centrocampista: { role: "C" },
  trequartisti: { role: "C", isTrq: true },
  trequartista: { role: "C", isTrq: true },
  attaccanti: { role: "A" },
  attaccante: { role: "A" },
};

function normalizeText(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function parseBooleanTrq(val: unknown): boolean {
  if (val === true || val === 1) return true;
  if (val === false || val === 0 || val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  return ["si", "sì", "s", "yes", "y", "true", "1", "trq", "t"].includes(s);
}

function parseQuotation(val: unknown): number {
  if (typeof val === "number" && !isNaN(val)) {
    return Math.max(1, Math.round(val));
  }
  const s = normalizeText(val).replace(",", ".");
  const num = parseInt(s, 10);
  return isNaN(num) || num < 1 ? 1 : num;
}

type ColumnMapping = {
  nameIdx: number;
  teamIdx: number;
  roleIdx: number;
  quoteIdx: number;
  trqIdx: number;
};

function findHeaderRow(rows: unknown[][]): { headerIdx: number; mapping: ColumnMapping } | null {
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r] ?? [];
    let nameIdx = -1;
    let teamIdx = -1;
    let roleIdx = -1;
    let quoteIdx = -1;
    let trqIdx = -1;

    for (let c = 0; c < row.length; c++) {
      const cell = normalizeText(row[c]).toLowerCase();
      if (!cell) continue;

      if (nameIdx === -1 && ["nome", "calciatore", "giocatore", "player", "name"].includes(cell)) {
        nameIdx = c;
      } else if (teamIdx === -1 && ["squadra", "club", "team", "squadra reale", "club reale"].includes(cell)) {
        teamIdx = c;
      } else if (roleIdx === -1 && ["ruolo", "r", "role", "pos", "posizione"].includes(cell)) {
        roleIdx = c;
      } else if (quoteIdx === -1 && ["quotazione", "q", "qt", "quot.", "prezzo", "valore", "costo", "fvm"].includes(cell)) {
        quoteIdx = c;
      } else if (trqIdx === -1 && ["trequartista", "trq", "t"].includes(cell)) {
        trqIdx = c;
      }
    }

    // Un header valido deve contenere almeno Nome e (Squadra o Ruolo)
    if (nameIdx !== -1 && (teamIdx !== -1 || roleIdx !== -1)) {
      return {
        headerIdx: r,
        mapping: { nameIdx, teamIdx, roleIdx, quoteIdx, trqIdx },
      };
    }
  }

  return null;
}

export function parseRowsFromSheet(
  sheet: SheetData,
  defaultRoleFromSheet?: PlayerRole,
  defaultTrqFromSheet?: boolean
): { players: ParsedPlayer[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows = sheet.data;
  if (!rows || rows.length === 0) return { players: [], warnings };

  const headerInfo = findHeaderRow(rows);
  if (!headerInfo) {
    warnings.push(`Nessuna riga di intestazione riconosciuta nel foglio "${sheet.sheet}".`);
    return { players: [], warnings };
  }

  const { headerIdx, mapping } = headerInfo;
  const players: ParsedPlayer[] = [];

  // Righe di coda tipiche dei listoni FantaMaster (non sono giocatori).
  const FOOTER_MARKERS = ["ultimo aggiornamento", "scarica fantamaster", "fanta master"];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = mapping.nameIdx !== -1 ? normalizeText(row[mapping.nameIdx]) : "";
    const team = mapping.teamIdx !== -1 ? normalizeText(row[mapping.teamIdx]) : "Sconosciuta";

    if (!name || name.length < 2) continue;
    const nameLower = name.toLowerCase();
    if (FOOTER_MARKERS.some((marker) => nameLower.includes(marker))) continue;

    // Determina il ruolo
    let role: PlayerRole | undefined;
    if (mapping.roleIdx !== -1) {
      const rawRole = normalizeText(row[mapping.roleIdx]).toLowerCase();
      role = ROLE_MAP[rawRole];
    }
    if (!role && defaultRoleFromSheet) {
      role = defaultRoleFromSheet;
    }
    if (!role) {
      // Fallback a centrocampista o skip
      warnings.push(`Ruolo non valido per "${name}" (${team}), saltato.`);
      continue;
    }

    // Quotazione
    const quotation = mapping.quoteIdx !== -1 ? parseQuotation(row[mapping.quoteIdx]) : 1;

    // Trequartista
    let is_trequartista = false;
    if (mapping.trqIdx !== -1) {
      is_trequartista = parseBooleanTrq(row[mapping.trqIdx]);
    } else if (defaultTrqFromSheet) {
      is_trequartista = true;
    }

    players.push({
      name,
      real_team: team || "Serie A",
      role,
      quotation,
      is_trequartista,
    });
  }

  return { players, warnings };
}

export function processExcelSheets(sheets: SheetData[]): ParseExcelResult {
  const availableSheets = sheets.map((s) => s.sheet);
  const warnings: string[] = [];

  if (!sheets.length) {
    return {
      success: false,
      players: [],
      sheetNameUsed: "",
      availableSheets: [],
      stats: {
        total: 0,
        byRole: { P: 0, D: 0, C: 0, A: 0 },
        trequartisti: 0,
        teamsCount: 0,
        avgQuotation: 0,
        maxQuotation: null,
      },
      warnings: ["Il file Excel non contiene fogli di calcolo leggibili."],
      error: "File Excel vuoto",
    };
  }

  // 1. Cerca il foglio principale "Tutti" o "Listone" o "Giocatori"
  const tuttiSheet = sheets.find((s) =>
    ["tutti", "listone", "giocatori", "all", "players"].includes(s.sheet.trim().toLowerCase())
  );

  let finalPlayers: ParsedPlayer[] = [];
  let sheetNameUsed = "";

  if (tuttiSheet) {
    sheetNameUsed = tuttiSheet.sheet;
    const res = parseRowsFromSheet(tuttiSheet);
    finalPlayers = res.players;
    warnings.push(...res.warnings);
  } else {
    // 2. Se non c'è il foglio 'Tutti', controlla se ci sono fogli per ruolo (Portieri, Difensori, etc.)
    const roleSheets = sheets.filter((s) => {
      const name = s.sheet.trim().toLowerCase();
      return Boolean(SHEET_ROLE_INFERENCE[name]);
    });

    if (roleSheets.length > 0) {
      sheetNameUsed = roleSheets.map((s) => s.sheet).join(", ");
      for (const s of roleSheets) {
        const inf = SHEET_ROLE_INFERENCE[s.sheet.trim().toLowerCase()];
        const res = parseRowsFromSheet(s, inf.role, inf.isTrq);
        finalPlayers.push(...res.players);
        warnings.push(...res.warnings);
      }
    } else {
      // 3. Fallback al primo foglio disponibile
      sheetNameUsed = sheets[0].sheet;
      const res = parseRowsFromSheet(sheets[0]);
      finalPlayers = res.players;
      warnings.push(...res.warnings);
    }
  }

  // Deduplicazione per (name, real_team) mantenendo la quotazione più alta
  const playerMap = new Map<string, ParsedPlayer>();
  for (const p of finalPlayers) {
    const key = `${p.name.toLowerCase()}:::${p.real_team.toLowerCase()}`;
    const existing = playerMap.get(key);
    if (!existing) {
      playerMap.set(key, p);
    } else {
      // Aggiorna se il nuovo ha quotazione maggiore o flag trequartista
      playerMap.set(key, {
        ...existing,
        quotation: Math.max(existing.quotation, p.quotation),
        is_trequartista: existing.is_trequartista || p.is_trequartista,
      });
    }
  }

  const dedupedPlayers = Array.from(playerMap.values());

  // Calcolo statistiche
  const byRole: Record<PlayerRole, number> = { P: 0, D: 0, C: 0, A: 0 };
  let trequartisti = 0;
  let sumQuotation = 0;
  let maxQuotation: { name: string; quotation: number; real_team: string } | null = null;
  const teams = new Set<string>();

  for (const p of dedupedPlayers) {
    byRole[p.role] = (byRole[p.role] || 0) + 1;
    if (p.is_trequartista) trequartisti++;
    sumQuotation += p.quotation;
    teams.add(p.real_team);

    if (!maxQuotation || p.quotation > maxQuotation.quotation) {
      maxQuotation = { name: p.name, quotation: p.quotation, real_team: p.real_team };
    }
  }

  const total = dedupedPlayers.length;
  const avgQuotation = total > 0 ? Math.round((sumQuotation / total) * 10) / 10 : 0;

  return {
    success: total > 0,
    players: dedupedPlayers,
    sheetNameUsed,
    availableSheets,
    stats: {
      total,
      byRole,
      trequartisti,
      teamsCount: teams.size,
      avgQuotation,
      maxQuotation,
    },
    warnings,
  };
}

/**
 * xlsx-import.ts — client-side XLSX parser for the onboarding assets step.
 *
 * Reads an uploaded .xlsx workbook (the House asset-allocation template, or
 * any file with the same column headers), normalises each row into a
 * `WizardPositionV2`, and returns a structured result the UI can render
 * (parsed rows + per-row issues + a summary).
 *
 * Design notes:
 *   - Runs entirely in the browser. No server round-trip — the file never
 *     leaves the trustee's machine until they explicitly submit the trust.
 *     This matters for a non-custody product: the workbook can contain
 *     contract addresses and balances, so parsing locally is the right
 *     default.
 *   - Columns are resolved by HEADER NAME (case-insensitive, whitespace-
 *     insensitive) so the file is robust to column reordering and to
 *     translated/renamed headers. The canonical header set lives in
 *     `COLUMN_ALIASES` below.
 *   - Unknown venue kinds / position types are dropped to the empty string
 *     with a row-level warning rather than rejecting the whole file — the
 *     trustee can fix the row in the form.
 *   - "EXAMPLE — delete" rows (from the template) are auto-skipped so the
 *     trustee who forgets to delete them doesn't import the demo data.
 *   - Stablecoin entry prices are stripped (stables are $1.00 by definition;
 *     the form hides the field for them anyway).
 *
 * The shape returned mirrors what `page-assets.tsx` needs to render a
 * preview before merging into the wizard form.
 */

import * as XLSX from "xlsx";
import { categorizeAsset } from "@/server/domain/bankroll";
import {
  makeRowId,
  ONBOARDING_UNIVERSE,
  type DeFiPositionType,
  type VenueKind,
  type WizardPositionV2,
} from "@/components/onboarding/types";

// ---------------------------------------------------------------------------
// Column aliases — the parser resolves columns by header name. Each entry
// is the list of accepted header spellings (lowercased, trimmed). The first
// match wins, so the canonical name (index 0) is the one the template uses.
// ---------------------------------------------------------------------------

const COLUMN_ALIASES = {
  asset: ["asset", "asset id", "ticker", "symbol", "assetid"],
  quantity: ["quantity", "qty", "amount", "balance"],
  entryPrice: [
    "entry price (usdc)",
    "entry price",
    "entry price usdc",
    "cost basis",
    "cost",
    "price",
  ],
  venueKind: ["venue kind", "venuekind", "account kind", "custody type", "kind"],
  venue: ["venue", "venue name", "custodian", "exchange"],
  protocol: ["protocol", "defi protocol"],
  positionType: ["position type", "positiontype", "defi type"],
  apy: ["apy (%/year)", "apy (%)", "apy", "apy percent", "yield %"],
  lockEnd: [
    "lock end (yyyy-mm-dd)",
    "lock end",
    "lockend",
    "unlock date",
    "unlock",
  ],
  contractAddress: [
    "contract address",
    "contract",
    "contractaddress",
    "address",
  ],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** One row-level issue surfaced to the user after parsing. */
export interface ImportIssue {
  /** 1-based row number in the source sheet (header = row 1). */
  rowNumber: number;
  /** The column the issue is about (display name). */
  field: string;
  /** Human-readable message — shown in the preview table. */
  message: string;
  /** "warning" = row still imported (best-effort); "error" = row skipped. */
  severity: "warning" | "error";
}

/** The full result of parsing one workbook. */
export interface ImportResult {
  /** Successfully-parsed position rows (ready to merge into the wizard). */
  positions: WizardPositionV2[];
  /** Per-row issues (warnings + errors). Empty when the file is clean. */
  issues: ImportIssue[];
  /** Total rows examined (excluding the header). */
  totalRows: number;
  /** Rows skipped entirely (errors + empty rows + EXAMPLE rows). */
  skipped: number;
}

// ---------------------------------------------------------------------------
// Venue-kind + position-type whitelists (lowercased for matching).
// ---------------------------------------------------------------------------

const VENUE_KIND_VALUES: ReadonlySet<string> = new Set([
  "cex",
  "evm-wallet",
  "solana-wallet",
  "stake-defi",
  "xrp-wallet",
  "dex",
]);

const POSITION_TYPE_VALUES: ReadonlySet<DeFiPositionType> = new Set([
  "staking",
  "lending",
  "lp",
  "vault",
]);

/** Known asset ids (lowercased) — used to decide isCustomAsset. */
const KNOWN_ASSET_IDS: ReadonlySet<string> = new Set(
  ONBOARDING_UNIVERSE.map((a) => a.id.toLowerCase()),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a header string for matching: lowercase, collapse whitespace,
 * trim. Lets "Entry Price (USDC)" and "entry price ( usdc )" match.
 */
function normHeader(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a column-index lookup from the header row. Returns a map from
 * ColumnKey → 0-based column index, or -1 if the column is absent.
 */
function resolveColumns(
  headerRow: unknown[],
): Record<ColumnKey, number> {
  const lookup = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = normHeader(h);
    if (key && !lookup.has(key)) lookup.set(key, i);
  });

  const out = {} as Record<ColumnKey, number>;
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    const aliases = COLUMN_ALIASES[key];
    let idx = -1;
    for (const alias of aliases) {
      const found = lookup.get(alias);
      if (found !== undefined) {
        idx = found;
        break;
      }
    }
    out[key] = idx;
  }
  return out;
}

/**
 * Format a number as a clean string, killing IEEE-754 float artifacts.
 * XLSX number cells can surface as 1.2000000476837158 or 0.019999999552965164
 * (32-bit-fround leftovers from the spreadsheet format). Rounding to 10
 * significant digits restores the human-typed value (1.2, 0.02) without
 * losing real precision on crypto quantities (which max out at ~8 decimals).
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  // toPrecision(12) kills float noise; Number() strips trailing zeros.
  return String(Number(n.toPrecision(12)));
}

/** Coerce a cell value to a trimmed string. Numbers → clean string, dates → ISO. */
function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return formatNumber(v);
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  return String(v).trim();
}

/** Coerce a cell value to a finite number, or null. */
function cellToNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[,_\s]/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** True if a row is visibly the template's "EXAMPLE — delete" marker row. */
function isExampleMarkerRow(cells: unknown[]): boolean {
  const first = cellToString(cells[0]).toLowerCase();
  return first.startsWith("example");
}

/** True if every cell in a row is empty/blank. */
function isEmptyRow(cells: unknown[]): boolean {
  return cells.every((c) => cellToString(c) === "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an uploaded XLSX file into wizard positions.
 *
 * The promise resolves with an `ImportResult` even when the file has issues
 * — the UI decides whether to block on errors or proceed with warnings.
 * The promise rejects only on a hard read failure (corrupt file, not xlsx,
 * etc.).
 */
export async function parseAssetWorkbook(file: File): Promise<ImportResult> {
  // Read the file into an ArrayBuffer — xlsx.read accepts it directly.
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  // Pick the data sheet: prefer "Your assets" (template name), else the
  // first sheet that is NOT "Instructions" / "README" / "Read me".
  const dataSheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "your assets") ??
    wb.SheetNames.find(
      (n) => !["instructions", "readme", "read me", "how to"].includes(n.toLowerCase()),
    ) ??
    wb.SheetNames[0];

  if (!dataSheetName) {
    throw new Error("The workbook has no sheets.");
  }
  const ws = wb.Sheets[dataSheetName];
  if (!ws) {
    throw new Error(`Sheet "${dataSheetName}" could not be read.`);
  }

  // sheet_to_json with header:1 → array-of-arrays. defval:"" keeps empty
  // cells so column alignment is stable. blankrows:false drops fully-empty
  // rows (they'd add noise to totalRows).
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (matrix.length === 0) {
    return { positions: [], issues: [], totalRows: 0, skipped: 0 };
  }

  const headerRow = matrix[0] ?? [];
  const cols = resolveColumns(headerRow);

  if (cols.asset < 0 && cols.quantity < 0) {
    throw new Error(
      `No "Asset" or "Quantity" column found in sheet "${dataSheetName}". ` +
        "Check the header row matches the template.",
    );
  }

  const positions: WizardPositionV2[] = [];
  const issues: ImportIssue[] = [];
  let skipped = 0;

  // Walk rows starting at row 2 (row 1 is the header).
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r] ?? [];
    const rowNumber = r + 1; // 1-based, header is row 1

    if (isEmptyRow(cells)) {
      skipped++;
      continue;
    }
    if (isExampleMarkerRow(cells)) {
      skipped++;
      continue;
    }

    const issue = (field: string, message: string, severity: "warning" | "error") =>
      issues.push({ rowNumber, field, message, severity });

    // --- Asset (required) ---
    const assetRaw = cellToString(cells[cols.asset]);
    const assetId = assetRaw.trim();
    if (!assetId) {
      issue("Asset", "Asset is empty — row skipped.", "error");
      skipped++;
      continue;
    }
    const isCustomAsset = !KNOWN_ASSET_IDS.has(assetId.toLowerCase());
    if (isCustomAsset) {
      issue(
        "Asset",
        `"${assetId}" is not in the known universe — imported as a custom asset (defaults to the Aggressive sleeve).`,
        "warning",
      );
    }

    // --- Quantity (required, must be > 0) ---
    const qtyNum = cellToNumber(cells[cols.quantity]);
    if (qtyNum === null) {
      issue("Quantity", "Quantity is missing or not a number — row skipped.", "error");
      skipped++;
      continue;
    }
    if (qtyNum <= 0) {
      issue("Quantity", "Quantity must be greater than zero — row skipped.", "error");
      skipped++;
      continue;
    }
    const quantity = formatNumber(qtyNum);

    // --- Entry price (optional; stripped for stables) ---
    let entryPrice = "";
    const isStable = categorizeAsset(assetId) === "stable";
    const priceNum = cellToNumber(cells[cols.entryPrice]);
    if (priceNum !== null && priceNum > 0) {
      if (isStable) {
        // Stables are $1.00 by definition — drop the value but warn so the
        // trustee knows it was discarded rather than lost.
        issue(
          "Entry price",
          "Stablecoins are US$1.00 by definition — entry price discarded.",
          "warning",
        );
      } else {
        entryPrice = formatNumber(priceNum);
      }
    }

    // --- Venue kind (required) ---
    const venueKindRaw = cellToString(cells[cols.venueKind])
      .toLowerCase()
      .replace(/\s+/g, "-")
      .trim();
    let venueKind: VenueKind = "cex";
    if (!venueKindRaw) {
      issue(
        "Venue kind",
        "Venue kind is empty — defaulted to 'cex'. Fix in the form.",
        "warning",
      );
    } else if (VENUE_KIND_VALUES.has(venueKindRaw)) {
      venueKind = venueKindRaw as VenueKind;
    } else {
      issue(
        "Venue kind",
        `"${venueKindRaw}" is not a valid venue kind — defaulted to 'cex'. Valid: cex, evm-wallet, solana-wallet, stake-defi, xrp-wallet, dex.`,
        "warning",
      );
    }

    // --- Venue label (required) ---
    const venue = cellToString(cells[cols.venue]);
    if (!venue) {
      issue(
        "Venue",
        "Venue is empty — defaulted to the venue kind. Fix in the form.",
        "warning",
      );
    }

    // --- DeFi metadata (only relevant when venueKind === "stake-defi") ---
    const isDefi = venueKind === "stake-defi";
    let protocol = "";
    let positionType: DeFiPositionType | "" = "";
    let apyPercent = "";
    let lockEnd = "";
    let contractAddress = "";

    if (isDefi) {
      protocol = cellToString(cells[cols.protocol]);
      const ptRaw = cellToString(cells[cols.positionType]).toLowerCase().trim();
      if (ptRaw && POSITION_TYPE_VALUES.has(ptRaw as DeFiPositionType)) {
        positionType = ptRaw as DeFiPositionType;
      } else if (ptRaw) {
        issue(
          "Position type",
          `"${ptRaw}" is not a valid position type — cleared. Valid: staking, lending, lp, vault.`,
          "warning",
        );
      }
      const apyNum = cellToNumber(cells[cols.apy]);
      if (apyNum !== null && apyNum >= 0) {
        apyPercent = formatNumber(apyNum);
      }
      lockEnd = cellToString(cells[cols.lockEnd]);
      // Light date sanity: accept YYYY-MM-DD or an ISO prefix.
      if (lockEnd && !/^\d{4}-\d{2}-\d{2}/.test(lockEnd)) {
        issue(
          "Lock end",
          `"${lockEnd}" doesn't look like YYYY-MM-DD — kept as-is, fix if needed.`,
          "warning",
        );
      }
      contractAddress = cellToString(cells[cols.contractAddress]);
    }

    positions.push({
      id: makeRowId(),
      assetId,
      quantity,
      entryPrice,
      venueKind,
      venue,
      isCustomAsset,
      protocol,
      positionType,
      apyPercent,
      lockEnd,
      contractAddress,
    });
  }

  return {
    positions,
    issues,
    totalRows: matrix.length - 1, // exclude header
    skipped,
  };
}

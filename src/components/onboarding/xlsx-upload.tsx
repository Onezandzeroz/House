"use client";

import * as React from "react";
import {
  FileSpreadsheet,
  FileUp,
  Download,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  Plus,
  Replace,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

import {
  parseAssetWorkbook,
  type ImportResult,
} from "@/lib/xlsx-import";
import type { WizardPositionV2 } from "./types";

/**
 * XlsxUpload — the XLSX import card shown at the top of the onboarding
 * assets step (page-assets.tsx).
 *
 * Lets the trustee populate the assets table from a spreadsheet instead of
 * typing each row by hand. The workflow is:
 *
 *   1. The trustee downloads the template (the "Download template" link) or
 *      uses a file they already have with matching columns.
 *   2. They drag the .xlsx file onto the dropzone (or click "Browse files").
 *   3. The file is parsed entirely in the browser (see `xlsx-import.ts` —
 *      nothing is uploaded to the server at this stage).
 *   4. A preview shows how many rows parsed, how many were skipped, and any
 *      per-row warnings/errors.
 *   5. The trustee picks "Replace all rows" or "Add to existing rows" to
 *      commit the parsed positions into the wizard form.
 *
 * Design notes:
 *   - The dropzone is keyboard-accessible: a real <input type="file"> is
 *     visually hidden but focusable, and the labelled region doubles as
 *     the click target.
 *   - Parsing runs in a microtask so the UI can show a spinner. The xlsx
 *     library is fast (<100 ms for a few hundred rows) but the spinner
 *     avoids a janky freeze on large files.
 *   - Errors from the parser (corrupt file, wrong format) surface as a
 *     toast + an inline alert; the preview panel is only shown on success.
 *   - The "EXAMPLE — delete" rows from the template are auto-skipped by the
 *     parser, so the trustee who forgets to delete them doesn't import the
 *     demo BTC/USDC/stETH rows by accident.
 */

const TEMPLATE_PATH = "/templates/house-asset-allocation-template.xlsx";

export interface XlsxUploadProps {
  /**
   * Called with the parsed positions + the merge mode the trustee picked.
   * The parent (page-assets) owns the form state and applies the patch.
   */
  onImport: (
    positions: WizardPositionV2[],
    mode: "replace" | "append",
  ) => void;
}

export function XlsxUpload({ onImport }: XlsxUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isParsing, setIsParsing] = React.useState(false);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [fileName, setFileName] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");

  // ---- File handling ----------------------------------------------------

  const handleFile = React.useCallback(
    async (file: File) => {
      setError("");
      setResult(null);
      setFileName(file.name);

      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        setError("Please upload an .xlsx file. (The template is .xlsx — older .xls is not supported.)");
        toast.error("Unsupported file type");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("The file is larger than 5 MB. The template is ~40 KB — a file this large is likely the wrong one.");
        toast.error("File too large");
        return;
      }

      setIsParsing(true);
      try {
        // Yield to the event loop so the spinner paints before the (sync)
        // xlsx parse runs.
        await new Promise((r) => setTimeout(r, 10));
        const res = await parseAssetWorkbook(file);
        setResult(res);
        if (res.positions.length === 0) {
          toast.warning("No valid rows found", {
            description: "The file parsed but every row was empty or skipped.",
          });
        } else {
          toast.success(`Parsed ${res.positions.length} asset${res.positions.length === 1 ? "" : "s"}`, {
            description:
              res.issues.length === 0
                ? "No issues — ready to import."
                : `${res.issues.length} issue${res.issues.length === 1 ? "" : "s"} to review.`,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not read the file.";
        setError(msg);
        toast.error("Could not read the file", { description: msg });
      } finally {
        setIsParsing(false);
      }
    },
    [],
  );

  // ---- Drag + drop ------------------------------------------------------

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDragging) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only clear when leaving the dropzone itself (not a child).
    if (e.currentTarget === e.target) setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // ---- Input change (click-to-browse path) -----------------------------

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so selecting the same file again re-fires onChange.
    e.target.value = "";
  };

  // ---- Import actions ---------------------------------------------------

  const applyImport = (mode: "replace" | "append") => {
    if (!result || result.positions.length === 0) return;
    onImport(result.positions, mode);
    const verb = mode === "replace" ? "Replaced" : "Added";
    toast.success(`${verb} ${result.positions.length} asset${result.positions.length === 1 ? "" : "s"}`, {
      description:
        mode === "replace"
          ? "Existing rows were replaced with the spreadsheet rows."
          : "Spreadsheet rows were appended to the list.",
    });
    // Clear the preview so the trustee sees the populated table below.
    setResult(null);
    setFileName("");
  };

  const clearPreview = () => {
    setResult(null);
    setFileName("");
    setError("");
  };

  // ---- Render -----------------------------------------------------------

  const warnings = result?.issues.filter((i) => i.severity === "warning") ?? [];
  const errors = result?.issues.filter((i) => i.severity === "error") ?? [];

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5">
      {/* Header row: title + download-template link */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <FileSpreadsheet className="size-4" aria-hidden />
          </div>
          <div>
            <h3 className="font-serif text-base font-semibold tracking-tight text-foreground sm:text-lg">
              Import from spreadsheet
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Upload an .xlsx file and the rows below fill in automatically.
              Faster than typing each asset by hand.
            </p>
          </div>
        </div>
        <a
          href={TEMPLATE_PATH}
          download="house-asset-allocation-template.xlsx"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Download className="size-3.5" aria-hidden />
          Download template
        </a>
      </div>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload spreadsheet file — drag and drop or activate to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors sm:py-8",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragging
            ? "border-primary bg-primary/10 text-primary"
            : "border-border/60 bg-background/50 text-muted-foreground hover:border-primary/40 hover:bg-primary/[0.03]",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={onInputChange}
          aria-hidden
        />
        {isParsing ? (
          <>
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
            <span className="text-sm font-medium text-foreground">
              Parsing {fileName}…
            </span>
          </>
        ) : (
          <>
            <FileUp
              className={`size-6 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
              aria-hidden
            />
            <span className="text-sm font-medium text-foreground">
              {isDragging ? "Drop the file to import" : "Drag & drop your .xlsx here"}
            </span>
            <span className="text-xs text-muted-foreground">
              or{" "}
              <span className="font-medium text-primary underline-offset-2 hover:underline">
                browse files
              </span>
            </span>
          </>
        )}
      </div>

      {/* Error (hard parse failure) */}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-reject/30 bg-reject/10 p-3 text-sm text-reject-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* Preview — shown after a successful parse, before the trustee commits. */}
      {result && (
        <div className="mt-3 rounded-lg border border-border/60 bg-background p-4">
          {/* Summary line */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="size-4 text-allow-foreground" aria-hidden />
              <span className="text-sm font-semibold text-foreground">
                {result.positions.length} asset{result.positions.length === 1 ? "" : "s"} ready to import
              </span>
              {fileName && (
                <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                  <FileSpreadsheet className="size-3" aria-hidden />
                  {fileName.length > 28 ? fileName.slice(0, 25) + "…" : fileName}
                </Badge>
              )}
            </div>
            <button
              type="button"
              onClick={clearPreview}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss preview"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* Stat chips: skipped + warnings + errors */}
          <div className="mt-3 flex flex-wrap gap-2">
            <StatChip
              label="Parsed"
              value={result.positions.length}
              tone="ok"
            />
            <StatChip
              label="Skipped"
              value={result.skipped}
              tone={result.skipped > 0 ? "warn" : "neutral"}
            />
            <StatChip
              label="Warnings"
              value={warnings.length}
              tone={warnings.length > 0 ? "warn" : "neutral"}
            />
            <StatChip
              label="Errors"
              value={errors.length}
              tone={errors.length > 0 ? "error" : "neutral"}
            />
          </div>

          {/* Issues list — collapsible, max-height with scroll. */}
          {result.issues.length > 0 && (
            <details className="mt-3 group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                <Info className="size-3.5" aria-hidden />
                {result.issues.length} issue{result.issues.length === 1 ? "" : "s"} to review
                <span className="ml-auto text-[10px] group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/40 bg-muted/30 p-2 text-xs">
                {result.issues.map((iss, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 size-1.5 shrink-0 rounded-full ${
                        iss.severity === "error" ? "bg-reject-foreground" : "bg-warn-foreground"
                      }`}
                      aria-hidden
                    />
                    <span className="leading-relaxed">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        row {iss.rowNumber} · {iss.field}
                      </span>
                      <span className="ml-1 text-foreground/80">{iss.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Action buttons */}
          {result.positions.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
              <Button
                type="button"
                size="sm"
                onClick={() => applyImport("replace")}
              >
                <Replace className="size-3.5" aria-hidden />
                Replace all rows
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyImport("append")}
              >
                <Plus className="size-3.5" aria-hidden />
                Add to existing rows
              </Button>
              <span className="text-xs text-muted-foreground">
                You can still edit each row after importing.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatChip — a small pill showing a label + count with a tone.
// ---------------------------------------------------------------------------

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "error" | "neutral";
}) {
  const toneClasses: Record<typeof tone, string> = {
    ok: "border-allow/40 bg-allow/10 text-allow-foreground",
    warn: "border-warn/40 bg-warn/10 text-warn-foreground",
    error: "border-reject/40 bg-reject/10 text-reject-foreground",
    neutral: "border-border/40 bg-muted/40 text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${toneClasses[tone]}`}
    >
      <span className="font-serif font-bold house-num">{value}</span>
      <span className="uppercase tracking-widest text-[9px] opacity-80">{label}</span>
    </span>
  );
}

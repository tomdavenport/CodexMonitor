import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import type {
  FileDiffMetadata,
  Hunk,
  SelectedLineRange,
  AnnotationSide,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import type { DiffLineReference } from "../../../types";
import { workerFactory } from "../../../utils/diffsWorker";

type GitDiffViewerItem = {
  path: string;
  status: string;
  diff: string;
};

type GitDiffViewerProps = {
  diffs: GitDiffViewerItem[];
  selectedPath: string | null;
  isLoading: boolean;
  error: string | null;
  onLineReference?: (reference: DiffLineReference) => void;
  onActivePathChange?: (path: string) => void;
};

type SelectedRange = {
  path: string;
  start: number;
  end: number;
  anchor: number;
  side?: AnnotationSide;
  endSide?: AnnotationSide;
};

type LineMaps = {
  oldLines: Map<number, string>;
  newLines: Map<number, string>;
};

type ParsedDiffEntry = GitDiffViewerItem & {
  fileDiff: FileDiffMetadata | null;
  lineMaps: LineMaps | null;
};

const DIFF_SCROLL_CSS = `
[data-column-number],
[data-buffer],
[data-separator-wrapper],
[data-annotation-content] {
  position: static !important;
}

[data-buffer] {
  background-image: none !important;
}
`;

function normalizePatchName(name: string) {
  if (!name) {
    return name;
  }
  return name.replace(/^(?:a|b)\//, "");
}

function buildLineMaps(hunks: Hunk[]): LineMaps {
  const oldLines = new Map<number, string>();
  const newLines = new Map<number, string>();
  for (const hunk of hunks) {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (const line of content.lines) {
          oldLines.set(oldLine, line);
          newLines.set(newLine, line);
          oldLine += 1;
          newLine += 1;
        }
      } else {
        for (const line of content.deletions) {
          oldLines.set(oldLine, line);
          oldLine += 1;
        }
        for (const line of content.additions) {
          newLines.set(newLine, line);
          newLine += 1;
        }
      }
    }
  }
  return { oldLines, newLines };
}

function selectionTypeFromSide(side?: AnnotationSide, endSide?: AnnotationSide) {
  if (side && endSide && side !== endSide) {
    return "mixed";
  }
  if (side === "additions" || endSide === "additions") {
    return "add";
  }
  if (side === "deletions" || endSide === "deletions") {
    return "del";
  }
  return "context";
}

function collectSelectedLines(
  range: SelectedLineRange,
  lineMaps: LineMaps,
) {
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const useNew = range.side === "additions" || range.endSide === "additions";
  const useOld = range.side === "deletions" || range.endSide === "deletions";
  const lines: string[] = [];
  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    const line = useNew
      ? lineMaps.newLines.get(lineNumber)
      : useOld
        ? lineMaps.oldLines.get(lineNumber)
        : lineMaps.newLines.get(lineNumber) ?? lineMaps.oldLines.get(lineNumber);
    if (line !== undefined) {
      lines.push(line);
    }
  }
  return lines;
}

function selectionLineNumbers(range: SelectedLineRange) {
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  if (range.side === "deletions" || range.endSide === "deletions") {
    return { oldLine: start, endOldLine: end, newLine: null, endNewLine: null };
  }
  if (range.side === "additions" || range.endSide === "additions") {
    return { newLine: start, endNewLine: end, oldLine: null, endOldLine: null };
  }
  return { newLine: start, endNewLine: end, oldLine: null, endOldLine: null };
}

type DiffCardProps = {
  entry: ParsedDiffEntry;
  isSelected: boolean;
  selectedRange: SelectedRange | null;
  onLineSelectionEnd: (entry: ParsedDiffEntry, range: SelectedLineRange | null) => void;
};

const DiffCard = memo(function DiffCard({
  entry,
  isSelected,
  selectedRange,
  onLineSelectionEnd,
}: DiffCardProps) {
  const selectedLines = useMemo(
    () =>
      selectedRange
        ? {
            start: selectedRange.start,
            end: selectedRange.end,
            side: selectedRange.side,
            endSide: selectedRange.endSide,
          }
        : undefined,
    [selectedRange],
  );
  const diffOptions = useMemo(
    () => ({
      diffStyle: "split" as const,
      hunkSeparators: "line-info" as const,
      enableLineSelection: true,
      overflow: "scroll" as const,
      unsafeCSS: DIFF_SCROLL_CSS,
      onLineSelectionEnd: (range: SelectedLineRange | null) =>
        onLineSelectionEnd(entry, range),
      disableFileHeader: true,
    }),
    [entry, onLineSelectionEnd],
  );

  return (
    <div
      data-diff-path={entry.path}
      className={`diff-viewer-item ${isSelected ? "active" : ""}`}
    >
      <div className="diff-viewer-header">
        <span className="diff-viewer-status">{entry.status}</span>
        <span className="diff-viewer-path">{entry.path}</span>
      </div>
      {entry.diff.trim().length > 0 && entry.fileDiff ? (
        <div className="diff-viewer-output">
          <FileDiff
            fileDiff={entry.fileDiff}
            selectedLines={selectedLines}
            options={diffOptions}
            className="diff-viewer-diffs"
            style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
          />
        </div>
      ) : (
        <div className="diff-viewer-placeholder">Diff unavailable.</div>
      )}
    </div>
  );
});

export function GitDiffViewer({
  diffs,
  selectedPath,
  isLoading,
  error,
  onLineReference,
}: GitDiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null);
  const poolOptions = useMemo(() => ({ workerFactory }), []);
  const highlighterOptions = useMemo(
    () => ({ theme: { dark: "pierre-dark", light: "pierre-light" } }),
    [],
  );
  const parsedDiffs = useMemo<ParsedDiffEntry[]>(
    () =>
      diffs.map((entry) => {
        const patch = parsePatchFiles(entry.diff);
        const fileDiff = patch[0]?.files[0];
        if (!fileDiff) {
          return { ...entry, fileDiff: null, lineMaps: null };
        }
        const normalizedName = normalizePatchName(fileDiff.name || entry.path);
        const normalizedPrevName = fileDiff.prevName
          ? normalizePatchName(fileDiff.prevName)
          : undefined;
        const normalized: FileDiffMetadata = {
          ...fileDiff,
          name: normalizedName,
          prevName: normalizedPrevName,
        };
        return {
          ...entry,
          fileDiff: normalized,
          lineMaps: buildLineMaps(normalized.hunks),
        };
      }),
    [diffs],
  );

  useEffect(() => {
    if (!selectedRange) {
      return;
    }
    const stillExists = diffs.some((entry) => entry.path === selectedRange.path);
    if (!stillExists) {
      setSelectedRange(null);
    }
  }, [diffs, selectedRange]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let target: HTMLElement | null = null;
    const items = container.querySelectorAll<HTMLElement>("[data-diff-path]");
    for (const item of items) {
      if (item.dataset.diffPath === selectedPath) {
        target = item;
        break;
      }
    }
    if (!target) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const isVisible =
      targetRect.top >= containerRect.top &&
      targetRect.bottom <= containerRect.bottom;
    if (!isVisible) {
      target.scrollIntoView({ block: "start" });
    }
  }, [selectedPath, parsedDiffs]);

  const handleSelectionEnd = useCallback(
    (entry: ParsedDiffEntry, range: SelectedLineRange | null) => {
      if (!range || !entry.lineMaps) {
        return;
      }
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      setSelectedRange({
        path: entry.path,
        start,
        end,
        anchor: start,
        side: range.side,
        endSide: range.endSide,
      });
      const lines = collectSelectedLines(range, entry.lineMaps);
      if (!lines.length) {
        return;
      }
      const { oldLine, endOldLine, newLine, endNewLine } = selectionLineNumbers(range);
      onLineReference?.({
        path: entry.path,
        type: selectionTypeFromSide(range.side, range.endSide),
        oldLine,
        newLine,
        endOldLine,
        endNewLine,
        lines,
      });
    },
    [onLineReference],
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      <div className="diff-viewer" ref={containerRef}>
        {error && <div className="diff-viewer-empty">{error}</div>}
        {!error && isLoading && diffs.length > 0 && (
          <div className="diff-viewer-loading">Refreshing diff...</div>
        )}
        {!error && !isLoading && !diffs.length && (
          <div className="diff-viewer-empty">No changes detected.</div>
        )}
        {!error && parsedDiffs.length > 0 && (
          parsedDiffs.map((entry) => {
            const isSelected = entry.path === selectedPath;
            const selectedRangeForEntry =
              selectedRange?.path === entry.path ? selectedRange : null;
            return (
              <DiffCard
                key={entry.path}
                entry={entry}
                isSelected={isSelected}
                selectedRange={selectedRangeForEntry}
                onLineSelectionEnd={handleSelectionEnd}
              />
            );
          })
        )}
      </div>
    </WorkerPoolContextProvider>
  );
}

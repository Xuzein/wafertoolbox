import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarElement,
  Chart as ChartJS,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { Check, ChevronDown, Download } from "lucide-react";
import { useAppTitle } from "@/components/layout/app-title-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type HistogramSpec = {
  lower: number | null;
  upper: number | null;
};

type CpHistogramFilenameMeta = {
  cpStage: string;
  waferGroup: string;
};

type ParsedCpHistogramFile = {
  id: string;
  fileName: string;
  cpStage: string;
  waferGroup: string;
  waferId: string;
  yieldRate: number | null;
  totalPoints: number;
  testItems: string[];
  testData: Record<string, number[]>;
  specByItem: Record<string, HistogramSpec>;
};

type HistogramBin = {
  center: number;
  count: number;
  left: number;
  right: number;
};

type HistogramStats = {
  count: number;
  mean: number;
  standardDeviation: number;
};

type SpecInputs = {
  lower: string;
  upper: string;
};

type ParsedSpecInputs = {
  lower: number | null;
  upper: number | null;
  hasAny: boolean;
  isValid: boolean;
};

type FutureYield = {
  passed: number;
  total: number;
  rate: number;
};

type SpecLineSide = "lower" | "upper";

type SpecOverlayLayout = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type SpecLinePluginOptions = {
  lower?: number | null;
  upper?: number | null;
  csvLower: number | null;
  csvUpper: number | null;
  newLower: number | null;
  newUpper: number | null;
  draggable?: boolean;
  onDragSpec?: (side: SpecLineSide, value: number) => void;
};

type CpHistogramViewCache = {
  files: ParsedCpHistogramFile[];
  selectedTestItem: string;
  selectedCpStages: string[];
  selectedWaferGroups: string[];
  filterLower: string;
  filterUpper: string;
  hideCsvSpecLines: boolean;
  specOverrideMap: Record<string, SpecInputs>;
  localSpecDraftMap: Record<string, SpecInputs>;
  notice: string;
  error: string;
};

const defaultCpHistogramViewCache: CpHistogramViewCache = {
  files: [],
  selectedTestItem: "",
  selectedCpStages: [],
  selectedWaferGroups: [],
  filterLower: "",
  filterUpper: "",
  hideCsvSpecLines: false,
  specOverrideMap: {},
  localSpecDraftMap: {},
  notice: "",
  error: "",
};

let cpHistogramViewCache: CpHistogramViewCache = defaultCpHistogramViewCache;

const HEADER_ROW_INDEX = 22;
const UPPER_LIMIT_ROW_INDEX = 28;
const LOWER_LIMIT_ROW_INDEX = 29;
const DATA_START_ROW_INDEX = 33;

const BASE_COLUMNS = new Set(
  [
    "NO.",
    "NO",
    "TITLE",
    "DUT",
    "DIE_X",
    "DIE_Y",
    "PASS/FAIL",
    "PASS_FAIL",
    "PASS",
    "FAIL",
    "SBIN",
    "HBIN",
    "LOT_ID",
    "WAFER_ID",
    "WAFER",
    "INDEXTIME",
    "INDEX_TIME",
    "TESTTIME",
    "TEST_TIME",
  ].map((item) => item.toUpperCase()),
);

const CHART_BLUE = {
  from: "rgba(37, 99, 235, 0.88)",
  to: "rgba(56, 189, 248, 0.85)",
  border: "rgba(37, 99, 235, 0.96)",
  line: "rgba(29, 78, 216, 0.95)",
  softFill: "rgba(37, 99, 235, 0.10)",
} as const;

const SPEC_RED = {
  fillSoft: "rgba(220, 38, 38, 0.12)",
  chipBorder: "border-destructive/45",
  chipBg: "bg-destructive/10",
  chipText: "text-destructive",
} as const;

const HISTOGRAM_PALETTES = [{ from: CHART_BLUE.from, to: CHART_BLUE.to, border: CHART_BLUE.border }] as const;

const SPEC_LINE_MIN_GAP = 1e-9;

const SPEC_LINE_PLUGIN: Plugin<"bar", SpecLinePluginOptions> = {
  id: "cpHistogramSpecLines",
  defaults: {
    lower: null,
    upper: null,
    csvLower: null,
    csvUpper: null,
    newLower: null,
    newUpper: null,
    draggable: false,
  },
  afterDraw: (chart, _args, options) => {
    if (!options) {
      return;
    }
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) {
      return;
    }

    const ctx = chart.ctx;
    const { left, right, top, bottom } = chart.chartArea;
    const csvLower = options.csvLower ?? options.lower ?? null;
    const csvUpper = options.csvUpper ?? options.upper ?? null;

    const drawLine = (
      value: number | null,
      color: string,
      label: string,
      lineDash: number[],
      lineWidth: number,
      draggable: boolean,
      labelOffset: number,
      highlightLabel: boolean,
    ) => {
      if (value === null || !Number.isFinite(value)) {
        return;
      }

      const x = xScale.getPixelForValue(value);
      if (!Number.isFinite(x) || x < left || x > right) {
        return;
      }

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash(lineDash);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = highlightLabel ? "700 11px sans-serif" : "600 10px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const labelText = `${label}: ${value.toFixed(2)}`;

      if (highlightLabel) {
        const textWidth = ctx.measureText(labelText).width;
        const labelPaddingX = 7;
        const labelHeight = 18;
        const labelBoxWidth = textWidth + labelPaddingX * 2;
        const textX = Math.min(
          Math.max(x - labelBoxWidth / 2 + labelPaddingX, left + labelPaddingX + 2),
          right - labelBoxWidth + labelPaddingX - 2,
        );
        const boxX = textX - labelPaddingX;
        const boxY = Math.max(6, top - labelOffset);

        ctx.fillStyle = "rgba(255,255,255,0.98)";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.fillRect(boxX, boxY, labelBoxWidth, labelHeight);
        ctx.strokeRect(boxX, boxY, labelBoxWidth, labelHeight);
        ctx.fillStyle = color;
        ctx.fillText(labelText, textX, boxY + labelHeight / 2);
      } else {
        const textX = Math.min(x + 4, right - 86);
        const textY = top + labelOffset;
        ctx.fillText(`${label}: ${value.toFixed(2)}`, textX, textY);
      }

      if (draggable) {
        ctx.beginPath();
        ctx.arc(x, top + 10, 5, 0, Math.PI * 2);
        ctx.arc(x, bottom - 10, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    drawLine(csvLower, CHART_BLUE.line, "CSV LSL", [4, 4], 1.2, false, 12, false);
    drawLine(csvUpper, CHART_BLUE.line, "CSV USL", [4, 4], 1.2, false, 26, false);
  },
  afterEvent: (chart, args, options) => {
    chart.canvas.style.cursor = options?.draggable ? "default" : "";
    args.changed = false;
  },
};

ChartJS.register(BarElement, LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, SPEC_LINE_PLUGIN);

const fmt = (value: number, digits = 2) => value.toFixed(digits);

const emptySpecInputs = (): SpecInputs => ({ lower: "", upper: "" });

const formatSpecInputValue = (value: number) => value.toFixed(2);

const parseSpecInputs = (inputs: SpecInputs): ParsedSpecInputs => {
  const lowerText = inputs.lower.trim();
  const upperText = inputs.upper.trim();
  const lower = lowerText === "" ? null : toNumber(lowerText);
  const upper = upperText === "" ? null : toNumber(upperText);
  const hasAny = lowerText !== "" || upperText !== "";
  const hasInvalidNumber = (lowerText !== "" && lower === null) || (upperText !== "" && upper === null);
  const hasInvalidRange = lower !== null && upper !== null && lower > upper;

  return {
    lower,
    upper,
    hasAny,
    isValid: !hasInvalidNumber && !hasInvalidRange,
  };
};

const getDrawableSpec = (inputs: SpecInputs): HistogramSpec => {
  const parsed = parseSpecInputs(inputs);
  if (!parsed.hasAny || !parsed.isValid) {
    return { lower: null, upper: null };
  }
  return { lower: parsed.lower, upper: parsed.upper };
};

const calcFutureYield = (values: number[], spec: ParsedSpecInputs): FutureYield | null => {
  if (!spec.hasAny || !spec.isValid || values.length === 0) {
    return null;
  }

  const passed = values.filter((value) => {
    if (spec.lower !== null && value < spec.lower) {
      return false;
    }
    if (spec.upper !== null && value > spec.upper) {
      return false;
    }
    return true;
  }).length;

  return {
    passed,
    total: values.length,
    rate: (passed / values.length) * 100,
  };
};

const formatFutureYieldRate = (futureYield: FutureYield | null) => {
  if (!futureYield) {
    return "-";
  }
  return `${futureYield.rate.toFixed(2)}%`;
};

const formatFutureYieldPoints = (futureYield: FutureYield | null) => {
  if (!futureYield) {
    return "-";
  }
  return `${futureYield.passed}/${futureYield.total}`;
};

const SpecValueChip: React.FC<{
  label: string;
  value: number | null;
  variant?: "default" | "new";
}> = ({ label, value, variant = "default" }) => {
  const isNew = variant === "new";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        isNew
          ? `${SPEC_RED.chipBorder} border-dashed ${SPEC_RED.chipBg} ${SPEC_RED.chipText}`
          : "border-primary/20 bg-primary/5 text-primary",
      )}
    >
      <span>{label}</span>
      <span className={cn("font-semibold", isNew ? SPEC_RED.chipText : "text-primary")}>
        {value === null ? "-" : fmt(value, 2)}
      </span>
    </span>
  );
};

const SpecAnnotationStrip: React.FC<{
  csvSpec: HistogramSpec;
  newSpec: HistogramSpec;
  invalidNewSpec?: boolean;
}> = ({ csvSpec, newSpec, invalidNewSpec = false }) => {
  const hasNewSpec =
    (newSpec.lower !== null && Number.isFinite(newSpec.lower)) || (newSpec.upper !== null && Number.isFinite(newSpec.upper));

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <SpecValueChip label="CSV LSL" value={csvSpec.lower} />
      <SpecValueChip label="CSV USL" value={csvSpec.upper} />
      <SpecValueChip label="New LSL" value={newSpec.lower} variant="new" />
      <SpecValueChip label="New USL" value={newSpec.upper} variant="new" />
      {invalidNewSpec && (
        <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
          New Spec 无效，未绘制新 spec 虚线
        </span>
      )}
      {!hasNewSpec && !invalidNewSpec && (
        <span className="inline-flex items-center rounded-full border border-input bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
          未设置 New Spec
        </span>
      )}
    </div>
  );
};

const areSpecOverlayLayoutsEqual = (a: SpecOverlayLayout | null, b: SpecOverlayLayout | null) => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.top === b.top &&
    a.bottom === b.bottom
  );
};

const getSpecOverlayLayout = (chart: ChartJS<"bar"> | null): SpecOverlayLayout | null => {
  if (!chart?.chartArea) {
    return null;
  }

  return {
    left: chart.chartArea.left,
    right: chart.chartArea.right,
    top: chart.chartArea.top,
    bottom: chart.chartArea.bottom,
  };
};

const clampToRange = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const DraggableSpecOverlay: React.FC<{
  chartRef: React.RefObject<ChartJS<"bar"> | null>;
  spec: HistogramSpec;
  onSpecChange: (side: SpecLineSide, value: number) => void;
}> = ({ chartRef, spec, onSpecChange }) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<SpecOverlayLayout | null>(null);
  const [activeSide, setActiveSide] = useState<SpecLineSide | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const nextLayout = getSpecOverlayLayout(chartRef.current);
      setLayout((prev) => (areSpecOverlayLayoutsEqual(prev, nextLayout) ? prev : nextLayout));
    });
    return () => window.cancelAnimationFrame(frameId);
  });

  useEffect(() => {
    const canvas = chartRef.current?.canvas;
    if (!canvas || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      const nextLayout = getSpecOverlayLayout(chartRef.current);
      setLayout((prev) => (areSpecOverlayLayoutsEqual(prev, nextLayout) ? prev : nextLayout));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [chartRef]);

  useEffect(() => {
    if (!activeSide) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const chart = chartRef.current;
      const overlayEl = overlayRef.current;
      const xScale = chart?.scales.x;
      if (!chart || !overlayEl || !layout || !xScale) {
        return;
      }

      const rect = overlayEl.getBoundingClientRect();
      const rawPixelX = event.clientX - rect.left;
      const clampedPixelX = Math.max(layout.left, Math.min(layout.right, rawPixelX));
      let nextValue = Number(xScale.getValueForPixel(clampedPixelX));
      if (!Number.isFinite(nextValue)) {
        return;
      }

      if (activeSide === "lower" && spec.upper !== null && Number.isFinite(spec.upper)) {
        nextValue = Math.min(nextValue, spec.upper - SPEC_LINE_MIN_GAP);
      }
      if (activeSide === "upper" && spec.lower !== null && Number.isFinite(spec.lower)) {
        nextValue = Math.max(nextValue, spec.lower + SPEC_LINE_MIN_GAP);
      }

      onSpecChange(activeSide, nextValue);
      event.preventDefault();
    };

    const handlePointerUp = () => {
      setActiveSide(null);
      document.body.style.cursor = "";
    };

    document.body.style.cursor = "ew-resize";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeSide, chartRef, layout, onSpecChange, spec.lower, spec.upper]);

  const chart = chartRef.current;
  const xScale = chart?.scales.x;
  const lineHeight = layout ? layout.bottom - layout.top : 0;

  const lowerXRaw =
    layout && xScale && spec.lower !== null && Number.isFinite(spec.lower)
      ? xScale.getPixelForValue(spec.lower)
      : null;
  const upperXRaw =
    layout && xScale && spec.upper !== null && Number.isFinite(spec.upper)
      ? xScale.getPixelForValue(spec.upper)
      : null;
  const lowerX = lowerXRaw === null || !layout ? null : clampToRange(lowerXRaw, layout.left, layout.right);
  const upperX = upperXRaw === null || !layout ? null : clampToRange(upperXRaw, layout.left, layout.right);

  if (!layout || !xScale || lineHeight <= 0 || (lowerX === null && upperX === null)) {
    return null;
  }

  const renderLineHandle = (side: SpecLineSide, x: number, value: number) => {
    const label = side === "lower" ? "New LSL" : "New USL";

    return (
      <div key={side}>
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2"
          style={{ left: x, top: Math.max(0, layout.top - 34) }}
        >
          <span className="inline-flex items-center rounded-md border border-destructive/40 bg-background/95 px-2 py-1 text-[11px] font-semibold text-destructive shadow-sm">
            {label}: {fmt(value, 2)}
          </span>
        </div>

        <button
          type="button"
          className="pointer-events-auto absolute z-20 touch-none cursor-ew-resize border-0 bg-transparent p-0 outline-none"
          style={{
            left: x,
            top: layout.top,
            height: lineHeight,
            width: 32,
            transform: "translateX(-50%)",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setActiveSide(side);
          }}
          aria-label={`拖动 ${label}`}
        >
          <span className="pointer-events-none absolute left-1/2 top-0 h-full -translate-x-1/2 border-l-[3px] border-dashed border-destructive" />
          <span className="pointer-events-none absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-destructive bg-background shadow-sm" />
          <span className="pointer-events-none absolute left-1/2 bottom-0 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-destructive bg-background shadow-sm" />
        </button>
      </div>
    );
  };

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-2 z-10">
      {lowerX !== null && upperX !== null && (
        <div
          className="absolute"
          style={{
            left: Math.min(lowerX, upperX),
            top: layout.top,
            width: Math.abs(upperX - lowerX),
            height: lineHeight,
            backgroundColor: SPEC_RED.fillSoft,
          }}
        />
      )}
      {lowerX !== null && spec.lower !== null && renderLineHandle("lower", lowerX, spec.lower)}
      {upperX !== null && spec.upper !== null && renderLineHandle("upper", upperX, spec.upper)}
    </div>
  );
};

const getLocalSpecKey = (fileId: string, testItem: string) => `${fileId}::${testItem}`;

const parseCpHistogramFilenameMeta = (fileName: string): CpHistogramFilenameMeta | null => {
  const baseName = fileName.replace(/\.[^.]+$/i, "");
  const parts = baseName.split("_").map((part) => part.trim());
  const cpStage = parts.find((part) => /^CP\d+$/i.test(part));
  const lotSegment = parts[1];
  const waferSegment = parts[2];

  if (!cpStage || !lotSegment || !waferSegment) {
    return null;
  }

  return {
    cpStage: cpStage.toUpperCase(),
    waferGroup: `${lotSegment}_${waferSegment}`,
  };
};

const sortCpStages = (a: string, b: string) => {
  const aNumber = Number(a.match(/^CP(\d+)$/i)?.[1]);
  const bNumber = Number(b.match(/^CP(\d+)$/i)?.[1]);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return a.localeCompare(b);
};

const naturalSorter = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const getWaferSortNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const separatedTailNumber = trimmed.match(/(?:^|[_\-\s])0*(\d+)\s*$/);
  const fallbackTailNumber = trimmed.match(/(\d+)\D*$/);
  const matchedNumber = separatedTailNumber?.[1] ?? fallbackTailNumber?.[1];
  if (!matchedNumber) {
    return null;
  }

  const parsed = Number(matchedNumber);
  return Number.isFinite(parsed) ? parsed : null;
};

const sortWaferLabels = (a: string, b: string) => {
  const aWaferNumber = getWaferSortNumber(a);
  const bWaferNumber = getWaferSortNumber(b);

  if (aWaferNumber !== null && bWaferNumber !== null && aWaferNumber !== bWaferNumber) {
    return aWaferNumber - bWaferNumber;
  }
  if (aWaferNumber !== null && bWaferNumber === null) {
    return -1;
  }
  if (aWaferNumber === null && bWaferNumber !== null) {
    return 1;
  }
  return naturalSorter.compare(a, b);
};

const sortCpHistogramFiles = (inputFiles: ParsedCpHistogramFile[]) => {
  return [...inputFiles].sort((a, b) => {
    const waferGroupOrder = sortWaferLabels(a.waferGroup, b.waferGroup);
    if (waferGroupOrder !== 0) {
      return waferGroupOrder;
    }

    const waferIdOrder = sortWaferLabels(a.waferId, b.waferId);
    if (waferIdOrder !== 0) {
      return waferIdOrder;
    }

    const cpStageOrder = sortCpStages(a.cpStage, b.cpStage);
    if (cpStageOrder !== 0) {
      return cpStageOrder;
    }

    return naturalSorter.compare(a.fileName, b.fileName);
  });
};

const getCpStageOptions = (files: ParsedCpHistogramFile[]) => {
  return Array.from(new Set(files.map((file) => file.cpStage))).sort(sortCpStages);
};

const getWaferGroupOptions = (files: ParsedCpHistogramFile[], cpStages: string[]) => {
  const selectedStages = new Set(cpStages);
  return Array.from(
    new Set(files.filter((file) => selectedStages.has(file.cpStage)).map((file) => file.waferGroup)),
  ).sort(sortWaferLabels);
};

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
};

const parseCsvText = (text: string): string[][] => {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => parseCsvLine(line));
};

const toNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const toPercentNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/%/g, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const normalizeSpecValue = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  // Common sentinel values in summary CSV for "no spec"
  if (Math.abs(value) >= 9000 || Math.abs(value) < 1e-12) {
    return null;
  }
  return value;
};

const normalizeHeader = (value: string): string => value.trim().replace(/\s+/g, "_").toUpperCase();

const findTotalPoints = (rows: string[][]): number | null => {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, DATA_START_ROW_INDEX); rowIndex += 1) {
    const row = rows[rowIndex];
    for (let col = 0; col < row.length; col += 1) {
      if (normalizeHeader(row[col] ?? "") !== "TOTAL") {
        continue;
      }
      for (let offset = 1; offset <= 3; offset += 1) {
        const parsed = toNumber(row[col + offset]);
        if (parsed !== null) {
          return Math.max(0, Math.round(parsed));
        }
      }
    }
  }
  return null;
};

const getWaferId = (headerRow: string[], rows: string[][], fileName: string): string => {
  const headerMap = new Map<string, number>();
  headerRow.forEach((header, index) => {
    headerMap.set(normalizeHeader(header), index);
  });

  const dataRows = rows.slice(DATA_START_ROW_INDEX).filter((row) => row.some((cell) => cell.trim() !== ""));
  const firstData = dataRows[0] ?? [];
  const waferIndex = headerMap.get("WAFER_ID") ?? headerMap.get("WAFER");
  if (waferIndex !== undefined) {
    const wafer = (firstData[waferIndex] ?? "").trim();
    if (wafer) {
      return wafer;
    }
  }

  const fileMatch = fileName.match(/_(E\d{6}(?:[-_]\d+)?)_/i);
  if (fileMatch?.[1]) {
    return fileMatch[1].replace(/_/g, "-");
  }

  return fileName.replace(/\.csv$/i, "");
};

const getTestColumns = (headerRow: string[]): Array<{ index: number; name: string }> => {
  const counts = new Map<string, number>();
  const columns: Array<{ index: number; name: string }> = [];

  headerRow.forEach((header, index) => {
    const name = header.trim();
    if (!name) {
      return;
    }
    const normalized = normalizeHeader(name);
    if (BASE_COLUMNS.has(normalized)) {
      return;
    }

    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    const uniqueName = count > 1 ? `${name} (${count})` : name;
    columns.push({ index, name: uniqueName });
  });

  return columns;
};

const parseCpHistogramFile = async (
  file: File,
  filenameMeta: CpHistogramFilenameMeta,
): Promise<ParsedCpHistogramFile> => {
  const text = await file.text();
  const rows = parseCsvText(text);

  if (rows.length <= DATA_START_ROW_INDEX) {
    throw new Error(`${file.name} 行数不足，无法解析（需要第 23 行表头与第 34 行数据）`);
  }

  const headerRow = rows[HEADER_ROW_INDEX] ?? [];
  const upperRow = rows[UPPER_LIMIT_ROW_INDEX] ?? [];
  const lowerRow = rows[LOWER_LIMIT_ROW_INDEX] ?? [];

  const testColumns = getTestColumns(headerRow);
  if (testColumns.length === 0) {
    throw new Error(`${file.name} 在第 23 行未识别到测试项`);
  }

  const dataRows = rows.slice(DATA_START_ROW_INDEX).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (dataRows.length === 0) {
    throw new Error(`${file.name} 第 34 行后没有数据`);
  }

  const testData: Record<string, number[]> = {};
  const specByItem: Record<string, HistogramSpec> = {};

  testColumns.forEach((column) => {
    testData[column.name] = [];
    specByItem[column.name] = {
      upper: normalizeSpecValue(toNumber(upperRow[column.index])),
      lower: normalizeSpecValue(toNumber(lowerRow[column.index])),
    };
  });

  dataRows.forEach((row) => {
    testColumns.forEach((column) => {
      const value = toNumber(row[column.index]);
      if (value !== null) {
        testData[column.name].push(value);
      }
    });
  });

  const testItems = testColumns
    .map((column) => column.name)
    .filter((name) => testData[name].length > 0);

  if (testItems.length === 0) {
    throw new Error(`${file.name} 测试项没有可用数值`);
  }

  return {
    id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: file.name,
    cpStage: filenameMeta.cpStage,
    waferGroup: filenameMeta.waferGroup,
    waferId: getWaferId(headerRow, rows, file.name),
    // D19 (1-based) -> rows[18][3]
    yieldRate: toPercentNumber(rows[18]?.[3]),
    totalPoints: findTotalPoints(rows) ?? dataRows.length,
    testItems,
    testData,
    specByItem,
  };
};

const calcStats = (values: number[]): HistogramStats => {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      standardDeviation: 0,
    };
  }

  const count = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const standardDeviation = Math.sqrt(variance);

  return {
    count,
    mean,
    standardDeviation,
  };
};

const buildHistogram = (values: number[]): HistogramBin[] => {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ center: min, count: values.length, left: min - 0.5, right: max + 0.5 }];
  }

  const binCount = Math.max(8, Math.min(48, Math.round(Math.sqrt(values.length) * 1.25)));
  const width = (max - min) / binCount;
  const counts = new Array(binCount).fill(0);

  values.forEach((value) => {
    const index = value === max ? binCount - 1 : Math.floor((value - min) / width);
    counts[Math.max(0, Math.min(binCount - 1, index))] += 1;
  });

  return counts.map((count, index) => {
    const left = min + index * width;
    const right = left + width;
    return {
      count,
      left,
      right,
      center: left + width / 2,
    };
  });
};

const buildTrendPoints = (bins: HistogramBin[]) => {
  if (bins.length === 0) {
    return [] as Array<{ x: number; y: number }>;
  }
  const windowRadius = 2;
  return bins.map((bin, index) => {
    const start = Math.max(0, index - windowRadius);
    const end = Math.min(bins.length - 1, index + windowRadius);
    const count = end - start + 1;
    const avg =
      bins.slice(start, end + 1).reduce((sum, item) => sum + item.count, 0) / count;
    return {
      x: bin.center,
      y: avg,
    };
  });
};

const exportChartCanvasAsPng = (canvas: HTMLCanvasElement, fileName: string) => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  // Avoid transparent PNG looking black in some Windows viewers.
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = fileName;
  link.click();
};

type MultiSelectFilterProps = {
  label: string;
  options: string[];
  selectedValues: string[];
  placeholder: string;
  emptyText: string;
  summaryMode?: "values" | "count";
  countUnit?: string;
  disabled?: boolean;
  onChange: (values: string[]) => void;
};

const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({
  label,
  options,
  selectedValues,
  placeholder,
  emptyText,
  summaryMode = "values",
  countUnit = "项",
  disabled = false,
  onChange,
}) => {
  const selectedSet = new Set(selectedValues);
  const selectedOptions = options.filter((option) => selectedSet.has(option));
  const triggerText =
    selectedOptions.length === 0
      ? placeholder
      : summaryMode === "count"
        ? `已选 ${selectedOptions.length} ${countUnit}`
        : selectedOptions.join(", ");

  const toggleOption = (option: string, checked: boolean) => {
    const nextSet = new Set(selectedOptions);
    if (checked) {
      nextSet.add(option);
    } else {
      nextSet.delete(option);
    }
    onChange(options.filter((item) => nextSet.has(item)));
  };

  return (
    <div className="min-w-[220px] flex-1">
      <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground">{label}</div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-11 w-full justify-between rounded-xl border-input bg-background px-3 text-left text-sm font-normal shadow-sm transition hover:bg-muted/40",
              selectedOptions.length === 0 && "text-muted-foreground",
            )}
            disabled={disabled || options.length === 0}
          >
            <span className="truncate">{triggerText}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 rounded-2xl border-input p-2 shadow-lg">
          {options.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">{emptyText}</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/45 px-2 py-2">
                <span className="text-xs text-muted-foreground">
                  已选 {selectedOptions.length}/{options.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs" onClick={() => onChange(options)}>
                    全选
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs" onClick={() => onChange([])}>
                    清空
                  </Button>
                </div>
              </div>
              <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
                {options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                      selectedSet.has(option)
                        ? "border-chart-2/35 bg-chart-2/12 text-foreground shadow-sm"
                        : "border-transparent bg-background hover:border-input hover:bg-muted/45",
                    )}
                    onClick={() => toggleOption(option, !selectedSet.has(option))}
                  >
                    <span className="truncate">{option}</span>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
                        selectedSet.has(option)
                          ? "border-chart-2 bg-chart-2 text-white"
                          : "border-input bg-background text-transparent",
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};

const HistogramCard: React.FC<{
  file: ParsedCpHistogramFile;
  testItem: string;
  values: number[];
  globalNewSpec: SpecInputs;
  localNewSpec: SpecInputs | null;
  hideCsvSpecLines: boolean;
  paletteIndex: number;
  onLocalNewSpecChange: (nextSpec: SpecInputs) => void;
  onApplyLocalSpecAsGlobal: () => void;
}> = ({
  file,
  testItem,
  values,
  globalNewSpec,
  localNewSpec,
  hideCsvSpecLines,
  paletteIndex,
  onLocalNewSpecChange,
  onApplyLocalSpecAsGlobal,
}) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartJS<"bar"> | null>(null);
  const histogram = useMemo(() => buildHistogram(values), [values]);
  const stats = useMemo(() => calcStats(values), [values]);
  const fileSpec = file.specByItem[testItem] ?? { lower: null, upper: null };
  const activeNewSpecInputs = localNewSpec ?? globalNewSpec;
  const activeNewSpec = parseSpecInputs(activeNewSpecInputs);
  const drawableNewSpec = getDrawableSpec(activeNewSpecInputs);
  const futureYield = calcFutureYield(values, activeNewSpec);
  const hasLocalSpec = localNewSpec !== null;
  const palette = HISTOGRAM_PALETTES[paletteIndex % HISTOGRAM_PALETTES.length];

  const xMin = values.length > 0 ? Math.min(...values) : null;
  const xMax = values.length > 0 ? Math.max(...values) : null;
  const hasCsvSpecLine = (fileSpec.lower !== null && Number.isFinite(fileSpec.lower)) || (fileSpec.upper !== null && Number.isFinite(fileSpec.upper));
  const xDomain = useMemo(() => {
    if (values.length === 0) {
      return { min: undefined, max: undefined } as { min: number | undefined; max: number | undefined };
    }
    const nums = [...values];
    if (!hideCsvSpecLines && fileSpec.lower !== null && Number.isFinite(fileSpec.lower)) {
      nums.push(fileSpec.lower);
    }
    if (!hideCsvSpecLines && fileSpec.upper !== null && Number.isFinite(fileSpec.upper)) {
      nums.push(fileSpec.upper);
    }
    if (drawableNewSpec.lower !== null && Number.isFinite(drawableNewSpec.lower)) {
      nums.push(drawableNewSpec.lower);
    }
    if (drawableNewSpec.upper !== null && Number.isFinite(drawableNewSpec.upper)) {
      nums.push(drawableNewSpec.upper);
    }
    return {
      min: Math.min(...nums),
      max: Math.max(...nums),
    };
  }, [drawableNewSpec.lower, drawableNewSpec.upper, fileSpec.lower, fileSpec.upper, hideCsvSpecLines, values]);

  const chartData = useMemo(
    () => {
      const datasets = [
        {
          label: "数量",
          data: histogram.map((bin) => ({ x: bin.center, y: bin.count, left: bin.left, right: bin.right })),
          backgroundColor: (context: { chart: ChartJS<"bar"> }) => {
            const chart = context.chart;
            const { chartArea, ctx } = chart;
            if (!chartArea) {
              return palette.from;
            }
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, palette.from);
            gradient.addColorStop(1, palette.to);
            return gradient;
          },
          borderColor: palette.border,
          borderWidth: 1,
          hoverBackgroundColor: palette.border,
          borderRadius: 2,
          categoryPercentage: 1,
          barPercentage: 1,
        },
      ];

      return { datasets };
    },
    [histogram, palette.border, palette.from, palette.to],
  );

  const chartOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      animation: {
        duration: 220,
        easing: "easeOutQuart",
      },
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      layout: {
        padding: {
          top: 44,
        },
      },
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      events: ["mousedown", "mouseup", "mousemove", "mouseout", "click", "touchstart", "touchmove"],
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          titleColor: "#fff",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148, 163, 184, 0.35)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (context) => {
              const raw = context.raw as { left?: number; right?: number };
              const rangeText =
                raw && Number.isFinite(raw.left) && Number.isFinite(raw.right)
                  ? `区间: ${fmt(raw.left as number, 2)} ~ ${fmt(raw.right as number, 2)}`
                  : "";
              return [`数量: ${context.parsed.y}`, rangeText].filter(Boolean);
            },
            title: (items) => {
              const center = items[0]?.parsed.x;
              return Number.isFinite(center) ? `X: ${fmt(center, 2)}` : "";
            },
          },
        },
        cpHistogramSpecLines: {
          lower: hideCsvSpecLines ? null : fileSpec.lower,
          upper: hideCsvSpecLines ? null : fileSpec.upper,
          csvLower: hideCsvSpecLines ? null : fileSpec.lower,
          csvUpper: hideCsvSpecLines ? null : fileSpec.upper,
          newLower: drawableNewSpec.lower,
          newUpper: drawableNewSpec.upper,
          draggable: false,
        },
      },
      scales: {
        x: {
          type: "linear",
          min: xDomain.min,
          max: xDomain.max,
          title: {
            display: true,
            text: "测试值",
          },
          grid: {
            color: "rgba(148,163,184,0.14)",
          },
          ticks: {
            callback: (value) => {
              const parsed = Number(value);
              if (!Number.isFinite(parsed)) {
                return "";
              }
              return parsed.toFixed(2);
            },
          },
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "数量",
          },
          grid: {
            color: "rgba(148,163,184,0.14)",
          },
          ticks: {
            precision: 0,
          },
        },
      },
    }),
    [
      drawableNewSpec.lower,
      drawableNewSpec.upper,
      fileSpec.lower,
      fileSpec.upper,
      hideCsvSpecLines,
      xDomain.max,
      xDomain.min,
    ],
  );

  return (
    <div className="app-surface p-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="group mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{file.waferId}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {file.cpStage} · {file.waferGroup}
          </p>
          <p className="mt-1 max-w-[420px] truncate text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            {file.fileName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasLocalSpec && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-md border-primary/30 px-2 text-[11px] text-primary hover:bg-primary/10 hover:text-primary"
              onClick={onApplyLocalSpecAsGlobal}
            >
              应用为全局 spec
            </Button>
          )}
          <span className="rounded-md border border-input bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
            {testItem}
          </span>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-7 w-7 border-input bg-background/85 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              const canvas = chartContainerRef.current?.querySelector("canvas");
              if (!canvas) {
                return;
              }
              const safeWafer = file.waferId.replace(/[^\w.-]+/g, "_");
              const safeItem = testItem.replace(/[^\w.-]+/g, "_");
              exportChartCanvasAsPng(canvas, `${safeWafer}_${safeItem}_histogram.png`);
            }}
            title="下载图表"
            aria-label="下载图表"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">测量点数</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{file.totalPoints}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">良率</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">
            {file.yieldRate === null ? "-" : `${file.yieldRate.toFixed(2)}%`}
          </div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">数量</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{stats.count}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">平均数</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{fmt(stats.mean, 2)}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">标准差</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{fmt(stats.standardDeviation, 2)}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">未来良率</div>
          <div className="mt-0.5 font-semibold text-foreground">{formatFutureYieldRate(futureYield)}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-foreground">{formatFutureYieldPoints(futureYield)}</div>
        </div>
      </div>

      <SpecAnnotationStrip
        csvSpec={fileSpec}
        newSpec={drawableNewSpec}
        invalidNewSpec={activeNewSpec.hasAny && !activeNewSpec.isValid}
      />

      <div
        ref={chartContainerRef}
        className="relative h-[260px] rounded-lg border border-input bg-gradient-to-b from-background to-muted/35 p-2"
      >
        {values.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前范围内无数据</div>
        ) : (
          <>
            <Bar ref={chartRef} data={chartData} options={chartOptions} />
            <DraggableSpecOverlay
              chartRef={chartRef}
              spec={drawableNewSpec}
              onSpecChange={(side, value) => {
                onLocalNewSpecChange({
                  ...activeNewSpecInputs,
                  [side]: formatSpecInputValue(value),
                });
              }}
            />
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>x-min: {xMin === null ? "-" : fmt(xMin, 2)}</span>
        <span>x-max: {xMax === null ? "-" : fmt(xMax, 2)}</span>
        <span>CSV LSL: {fileSpec.lower === null ? "-" : fmt(fileSpec.lower, 2)}</span>
        <span>CSV USL: {fileSpec.upper === null ? "-" : fmt(fileSpec.upper, 2)}</span>
        <span>New LSL: {drawableNewSpec.lower === null ? "-" : fmt(drawableNewSpec.lower, 2)}</span>
        <span>New USL: {drawableNewSpec.upper === null ? "-" : fmt(drawableNewSpec.upper, 2)}</span>
        {!hasCsvSpecLine && <span className="text-amber-700">该测试项缺少 CSV spec，未绘制 spec 线</span>}
      </div>
    </div>
  );
};

const BatchHistogramCard: React.FC<{
  testItem: string;
  values: number[];
  csvSpecLower: number | null;
  csvSpecUpper: number | null;
  globalNewSpec: SpecInputs;
  hideCsvSpecLines: boolean;
  waferCount: number;
  onGlobalNewSpecChange: (nextSpec: SpecInputs) => void;
}> = ({ testItem, values, csvSpecLower, csvSpecUpper, globalNewSpec, hideCsvSpecLines, waferCount, onGlobalNewSpecChange }) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartJS<"bar"> | null>(null);
  const histogram = useMemo(() => buildHistogram(values), [values]);
  const trendPoints = useMemo(() => buildTrendPoints(histogram), [histogram]);
  const stats = useMemo(() => calcStats(values), [values]);
  const parsedGlobalNewSpec = parseSpecInputs(globalNewSpec);
  const drawableGlobalNewSpec = getDrawableSpec(globalNewSpec);
  const futureYield = calcFutureYield(values, parsedGlobalNewSpec);

  const xMin = values.length > 0 ? Math.min(...values) : null;
  const xMax = values.length > 0 ? Math.max(...values) : null;
  const hasCsvSpecLine =
    (csvSpecLower !== null && Number.isFinite(csvSpecLower)) || (csvSpecUpper !== null && Number.isFinite(csvSpecUpper));
  const palette = HISTOGRAM_PALETTES[0];

  const xDomain = useMemo(() => {
    if (values.length === 0) {
      return { min: undefined, max: undefined } as { min: number | undefined; max: number | undefined };
    }
    const nums = [...values];
    if (!hideCsvSpecLines && csvSpecLower !== null && Number.isFinite(csvSpecLower)) {
      nums.push(csvSpecLower);
    }
    if (!hideCsvSpecLines && csvSpecUpper !== null && Number.isFinite(csvSpecUpper)) {
      nums.push(csvSpecUpper);
    }
    if (drawableGlobalNewSpec.lower !== null && Number.isFinite(drawableGlobalNewSpec.lower)) {
      nums.push(drawableGlobalNewSpec.lower);
    }
    if (drawableGlobalNewSpec.upper !== null && Number.isFinite(drawableGlobalNewSpec.upper)) {
      nums.push(drawableGlobalNewSpec.upper);
    }
    return {
      min: Math.min(...nums),
      max: Math.max(...nums),
    };
  }, [csvSpecLower, csvSpecUpper, drawableGlobalNewSpec.lower, drawableGlobalNewSpec.upper, hideCsvSpecLines, values]);

  const chartData = useMemo(
    () => {
      const datasets = [
        {
          label: "数量",
          data: histogram.map((bin) => ({ x: bin.center, y: bin.count, left: bin.left, right: bin.right })),
          backgroundColor: (context: { chart: ChartJS<"bar"> }) => {
            const chart = context.chart;
            const { chartArea, ctx } = chart;
            if (!chartArea) {
              return palette.from;
            }
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, palette.from);
            gradient.addColorStop(1, palette.to);
            return gradient;
          },
          borderColor: palette.border,
          borderWidth: 1,
          hoverBackgroundColor: palette.border,
          borderRadius: 2,
          categoryPercentage: 1,
          barPercentage: 1,
        },
        {
          type: "line" as const,
          label: "趋势线",
          data: trendPoints,
          parsing: false,
          borderColor: CHART_BLUE.line,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 2,
          tension: 0.35,
          fill: false,
        },
      ];

      return { datasets };
    },
    [histogram, palette.border, palette.from, palette.to, trendPoints],
  );

  const chartOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      animation: {
        duration: 220,
        easing: "easeOutQuart",
      },
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      layout: {
        padding: {
          top: 44,
        },
      },
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      events: ["mousedown", "mouseup", "mousemove", "mouseout", "click", "touchstart", "touchmove"],
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          titleColor: "#fff",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148, 163, 184, 0.35)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (context) => {
              const raw = context.raw as { left?: number; right?: number };
              const rangeText =
                raw && Number.isFinite(raw.left) && Number.isFinite(raw.right)
                  ? `区间: ${fmt(raw.left as number, 2)} ~ ${fmt(raw.right as number, 2)}`
                  : "";
              return [`数量: ${context.parsed.y}`, rangeText].filter(Boolean);
            },
            title: (items) => {
              const center = items[0]?.parsed.x;
              return Number.isFinite(center) ? `X: ${fmt(center, 2)}` : "";
            },
          },
        },
        cpHistogramSpecLines: {
          lower: hideCsvSpecLines ? null : csvSpecLower,
          upper: hideCsvSpecLines ? null : csvSpecUpper,
          csvLower: hideCsvSpecLines ? null : csvSpecLower,
          csvUpper: hideCsvSpecLines ? null : csvSpecUpper,
          newLower: drawableGlobalNewSpec.lower,
          newUpper: drawableGlobalNewSpec.upper,
          draggable: false,
        },
      },
      scales: {
        x: {
          type: "linear",
          min: xDomain.min,
          max: xDomain.max,
          title: {
            display: true,
            text: "测试值",
          },
          grid: {
            color: "rgba(148,163,184,0.14)",
          },
          ticks: {
            callback: (value) => {
              const parsed = Number(value);
              if (!Number.isFinite(parsed)) {
                return "";
              }
              return parsed.toFixed(2);
            },
          },
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "数量",
          },
          grid: {
            color: "rgba(148,163,184,0.14)",
          },
          ticks: {
            precision: 0,
          },
        },
      },
    }),
    [
      csvSpecLower,
      csvSpecUpper,
      drawableGlobalNewSpec.lower,
      drawableGlobalNewSpec.upper,
      hideCsvSpecLines,
      xDomain.max,
      xDomain.min,
    ],
  );

  return (
    <div className="app-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">批次汇总直方图</h3>
          <p className="mt-1 text-xs text-muted-foreground">测试项：{testItem} · 覆盖 {waferCount} 片</p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-7 w-7 border-input bg-background/85 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => {
            const canvas = chartContainerRef.current?.querySelector("canvas");
            if (!canvas) {
              return;
            }
            const safeItem = testItem.replace(/[^\w.-]+/g, "_");
            exportChartCanvasAsPng(canvas, `batch_summary_${safeItem}_histogram.png`);
          }}
          title="下载汇总图"
          aria-label="下载汇总图"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">片数</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{waferCount}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">数量</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{stats.count}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">平均数</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{fmt(stats.mean, 2)}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">标准差</div>
          <div className="mt-0.5 text-base font-semibold text-foreground">{fmt(stats.standardDeviation, 2)}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-center text-xs">
          <div className="text-muted-foreground">未来良率</div>
          <div className="mt-0.5 font-semibold text-foreground">{formatFutureYieldRate(futureYield)}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-foreground">{formatFutureYieldPoints(futureYield)}</div>
        </div>
      </div>

      <SpecAnnotationStrip
        csvSpec={{ lower: csvSpecLower, upper: csvSpecUpper }}
        newSpec={drawableGlobalNewSpec}
        invalidNewSpec={parsedGlobalNewSpec.hasAny && !parsedGlobalNewSpec.isValid}
      />

      <div
        ref={chartContainerRef}
        className="relative h-[300px] rounded-lg border border-input bg-gradient-to-b from-background to-muted/35 p-2"
      >
        {values.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前范围内无汇总数据</div>
        ) : (
          <>
            <Bar ref={chartRef} data={chartData} options={chartOptions} />
            <DraggableSpecOverlay
              chartRef={chartRef}
              spec={drawableGlobalNewSpec}
              onSpecChange={(side, value) => {
                onGlobalNewSpecChange({
                  ...globalNewSpec,
                  [side]: formatSpecInputValue(value),
                });
              }}
            />
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>x-min: {xMin === null ? "-" : fmt(xMin, 2)}</span>
        <span>x-max: {xMax === null ? "-" : fmt(xMax, 2)}</span>
        <span>CSV LSL: {csvSpecLower === null ? "-" : fmt(csvSpecLower, 2)}</span>
        <span>CSV USL: {csvSpecUpper === null ? "-" : fmt(csvSpecUpper, 2)}</span>
        <span>New LSL: {drawableGlobalNewSpec.lower === null ? "-" : fmt(drawableGlobalNewSpec.lower, 2)}</span>
        <span>New USL: {drawableGlobalNewSpec.upper === null ? "-" : fmt(drawableGlobalNewSpec.upper, 2)}</span>
        {!hasCsvSpecLine && <span className="text-amber-700">该测试项缺少 CSV spec，未绘制 spec 线</span>}
      </div>
    </div>
  );
};

const CpHistogramView: React.FC = () => {
  useAppTitle({ title: "CP Histogram" });

  const [files, setFiles] = useState<ParsedCpHistogramFile[]>(() => sortCpHistogramFiles(cpHistogramViewCache.files));
  const [selectedTestItem, setSelectedTestItem] = useState(cpHistogramViewCache.selectedTestItem);
  const [selectedCpStages, setSelectedCpStages] = useState<string[]>(cpHistogramViewCache.selectedCpStages);
  const [selectedWaferGroups, setSelectedWaferGroups] = useState<string[]>(cpHistogramViewCache.selectedWaferGroups);
  const [filterLower, setFilterLower] = useState(cpHistogramViewCache.filterLower);
  const [filterUpper, setFilterUpper] = useState(cpHistogramViewCache.filterUpper);
  const [hideCsvSpecLines, setHideCsvSpecLines] = useState(cpHistogramViewCache.hideCsvSpecLines);
  const [specOverrideMap, setSpecOverrideMap] = useState(cpHistogramViewCache.specOverrideMap);
  const [localSpecDraftMap, setLocalSpecDraftMap] = useState(cpHistogramViewCache.localSpecDraftMap);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(cpHistogramViewCache.error);
  const [notice, setNotice] = useState(cpHistogramViewCache.notice);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const allTestItems = useMemo(() => {
    const itemSet = new Set<string>();
    files.forEach((file) => {
      file.testItems.forEach((item) => {
        if (!BASE_COLUMNS.has(normalizeHeader(item))) {
          itemSet.add(item);
        }
      });
    });
    return Array.from(itemSet).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const allCpStages = useMemo(() => getCpStageOptions(files), [files]);

  const allWaferGroups = useMemo(() => getWaferGroupOptions(files, allCpStages), [allCpStages, files]);

  const availableWaferGroups = useMemo(
    () => getWaferGroupOptions(files, selectedCpStages),
    [files, selectedCpStages],
  );

  useEffect(() => {
    if (!selectedTestItem && allTestItems.length > 0) {
      setSelectedTestItem(allTestItems[0]);
      return;
    }
    if (selectedTestItem && !allTestItems.includes(selectedTestItem)) {
      setSelectedTestItem(allTestItems[0] ?? "");
    }
  }, [allTestItems, selectedTestItem]);

  useEffect(() => {
    setSelectedCpStages((prev) => prev.filter((stage) => allCpStages.includes(stage)));
  }, [allCpStages]);

  useEffect(() => {
    setSelectedWaferGroups((prev) => {
      const available = new Set(availableWaferGroups);
      const kept = availableWaferGroups.filter((group) => prev.includes(group) && available.has(group));
      if (kept.length > 0 || availableWaferGroups.length === 0) {
        return kept;
      }
      return availableWaferGroups;
    });
  }, [availableWaferGroups]);

  useEffect(() => {
    cpHistogramViewCache = {
      files,
      selectedTestItem,
      selectedCpStages,
      selectedWaferGroups,
      filterLower,
      filterUpper,
      hideCsvSpecLines,
      specOverrideMap,
      localSpecDraftMap,
      notice,
      error,
    };
  }, [error, files, filterLower, filterUpper, hideCsvSpecLines, localSpecDraftMap, notice, selectedCpStages, selectedTestItem, selectedWaferGroups, specOverrideMap]);

  const hasBothRangeBounds = filterLower.trim() !== "" && filterUpper.trim() !== "";
  const parsedRangeLower = toNumber(filterLower);
  const parsedRangeUpper = toNumber(filterUpper);
  const isRangeValid = hasBothRangeBounds && parsedRangeLower !== null && parsedRangeUpper !== null && parsedRangeLower <= parsedRangeUpper;
  const hasHalfRangeInput = (filterLower.trim() !== "" && filterUpper.trim() === "") || (filterLower.trim() === "" && filterUpper.trim() !== "");

  const rangeFilter = useMemo(() => {
    if (!isRangeValid || parsedRangeLower === null || parsedRangeUpper === null) {
      return null;
    }
    return {
      lower: parsedRangeLower,
      upper: parsedRangeUpper,
    };
  }, [isRangeValid, parsedRangeLower, parsedRangeUpper]);

  const selectedFiles = useMemo(
    () =>
      sortCpHistogramFiles(
        files.filter(
          (file) => selectedCpStages.includes(file.cpStage) && selectedWaferGroups.includes(file.waferGroup),
        ),
      ),
    [files, selectedCpStages, selectedWaferGroups],
  );

  const defaultSpec = useMemo(() => {
    if (!selectedTestItem) {
      return { lower: null, upper: null };
    }
    let lower: number | null = null;
    let upper: number | null = null;
    for (const file of selectedFiles) {
      const spec = file.specByItem[selectedTestItem];
      if (!spec) {
        continue;
      }
      if (lower === null && spec.lower !== null) {
        lower = spec.lower;
      }
      if (upper === null && spec.upper !== null) {
        upper = spec.upper;
      }
    }
    if (lower !== null || upper !== null) {
      return { lower, upper };
    }

    for (const file of files) {
      const spec = file.specByItem[selectedTestItem];
      if (!spec) {
        continue;
      }
      if (lower === null && spec.lower !== null) {
        lower = spec.lower;
      }
      if (upper === null && spec.upper !== null) {
        upper = spec.upper;
      }
    }

    return { lower, upper };
  }, [files, selectedFiles, selectedTestItem]);
  const currentOverride = specOverrideMap[selectedTestItem] ?? emptySpecInputs();
  const parsedCurrentOverride = parseSpecInputs(currentOverride);

  const filteredValuesByFile = useMemo(() => {
    const entries = new Map<string, number[]>();
    selectedFiles.forEach((file) => {
      const rawValues = file.testData[selectedTestItem] ?? [];
      if (!rangeFilter) {
        entries.set(file.id, rawValues);
        return;
      }
      entries.set(
        file.id,
        rawValues.filter((value) => value >= rangeFilter.lower && value <= rangeFilter.upper),
      );
    });
    return entries;
  }, [rangeFilter, selectedFiles, selectedTestItem]);

  const allFilteredValues = useMemo(() => {
    return selectedFiles.flatMap((file) => filteredValuesByFile.get(file.id) ?? []);
  }, [filteredValuesByFile, selectedFiles]);

  const visibleXMin = allFilteredValues.length > 0 ? Math.min(...allFilteredValues) : null;
  const visibleXMax = allFilteredValues.length > 0 ? Math.max(...allFilteredValues) : null;

  const onPickFiles = async (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) {
      return;
    }

    const csvFiles = incomingFiles.filter((file) => file.name.toLowerCase().endsWith(".csv"));
    if (csvFiles.length === 0) {
      setError("仅支持上传 .csv 文件");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const errorMessages: string[] = [];
      const existingNames = new Set(files.map((file) => file.fileName));
      const incomingNameSet = new Set<string>();
      const duplicates = new Set<string>();

      csvFiles.forEach((file) => {
        if (existingNames.has(file.name) || incomingNameSet.has(file.name)) {
          duplicates.add(file.name);
        }
        incomingNameSet.add(file.name);
      });

      if (duplicates.size > 0) {
        errorMessages.push(`检测到同名文件，已拒绝上传: ${Array.from(duplicates).join("、")}`);
      }

      const allowedFiles = csvFiles.filter((file) => !duplicates.has(file.name));
      if (allowedFiles.length === 0) {
        setError(errorMessages.join("；"));
        return;
      }

      const fileMetas = new Map<string, CpHistogramFilenameMeta>();
      const validFiles: File[] = [];
      const invalidFileNames: string[] = [];
      allowedFiles.forEach((file) => {
        const meta = parseCpHistogramFilenameMeta(file.name);
        if (!meta) {
          invalidFileNames.push(file.name);
          return;
        }
        fileMetas.set(file.name, meta);
        validFiles.push(file);
      });

      if (invalidFileNames.length > 0) {
        errorMessages.push(`文件名无法识别 CP/waferid，已拒绝上传: ${invalidFileNames.join("、")}`);
      }

      if (validFiles.length === 0) {
        setError(errorMessages.join("；"));
        return;
      }

      const results = await Promise.allSettled(
        validFiles.map((file) => parseCpHistogramFile(file, fileMetas.get(file.name)!)),
      );
      const success = results
        .filter((result): result is PromiseFulfilledResult<ParsedCpHistogramFile> => result.status === "fulfilled")
        .map((result) => result.value);
      const failed = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (result.reason instanceof Error ? result.reason.message : "CSV 解析失败"));

      if (success.length > 0) {
        setFiles((prev) => {
          const next = sortCpHistogramFiles([...prev, ...success]);
          const nextCpStages = getCpStageOptions(next);
          setSelectedCpStages(nextCpStages);
          setSelectedWaferGroups(getWaferGroupOptions(next, nextCpStages));
          return next;
        });
        setNotice(`成功导入 ${success.length} 个文件`);
      }
      if (failed.length > 0) {
        errorMessages.push(...failed);
      }
      if (errorMessages.length > 0) {
        setError(errorMessages.join("；"));
      }
    } finally {
      setLoading(false);
    }
  };

  const clearAllFiles = () => {
    setFiles([]);
    setSelectedCpStages([]);
    setSelectedWaferGroups([]);
    setSelectedTestItem("");
    setSpecOverrideMap({});
    setLocalSpecDraftMap({});
    setError("");
    setNotice("");
  };

  const updateSpecOverride = (key: "lower" | "upper", value: string) => {
    if (!selectedTestItem) {
      return;
    }
    const nextSpecByItem = (prev: Record<string, SpecInputs>) => ({
      ...prev,
      [selectedTestItem]: {
        lower: key === "lower" ? value : prev[selectedTestItem]?.lower ?? "",
        upper: key === "upper" ? value : prev[selectedTestItem]?.upper ?? "",
      },
    });

    setSpecOverrideMap((prev) => nextSpecByItem(prev));
    // Once a global spec exists for current test item, clear local drafts to avoid shadowing.
    setLocalSpecDraftMap((prev) => {
      const nextEntries = Object.entries(prev).filter(([draftKey]) => !draftKey.endsWith(`::${selectedTestItem}`));
      return Object.fromEntries(nextEntries);
    });
  };

  const updateLocalSpecDraft = (fileId: string, testItem: string, nextSpec: SpecInputs) => {
    const specKey = getLocalSpecKey(fileId, testItem);
    setLocalSpecDraftMap((prev) => ({
      ...prev,
      [specKey]: nextSpec,
    }));
  };

  const applyLocalSpecToGlobal = (fileId: string, testItem: string) => {
    const specKey = getLocalSpecKey(fileId, testItem);
    const draftSpec = localSpecDraftMap[specKey];
    if (!draftSpec) {
      return;
    }

    setSpecOverrideMap((prev) => ({
      ...prev,
      [testItem]: draftSpec,
    }));
    setLocalSpecDraftMap((prev) => {
      const nextEntries = Object.entries(prev).filter(([key]) => !key.endsWith(`::${testItem}`));
      return Object.fromEntries(nextEntries);
    });
  };

  const isFileDragEvent = (event: React.DragEvent<HTMLDivElement>) => {
    return Array.from(event.dataTransfer.types).includes("Files");
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      void onPickFiles(droppedFiles);
    }
  };

  return (
    <div
      className="relative mx-auto flex h-full w-full max-w-[1600px] flex-col gap-5 p-6"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-chart-2 bg-chart-2/10">
          <div className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm">
            松开鼠标，上传 CSV
          </div>
        </div>
      )}

      <div className="app-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectFilter
            label="CP"
            options={allCpStages}
            selectedValues={selectedCpStages}
            placeholder="请选择 CP"
            emptyText="暂无 CP"
            disabled={files.length === 0}
            onChange={setSelectedCpStages}
          />

          <MultiSelectFilter
            label="waferid"
            options={availableWaferGroups}
            selectedValues={selectedWaferGroups}
            placeholder={selectedCpStages.length === 0 ? "请先选择 CP" : "请选择 waferid"}
            emptyText={selectedCpStages.length === 0 ? "请先选择 CP" : "当前 CP 下暂无 waferid"}
            summaryMode="count"
            countUnit="片"
            disabled={files.length === 0 || selectedCpStages.length === 0}
            onChange={setSelectedWaferGroups}
          />

          <div className="min-w-[220px] flex-1">
            <div className="mb-1 text-xs font-medium text-muted-foreground">测试项</div>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none"
              value={selectedTestItem}
              onChange={(event) => setSelectedTestItem(event.target.value)}
              disabled={allTestItems.length === 0}
            >
              {allTestItems.length === 0 ? <option value="">暂无测试项</option> : allTestItems.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <div className="w-[140px]">
            <div className="mb-1 text-xs font-medium text-muted-foreground">x-min</div>
            <input
              className="h-10 w-full rounded-lg border border-input bg-muted/40 px-3 text-sm text-foreground"
              value={visibleXMin === null ? "" : fmt(visibleXMin, 2)}
              readOnly
              placeholder="-"
            />
          </div>

          <div className="w-[140px]">
            <div className="mb-1 text-xs font-medium text-muted-foreground">x-max</div>
            <input
              className="h-10 w-full rounded-lg border border-input bg-muted/40 px-3 text-sm text-foreground"
              value={visibleXMax === null ? "" : fmt(visibleXMax, 2)}
              readOnly
              placeholder="-"
            />
          </div>

          <div className="w-[170px]">
            <div className="mb-1 text-xs font-medium text-muted-foreground">下限（筛选）</div>
            <input
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={filterLower}
              onChange={(event) => setFilterLower(event.target.value)}
              placeholder="请输入下限"
            />
          </div>

          <div className="w-[170px]">
            <div className="mb-1 text-xs font-medium text-muted-foreground">上限（筛选）</div>
            <input
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={filterUpper}
              onChange={(event) => setFilterUpper(event.target.value)}
              placeholder="请输入上限"
            />
          </div>
          <div className="w-[170px]">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {parsedCurrentOverride.hasAny ? "New Spec下限（LSL）" : "Spec下限（LSL）"}
            </div>
            <input
              className={cn(
                "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground",
                currentOverride.lower.trim() !== "" && "border-primary/50",
              )}
              value={currentOverride.lower}
              onChange={(event) => updateSpecOverride("lower", event.target.value)}
              placeholder={defaultSpec.lower === null ? "CSV 缺失" : defaultSpec.lower.toFixed(2)}
            />
          </div>

          <div className="w-[170px]">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {parsedCurrentOverride.hasAny ? "New Spec上限（USL）" : "Spec上限（USL）"}
            </div>
            <input
              className={cn(
                "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground",
                currentOverride.upper.trim() !== "" && "border-primary/50",
              )}
              value={currentOverride.upper}
              onChange={(event) => updateSpecOverride("upper", event.target.value)}
              placeholder={defaultSpec.upper === null ? "CSV 缺失" : defaultSpec.upper.toFixed(2)}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg border-input text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setFilterLower("");
              setFilterUpper("");
            }}
            disabled={filterLower.trim() === "" && filterUpper.trim() === ""}
          >
            清除筛选
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg border-input text-xs text-muted-foreground hover:text-foreground"
            onClick={clearAllFiles}
            disabled={files.length === 0}
          >
            清除全部
          </Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3 text-xs text-muted-foreground hover:text-foreground">
            <Checkbox
              className="border-chart-2/60 data-[state=checked]:border-chart-2 data-[state=checked]:bg-chart-2 data-[state=checked]:text-white focus-visible:ring-chart-2"
              checked={hideCsvSpecLines}
              onCheckedChange={(checked) => setHideCsvSpecLines(checked === true)}
            />
            <span>隐藏原先 spec</span>
          </label>
          <span className="text-xs text-muted-foreground">
            {files.length === 0
              ? "拖入 Summary CSV 开始解析"
              : `已导入 ${files.length} 个文件 · ${allCpStages.length} 个 CP · ${allWaferGroups.length} 个 waferid`}
          </span>
          {loading && <span className="text-xs text-muted-foreground">正在解析文件...</span>}
        </div>

        {hasHalfRangeInput && <p className="mt-2 text-xs text-amber-700">筛选上下限需同时填写，当前未生效。</p>}
        {hasBothRangeBounds && !isRangeValid && <p className="mt-2 text-xs text-destructive">筛选范围无效，请确认下限/上限均为数字且下限不大于上限。</p>}
        {rangeFilter && <p className="mt-2 text-xs text-muted-foreground">当前筛选：{fmt(rangeFilter.lower, 2)} ~ {fmt(rangeFilter.upper, 2)}</p>}
        {parsedCurrentOverride.hasAny && !parsedCurrentOverride.isValid && (
          <p className="mt-2 text-xs text-destructive">New Spec 无效，请确认输入为数字且 LSL 不大于 USL。</p>
        )}

        {notice && <p className="mt-2 text-xs text-chart-2">{notice}</p>}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {selectedFiles.length > 0 && selectedTestItem && (
          <div className="col-span-full">
            <BatchHistogramCard
              testItem={selectedTestItem}
              values={allFilteredValues}
              csvSpecLower={defaultSpec.lower}
              csvSpecUpper={defaultSpec.upper}
              globalNewSpec={currentOverride}
              hideCsvSpecLines={hideCsvSpecLines}
              waferCount={selectedFiles.length}
              onGlobalNewSpecChange={(nextSpec) => {
                setSpecOverrideMap((prev) => ({
                  ...prev,
                  [selectedTestItem]: nextSpec,
                }));
                setLocalSpecDraftMap((prev) => {
                  const nextEntries = Object.entries(prev).filter(([draftKey]) => !draftKey.endsWith(`::${selectedTestItem}`));
                  return Object.fromEntries(nextEntries);
                });
              }}
            />
          </div>
        )}

        {selectedFiles.length === 0 && (
          <div className="app-surface col-span-full p-6 text-sm text-muted-foreground">
            {files.length === 0 ? "请先拖入 Summary CSV 文件。" : "当前 CP/waferid 筛选下没有文件。"}
          </div>
        )}

        {selectedFiles.map((file) => {
          const values = filteredValuesByFile.get(file.id) ?? [];
          return (
            <HistogramCard
              key={file.id}
              file={file}
              testItem={selectedTestItem}
              values={values}
              globalNewSpec={currentOverride}
              localNewSpec={localSpecDraftMap[getLocalSpecKey(file.id, selectedTestItem)] ?? null}
              hideCsvSpecLines={hideCsvSpecLines}
              paletteIndex={files.findIndex((item) => item.id === file.id)}
              onLocalNewSpecChange={(nextSpec) => updateLocalSpecDraft(file.id, selectedTestItem, nextSpec)}
              onApplyLocalSpecAsGlobal={() => applyLocalSpecToGlobal(file.id, selectedTestItem)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default CpHistogramView;

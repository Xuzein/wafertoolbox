import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarElement,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { Download, Upload, X } from "lucide-react";
import { useAppTitle } from "@/components/layout/app-title-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HistogramSpec = {
  lower: number | null;
  upper: number | null;
};

type ParsedCpHistogramFile = {
  id: string;
  fileName: string;
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
  variance: number;
};

type SpecLinePluginOptions = {
  lower: number | null;
  upper: number | null;
};

type CpHistogramViewCache = {
  files: ParsedCpHistogramFile[];
  selectedTestItem: string;
  selectedFileIds: string[];
  filterLower: string;
  filterUpper: string;
  specOverrideMap: Record<string, { lower: string; upper: string }>;
  notice: string;
  error: string;
};

const defaultCpHistogramViewCache: CpHistogramViewCache = {
  files: [],
  selectedTestItem: "",
  selectedFileIds: [],
  filterLower: "",
  filterUpper: "",
  specOverrideMap: {},
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
  ].map((item) => item.toUpperCase()),
);

const FILE_CHIP_THEMES = [
  "border-chart-2/60 bg-chart-2 text-white",
  "border-chart-1/60 bg-chart-1/85 text-black",
  "border-emerald-500/60 bg-emerald-500 text-white",
  "border-indigo-500/60 bg-indigo-500 text-white",
  "border-rose-500/60 bg-rose-500 text-white",
] as const;

const HISTOGRAM_PALETTES = [
  { from: "rgba(37, 99, 235, 0.88)", to: "rgba(56, 189, 248, 0.85)", border: "rgba(37,99,235,0.96)" },
  { from: "rgba(245, 158, 11, 0.88)", to: "rgba(251, 191, 36, 0.82)", border: "rgba(217,119,6,0.95)" },
  { from: "rgba(16, 185, 129, 0.88)", to: "rgba(45, 212, 191, 0.82)", border: "rgba(5,150,105,0.95)" },
  { from: "rgba(139, 92, 246, 0.88)", to: "rgba(167, 139, 250, 0.82)", border: "rgba(124,58,237,0.95)" },
] as const;

const SPEC_LINE_PLUGIN: Plugin<"bar", SpecLinePluginOptions> = {
  id: "cpHistogramSpecLines",
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

    const drawLine = (value: number | null, color: string, label: string) => {
      if (value === null || !Number.isFinite(value)) {
        return;
      }

      const x = xScale.getPixelForValue(value);
      if (!Number.isFinite(x) || x < left || x > right) {
        return;
      }

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = color;
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "600 11px sans-serif";
      ctx.textAlign = "left";
      const textX = Math.min(x + 4, right - 86);
      const textY = top + 12;
      ctx.fillText(`${label}: ${value.toFixed(2)}`, textX, textY);
      ctx.restore();
    };

    drawLine(options.lower, "rgba(225,29,72,0.95)", "LSL");
    drawLine(options.upper, "rgba(225,29,72,0.95)", "USL");
  },
};

ChartJS.register(BarElement, LineElement, PointElement, LinearScale, Tooltip, Legend, SPEC_LINE_PLUGIN);

const fmt = (value: number, digits = 2) => value.toFixed(digits);

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

const parseCpHistogramFile = async (file: File): Promise<ParsedCpHistogramFile> => {
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
      variance: 0,
    };
  }

  const count = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;

  return {
    count,
    mean,
    variance,
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

const HistogramCard: React.FC<{
  file: ParsedCpHistogramFile;
  testItem: string;
  values: number[];
  overrideSpecLower: number | null;
  overrideSpecUpper: number | null;
  paletteIndex: number;
}> = ({ file, testItem, values, overrideSpecLower, overrideSpecUpper, paletteIndex }) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const histogram = useMemo(() => buildHistogram(values), [values]);
  const stats = useMemo(() => calcStats(values), [values]);
  const fileSpec = file.specByItem[testItem] ?? { lower: null, upper: null };
  const specLower = overrideSpecLower ?? fileSpec.lower;
  const specUpper = overrideSpecUpper ?? fileSpec.upper;
  const palette = HISTOGRAM_PALETTES[paletteIndex % HISTOGRAM_PALETTES.length];

  const xMin = values.length > 0 ? Math.min(...values) : null;
  const xMax = values.length > 0 ? Math.max(...values) : null;
  const hasSpecLine = (specLower !== null && Number.isFinite(specLower)) || (specUpper !== null && Number.isFinite(specUpper));
  const xDomain = useMemo(() => {
    if (values.length === 0) {
      return { min: undefined, max: undefined } as { min: number | undefined; max: number | undefined };
    }
    const nums = [...values];
    if (specLower !== null && Number.isFinite(specLower)) {
      nums.push(specLower);
    }
    if (specUpper !== null && Number.isFinite(specUpper)) {
      nums.push(specUpper);
    }
    return {
      min: Math.min(...nums),
      max: Math.max(...nums),
    };
  }, [specLower, specUpper, values]);

  const chartData = useMemo(
    () => ({
      datasets: [
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
      ],
    }),
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
      interaction: {
        mode: "nearest",
        intersect: false,
      },
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
          lower: specLower,
          upper: specUpper,
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
    [specLower, specUpper, xDomain.max, xDomain.min],
  );

  return (
    <div className="app-surface p-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="group mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{file.waferId}</h3>
          <p className="mt-1 max-w-[420px] truncate text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            {file.fileName}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              const link = document.createElement("a");
              link.href = canvas.toDataURL("image/png");
              const safeWafer = file.waferId.replace(/[^\w.-]+/g, "_");
              const safeItem = testItem.replace(/[^\w.-]+/g, "_");
              link.download = `${safeWafer}_${safeItem}_histogram.png`;
              link.click();
            }}
            title="下载图表"
            aria-label="下载图表"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">测量点数</div>
          <div className="mt-0.5 font-semibold text-foreground">{file.totalPoints}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">良率</div>
          <div className="mt-0.5 font-semibold text-foreground">
            {file.yieldRate === null ? "-" : `${file.yieldRate.toFixed(2)}%`}
          </div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">数量</div>
          <div className="mt-0.5 font-semibold text-foreground">{stats.count}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">平均数</div>
          <div className="mt-0.5 font-semibold text-foreground">{fmt(stats.mean, 2)}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">方差</div>
          <div className="mt-0.5 font-semibold text-foreground">{fmt(stats.variance, 2)}</div>
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className="relative h-[260px] rounded-lg border border-input bg-gradient-to-b from-background to-muted/35 p-2"
      >
        {values.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前范围内无数据</div>
        ) : (
          <Bar data={chartData} options={chartOptions} />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>x-min: {xMin === null ? "-" : fmt(xMin, 2)}</span>
        <span>x-max: {xMax === null ? "-" : fmt(xMax, 2)}</span>
        <span>LSL: {specLower === null ? "-" : fmt(specLower, 2)}</span>
        <span>USL: {specUpper === null ? "-" : fmt(specUpper, 2)}</span>
        {!hasSpecLine && <span className="text-amber-700">该测试项缺少 spec，未绘制虚线</span>}
      </div>
    </div>
  );
};

const BatchHistogramCard: React.FC<{
  testItem: string;
  values: number[];
  specLower: number | null;
  specUpper: number | null;
  waferCount: number;
}> = ({ testItem, values, specLower, specUpper, waferCount }) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const histogram = useMemo(() => buildHistogram(values), [values]);
  const trendPoints = useMemo(() => buildTrendPoints(histogram), [histogram]);
  const stats = useMemo(() => calcStats(values), [values]);

  const xMin = values.length > 0 ? Math.min(...values) : null;
  const xMax = values.length > 0 ? Math.max(...values) : null;
  const hasSpecLine = (specLower !== null && Number.isFinite(specLower)) || (specUpper !== null && Number.isFinite(specUpper));
  const palette = HISTOGRAM_PALETTES[0];

  const xDomain = useMemo(() => {
    if (values.length === 0) {
      return { min: undefined, max: undefined } as { min: number | undefined; max: number | undefined };
    }
    const nums = [...values];
    if (specLower !== null && Number.isFinite(specLower)) {
      nums.push(specLower);
    }
    if (specUpper !== null && Number.isFinite(specUpper)) {
      nums.push(specUpper);
    }
    return {
      min: Math.min(...nums),
      max: Math.max(...nums),
    };
  }, [specLower, specUpper, values]);

  const chartData = useMemo(
    () => ({
      datasets: [
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
          type: "line",
          label: "趋势线",
          data: trendPoints,
          parsing: false,
          borderColor: "rgba(220,38,38,0.95)",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 2,
          tension: 0.35,
          fill: false,
        },
      ],
    }),
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
      interaction: {
        mode: "nearest",
        intersect: false,
      },
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
          lower: specLower,
          upper: specUpper,
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
    [specLower, specUpper, xDomain.max, xDomain.min],
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
            const link = document.createElement("a");
            link.href = canvas.toDataURL("image/png");
            const safeItem = testItem.replace(/[^\w.-]+/g, "_");
            link.download = `batch_summary_${safeItem}_histogram.png`;
            link.click();
          }}
          title="下载汇总图"
          aria-label="下载汇总图"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">片数</div>
          <div className="mt-0.5 font-semibold text-foreground">{waferCount}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">数量</div>
          <div className="mt-0.5 font-semibold text-foreground">{stats.count}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">平均数</div>
          <div className="mt-0.5 font-semibold text-foreground">{fmt(stats.mean, 2)}</div>
        </div>
        <div className="rounded-md border border-input bg-muted/35 px-2.5 py-1.5 text-xs">
          <div className="text-muted-foreground">方差</div>
          <div className="mt-0.5 font-semibold text-foreground">{fmt(stats.variance, 2)}</div>
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className="relative h-[300px] rounded-lg border border-input bg-gradient-to-b from-background to-muted/35 p-2"
      >
        {values.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前范围内无汇总数据</div>
        ) : (
          <Bar data={chartData} options={chartOptions} />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>x-min: {xMin === null ? "-" : fmt(xMin, 2)}</span>
        <span>x-max: {xMax === null ? "-" : fmt(xMax, 2)}</span>
        <span>LSL: {specLower === null ? "-" : fmt(specLower, 2)}</span>
        <span>USL: {specUpper === null ? "-" : fmt(specUpper, 2)}</span>
        {!hasSpecLine && <span className="text-amber-700">该测试项缺少 spec，未绘制虚线</span>}
      </div>
    </div>
  );
};

const CpHistogramView: React.FC = () => {
  useAppTitle({ title: "CP Histogram" });

  const [files, setFiles] = useState<ParsedCpHistogramFile[]>(cpHistogramViewCache.files);
  const [selectedTestItem, setSelectedTestItem] = useState(cpHistogramViewCache.selectedTestItem);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(cpHistogramViewCache.selectedFileIds);
  const [filterLower, setFilterLower] = useState(cpHistogramViewCache.filterLower);
  const [filterUpper, setFilterUpper] = useState(cpHistogramViewCache.filterUpper);
  const [specOverrideMap, setSpecOverrideMap] = useState(cpHistogramViewCache.specOverrideMap);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(cpHistogramViewCache.error);
  const [notice, setNotice] = useState(cpHistogramViewCache.notice);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);

  const allTestItems = useMemo(() => {
    const itemSet = new Set<string>();
    files.forEach((file) => file.testItems.forEach((item) => itemSet.add(item)));
    return Array.from(itemSet).sort((a, b) => a.localeCompare(b));
  }, [files]);

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
    setSelectedFileIds((prev) => {
      const available = new Set(files.map((file) => file.id));
      const kept = prev.filter((id) => available.has(id));
      if (kept.length > 0) {
        return kept;
      }
      return files.map((file) => file.id);
    });
  }, [files]);

  useEffect(() => {
    cpHistogramViewCache = {
      files,
      selectedTestItem,
      selectedFileIds,
      filterLower,
      filterUpper,
      specOverrideMap,
      notice,
      error,
    };
  }, [error, files, filterLower, filterUpper, notice, selectedFileIds, selectedTestItem, specOverrideMap]);

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
    () => files.filter((file) => selectedFileIds.includes(file.id)),
    [files, selectedFileIds],
  );

  const resolveDefaultSpec = (testItem: string): HistogramSpec => {
    if (!testItem) {
      return { lower: null, upper: null };
    }
    let lower: number | null = null;
    let upper: number | null = null;
    for (const file of selectedFiles) {
      const spec = file.specByItem[testItem];
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
      const spec = file.specByItem[testItem];
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
  };

  const defaultSpec = useMemo(() => resolveDefaultSpec(selectedTestItem), [files, selectedFiles, selectedTestItem]);
  const currentOverride = specOverrideMap[selectedTestItem] ?? { lower: "", upper: "" };

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

  const allUploadedFilteredValues = useMemo(() => {
    return files.flatMap((file) => {
      const rawValues = file.testData[selectedTestItem] ?? [];
      if (!rangeFilter) {
        return rawValues;
      }
      return rawValues.filter((value) => value >= rangeFilter.lower && value <= rangeFilter.upper);
    });
  }, [files, rangeFilter, selectedTestItem]);

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
        setError(`检测到同名文件，已拒绝上传: ${Array.from(duplicates).join("、")}`);
      }

      const allowedFiles = csvFiles.filter((file) => !duplicates.has(file.name));
      if (allowedFiles.length === 0) {
        return;
      }

      const results = await Promise.allSettled(allowedFiles.map((file) => parseCpHistogramFile(file)));
      const success = results
        .filter((result): result is PromiseFulfilledResult<ParsedCpHistogramFile> => result.status === "fulfilled")
        .map((result) => result.value);
      const failed = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (result.reason instanceof Error ? result.reason.message : "CSV 解析失败"));

      if (success.length > 0) {
        setFiles((prev) => {
          const next = [...prev, ...success];
          setSelectedFileIds(next.map((item) => item.id));
          return next;
        });
        setNotice(`成功导入 ${success.length} 个文件`);
      }
      if (failed.length > 0) {
        setError((prev) => [prev, ...failed].filter(Boolean).join("；"));
      }
    } finally {
      setLoading(false);
    }
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== fileId));
    setNotice("");
  };

  const clearAllFiles = () => {
    setFiles([]);
    setSelectedFileIds([]);
    setSelectedTestItem("");
    setError("");
    setNotice("");
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((prev) => {
      if (prev.includes(fileId)) {
        const filtered = prev.filter((id) => id !== fileId);
        return filtered.length > 0 ? filtered : prev;
      }
      return [...prev, fileId];
    });
  };

  const selectAllFiles = () => {
    setSelectedFileIds(files.map((file) => file.id));
  };

  const updateSpecOverride = (key: "lower" | "upper", value: string) => {
    if (!selectedTestItem) {
      return;
    }
    setSpecOverrideMap((prev) => ({
      ...prev,
      [selectedTestItem]: {
        lower: key === "lower" ? value : prev[selectedTestItem]?.lower ?? "",
        upper: key === "upper" ? value : prev[selectedTestItem]?.upper ?? "",
      },
    }));
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-lg bg-chart-2 text-white hover:bg-chart-2/90"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            上传 CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              void onPickFiles(picked);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 rounded-lg border-input"
            onClick={clearAllFiles}
            disabled={files.length === 0}
          >
            清除全部
          </Button>
          {loading && <span className="text-xs text-muted-foreground">正在解析文件...</span>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {files.length === 0 && <p className="text-xs text-muted-foreground">请上传一个或多个 Summary CSV 文件。</p>}
          {files.map((file, index) => {
            const selected = selectedFileIds.includes(file.id);
            return (
              <div key={file.id} className="group relative">
                <button
                  type="button"
                  className={cn(
                    "h-9 rounded-xl border px-3 pr-8 text-xs shadow-sm transition",
                    selected
                      ? FILE_CHIP_THEMES[index % FILE_CHIP_THEMES.length]
                      : "border-input bg-card text-foreground hover:bg-muted",
                  )}
                  onClick={() => toggleFileSelection(file.id)}
                >
                  <span className="max-w-[250px] truncate">{file.fileName}</span>
                </button>
                <button
                  type="button"
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeFile(file.id);
                  }}
                  title="删除"
                  aria-label={`删除 ${file.fileName}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="app-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
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
            <div className="mb-1 text-xs font-medium text-muted-foreground">Spec下限（LSL）</div>
            <input
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={currentOverride.lower}
              onChange={(event) => updateSpecOverride("lower", event.target.value)}
              placeholder={defaultSpec.lower === null ? "CSV 缺失" : defaultSpec.lower.toFixed(2)}
            />
          </div>

          <div className="w-[170px]">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Spec上限（USL）</div>
            <input
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
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
            className="h-8 rounded-lg border-input"
            onClick={selectAllFiles}
            disabled={files.length === 0}
          >
            全选
          </Button>
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
        </div>

        {hasHalfRangeInput && <p className="mt-2 text-xs text-amber-700">筛选上下限需同时填写，当前未生效。</p>}
        {hasBothRangeBounds && !isRangeValid && <p className="mt-2 text-xs text-destructive">筛选范围无效，请确认下限/上限均为数字且下限不大于上限。</p>}
        {rangeFilter && <p className="mt-2 text-xs text-muted-foreground">当前筛选：{fmt(rangeFilter.lower, 2)} ~ {fmt(rangeFilter.upper, 2)}</p>}

        {notice && <p className="mt-2 text-xs text-chart-2">{notice}</p>}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {files.length > 0 && selectedTestItem && (
          <div className="col-span-full">
            <BatchHistogramCard
              testItem={selectedTestItem}
              values={allUploadedFilteredValues}
              specLower={toNumber(currentOverride.lower) ?? defaultSpec.lower}
              specUpper={toNumber(currentOverride.upper) ?? defaultSpec.upper}
              waferCount={files.length}
            />
          </div>
        )}

        {selectedFiles.length === 0 && (
          <div className="app-surface col-span-full p-6 text-sm text-muted-foreground">请先上传并选中至少一个文件。</div>
        )}

        {selectedFiles.map((file) => {
          const values = filteredValuesByFile.get(file.id) ?? [];
          return (
            <HistogramCard
              key={file.id}
              file={file}
              testItem={selectedTestItem}
              values={values}
              overrideSpecLower={normalizeSpecValue(toNumber(currentOverride.lower))}
              overrideSpecUpper={normalizeSpecValue(toNumber(currentOverride.upper))}
              paletteIndex={files.findIndex((item) => item.id === file.id)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default CpHistogramView;

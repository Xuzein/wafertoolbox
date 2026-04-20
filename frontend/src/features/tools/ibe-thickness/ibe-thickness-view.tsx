import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTitle } from "@/components/layout/app-title-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Download, RotateCcw } from "lucide-react";
import { Environment } from "@wailsjs/runtime/runtime";

type ThicknessPoint = {
  x: number;
  y: number;
  z: number;
};

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  spanX: number;
  spanY: number;
};

type ParsedIbeMap = {
  id: string;
  fileName: string;
  points: ThicknessPoint[];
  bounds: Bounds;
  pointPitch: number;
};

type HeatGrid = {
  width: number;
  height: number;
  values: Float32Array;
  min: number;
  max: number;
};

type RGB = { r: number; g: number; b: number };

type Camera = {
  rotX: number;
  rotY: number;
  zoom: number;
};

type ScreenPoint = {
  index: number;
  x: number;
  y: number;
};

type PointPayload = {
  index: number;
  point: ThicknessPoint;
  x: number;
  y: number;
};

type TopographyStats = {
  zMax: number;
  zMin: number;
  zRange: number;
  zMean: number;
  zMedian: number;
  zSigma: number;
  uniformity: number;
};

type PngEntry = {
  name: string;
  bytes: Uint8Array;
};

const EPSILON = 1e-6;
const GRID_2D = 170;
const GRID_3D = 64;
const DEFAULT_CAMERA: Camera = { rotX: -0.82, rotY: 0.78, zoom: 1.18 };
const SCREEN_LAYOUT = { padLeft: 48, padRight: 22, padTop: 18, padBottom: 28 };
const EXPORT_LAYOUT = { padLeft: 106, padRight: 52, padTop: 54, padBottom: 64 };
const FILE_BUTTON_THEMES = [
  "bg-gradient-to-r from-cyan-500 to-sky-500 text-white hover:from-cyan-600 hover:to-sky-600",
  "bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600",
  "bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600",
  "bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:from-pink-600 hover:to-rose-600",
  "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600",
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const fmt2 = (value: number) => value.toFixed(2);

const parseCsvRow = (row: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === '"') {
      if (inQuotes && row[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const estimatePitch = (points: ThicknessPoint[]): number => {
  if (points.length < 2) {
    return 1;
  }
  const sampleStep = Math.max(1, Math.floor(points.length / 160));
  const nearest: number[] = [];

  for (let i = 0; i < points.length; i += sampleStep) {
    let best = Number.POSITIVE_INFINITY;
    const pi = points[i];
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) {
        continue;
      }
      const pj = points[j];
      const dist = Math.hypot(pi.x - pj.x, pi.y - pj.y);
      if (dist > EPSILON && dist < best) {
        best = dist;
      }
    }
    if (Number.isFinite(best)) {
      nearest.push(best);
    }
  }

  nearest.sort((a, b) => a - b);
  if (nearest.length === 0) {
    return 1;
  }
  return nearest[Math.floor(nearest.length / 2)];
};

const parseIbeCsv = async (file: File): Promise<ParsedIbeMap> => {
  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV is empty or has no data rows.");
  }

  const headers = parseCsvRow(lines[0]).map((item) => item.toLowerCase());
  const xIndex = headers.findIndex((item) => item === "x");
  const yIndex = headers.findIndex((item) => item === "y");
  const zIndex = headers.findIndex((item) => item === "z");

  if (xIndex < 0 || yIndex < 0 || zIndex < 0) {
    throw new Error("Header must include X, Y and Z columns.");
  }

  const points: ThicknessPoint[] = [];
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cols = parseCsvRow(lines[rowIndex]);
    const x = Number(cols[xIndex]);
    const y = Number(cols[yIndex]);
    const z = Number(cols[zIndex]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      points.push({ x, y, z });
    }
  }

  if (points.length === 0) {
    throw new Error("No valid numeric X/Y/Z points were parsed.");
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    fileName: file.name,
    points,
    bounds: {
      minX,
      maxX,
      minY,
      maxY,
      minZ,
      maxZ,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      spanX: Math.max(maxX - minX, EPSILON),
      spanY: Math.max(maxY - minY, EPSILON),
    },
    pointPitch: estimatePitch(points),
  };
};

const jetColor = (ratio: number): RGB => {
  const t = clamp(ratio, 0, 1);
  const r = clamp(1.5 - Math.abs(4 * t - 3), 0, 1);
  const g = clamp(1.5 - Math.abs(4 * t - 2), 0, 1);
  const b = clamp(1.5 - Math.abs(4 * t - 1), 0, 1);
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
};

const buildHeatGrid = (map: ParsedIbeMap, size: number): HeatGrid => {
  const width = size;
  const height = size;
  const values = new Float32Array(width * height).fill(Number.NaN);
  const { points, bounds, pointPitch } = map;
  const radius = pointPitch * 3.4;
  const radius2 = radius * radius;
  const validGap = pointPitch * 1.75;

  for (let gy = 0; gy < height; gy += 1) {
    const y = bounds.maxY - (gy / (height - 1)) * bounds.spanY;
    for (let gx = 0; gx < width; gx += 1) {
      const x = bounds.minX + (gx / (width - 1)) * bounds.spanX;
      let numerator = 0;
      let denominator = 0;
      let nearest = Number.POSITIVE_INFINITY;

      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const dx = x - point.x;
        const dy = y - point.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < nearest) {
          nearest = dist2;
        }
        if (dist2 > radius2) {
          continue;
        }
        const weight = 1 / (dist2 + pointPitch * pointPitch * 0.18);
        numerator += point.z * weight;
        denominator += weight;
      }

      const index = gy * width + gx;
      if (Math.sqrt(nearest) > validGap || denominator < EPSILON) {
        values[index] = Number.NaN;
      } else {
        values[index] = numerator / denominator;
      }
    }
  }

  return {
    width,
    height,
    values,
    min: bounds.minZ,
    max: bounds.maxZ,
  };
};

const ratioOfZ = (z: number, minZ: number, maxZ: number) => {
  if (Math.abs(maxZ - minZ) < EPSILON) {
    return 0.5;
  }
  return clamp((z - minZ) / (maxZ - minZ), 0, 1);
};

const computeStats = (points: ThicknessPoint[]): TopographyStats => {
  const zValues = points.map((point) => point.z);
  const zMax = Math.max(...zValues);
  const zMin = Math.min(...zValues);
  const zRange = zMax - zMin;
  const zMean = zValues.reduce((sum, value) => sum + value, 0) / zValues.length;
  const sorted = [...zValues].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const zMedian = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const variance = zValues.reduce((sum, value) => sum + (value - zMean) * (value - zMean), 0) / zValues.length;
  const zSigma = Math.sqrt(variance);
  const uniformity = Math.abs(zMean) < EPSILON ? Number.NaN : (zRange / (2 * zMean)) * 100;

  return {
    zMax,
    zMin,
    zRange,
    zMean,
    zMedian,
    zSigma,
    uniformity,
  };
};

const buildStatsRows = (stats: TopographyStats) => [
  { label: "Max", value: fmt2(stats.zMax) },
  { label: "Min", value: fmt2(stats.zMin) },
  { label: "Rang", value: fmt2(stats.zRange) },
  { label: "Mean", value: fmt2(stats.zMean) },
  { label: "Median", value: fmt2(stats.zMedian) },
  { label: "Std Dev", value: fmt2(stats.zSigma) },
  { label: "U%", value: Number.isFinite(stats.uniformity) ? fmt2(stats.uniformity) : "N/A" },
];

const drawHeatField = (
  ctx: CanvasRenderingContext2D,
  map: ParsedIbeMap,
  grid: HeatGrid,
  width: number,
  height: number,
  layout: { padLeft: number; padRight: number; padTop: number; padBottom: number },
  showPoints: boolean,
  highlightedIndex: number | null,
): ScreenPoint[] => {
  const { padLeft, padRight, padTop, padBottom } = layout;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#f7fbff");
  background.addColorStop(0.55, "#fdfefd");
  background.addColorStop(1, "#fff9f1");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const imageData = ctx.createImageData(grid.width, grid.height);
  for (let i = 0; i < grid.values.length; i += 1) {
    const value = grid.values[i];
    const pixel = i * 4;
    if (!Number.isFinite(value)) {
      imageData.data[pixel + 3] = 0;
      continue;
    }
    const color = jetColor(ratioOfZ(value, grid.min, grid.max));
    imageData.data[pixel] = color.r;
    imageData.data[pixel + 1] = color.g;
    imageData.data[pixel + 2] = color.b;
    imageData.data[pixel + 3] = 236;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = grid.width;
  offscreen.height = grid.height;
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) {
    return [];
  }
  offCtx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.drawImage(offscreen, padLeft, padTop, plotW, plotH);
  ctx.restore();

  for (let tick = 0; tick <= 7; tick += 1) {
    const y = padTop + (plotH / 7) * tick;
    ctx.strokeStyle = "rgba(120, 130, 150, 0.2)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
  }
  for (let tick = 0; tick <= 7; tick += 1) {
    const x = padLeft + (plotW / 7) * tick;
    ctx.strokeStyle = "rgba(120, 130, 150, 0.2)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }

  const xToPx = (x: number) => padLeft + ((x - map.bounds.minX) / map.bounds.spanX) * plotW;
  const yToPx = (y: number) => padTop + ((map.bounds.maxY - y) / map.bounds.spanY) * plotH;

  const pointPixels: ScreenPoint[] = [];
  if (showPoints) {
    map.points.forEach((point, index) => {
      const ratio = ratioOfZ(point.z, map.bounds.minZ, map.bounds.maxZ);
      const color = jetColor(ratio);
      const px = xToPx(point.x);
      const py = yToPx(point.y);
      pointPixels.push({ index, x: px, y: py });

      ctx.beginPath();
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.95)`;
      ctx.arc(px, py, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 0.7;
      ctx.arc(px, py, 2.8, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  if (showPoints && highlightedIndex !== null) {
    const active = pointPixels.find((point) => point.index === highlightedIndex);
    if (active) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(30, 64, 175, 0.95)";
      ctx.lineWidth = 2.2;
      ctx.arc(active.x, active.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = "rgba(30, 64, 175, 0.95)";
      ctx.arc(active.x, active.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = "rgba(40, 53, 75, 0.55)";
  ctx.lineWidth = 1.1;
  ctx.strokeRect(padLeft, padTop, plotW, plotH);

  return pointPixels;
};

const drawStatsFooter = (
  ctx: CanvasRenderingContext2D,
  stats: TopographyStats,
  width: number,
  y: number,
  rowGap = 26,
) => {
  const rows = buildStatsRows(stats);
  ctx.fillStyle = "rgba(248, 250, 252, 1)";
  ctx.fillRect(0, y - 18, width, rowGap * 2 + 34);

  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.font = "700 18px sans-serif";
  ctx.fillText("IBE Topography Metrics", 30, y + 2);

  ctx.font = "600 14px sans-serif";
  rows.forEach((row, index) => {
    const col = index % 4;
    const rowLine = Math.floor(index / 4);
    const x = 30 + col * ((width - 60) / 4);
    const yy = y + 30 + rowLine * rowGap;
    ctx.fillStyle = "rgba(71, 85, 105, 0.88)";
    ctx.fillText(row.label, x, yy);
    ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
    ctx.fillText(row.value, x, yy + 18);
  });
};

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode PNG."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });

const sanitizeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const inferDownloadDir = (platform: string) => {
  if (platform.toLowerCase().includes("windows")) {
    return "C:\\Users\\<you>\\Downloads";
  }
  if (platform.toLowerCase().includes("darwin")) {
    return "~/Downloads";
  }
  return "~/Downloads";
};

const createPngWithMetrics = async (
  map: ParsedIbeMap,
  grid: HeatGrid,
  stats: TopographyStats,
  showPoints: boolean,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1700;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to initialize export canvas.");
  }

  drawHeatField(ctx, map, grid, canvas.width, 980, EXPORT_LAYOUT, showPoints, null);

  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.font = "700 24px sans-serif";
  ctx.fillText(`Wafer Topography: ${map.fileName}`, 40, 1020);

  drawStatsFooter(ctx, stats, canvas.width, 1060, 28);

  return canvasToBlob(canvas);
};

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const concatBytes = (parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
};

const u16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value, true);
const u32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value >>> 0, true);

const buildLocalHeader = (nameLength: number, crc: number, size: number) => {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  u32(view, 0, 0x04034b50);
  u16(view, 4, 20);
  u16(view, 6, 0);
  u16(view, 8, 0);
  u16(view, 10, 0);
  u16(view, 12, 0);
  u32(view, 14, crc);
  u32(view, 18, size);
  u32(view, 22, size);
  u16(view, 26, nameLength);
  u16(view, 28, 0);
  return bytes;
};

const buildCentralHeader = (nameLength: number, crc: number, size: number, offset: number) => {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  u32(view, 0, 0x02014b50);
  u16(view, 4, 20);
  u16(view, 6, 20);
  u16(view, 8, 0);
  u16(view, 10, 0);
  u16(view, 12, 0);
  u16(view, 14, 0);
  u32(view, 16, crc);
  u32(view, 20, size);
  u32(view, 24, size);
  u16(view, 28, nameLength);
  u16(view, 30, 0);
  u16(view, 32, 0);
  u16(view, 34, 0);
  u16(view, 36, 0);
  u32(view, 38, 0);
  u32(view, 42, offset);
  return bytes;
};

const buildEndOfCentral = (fileCount: number, centralSize: number, centralOffset: number) => {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  u32(view, 0, 0x06054b50);
  u16(view, 4, 0);
  u16(view, 6, 0);
  u16(view, 8, fileCount);
  u16(view, 10, fileCount);
  u32(view, 12, centralSize);
  u32(view, 16, centralOffset);
  u16(view, 20, 0);
  return bytes;
};

const buildZip = (entries: PngEntry[]) => {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const fileCrc = crc32(entry.bytes);
    const localHeader = buildLocalHeader(nameBytes.length, fileCrc, entry.bytes.length);
    const centralHeader = buildCentralHeader(nameBytes.length, fileCrc, entry.bytes.length, localOffset);

    localParts.push(localHeader, nameBytes, entry.bytes);
    centralParts.push(centralHeader, nameBytes);

    localOffset += localHeader.length + nameBytes.length + entry.bytes.length;
  });

  const centralOffset = localOffset;
  const centralData = concatBytes(centralParts);
  const end = buildEndOfCentral(entries.length, centralData.length, centralOffset);

  return concatBytes([...localParts, centralData, end]);
};

const Heatmap2DPanel: React.FC<{
  map: ParsedIbeMap;
  grid: HeatGrid;
  stats: TopographyStats;
  hidePoints: boolean;
  onDownload: () => Promise<void>;
  isDownloading: boolean;
}> = ({ map, grid, stats, hidePoints, onDownload, isDownloading }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointPixelsRef = useRef<ScreenPoint[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const activeIndex = hidePoints ? null : selectedIndex ?? hoveredIndex;

  const activePayload = useMemo<PointPayload | null>(() => {
    if (activeIndex === null) {
      return null;
    }
    const point = map.points[activeIndex];
    const screen = pointPixelsRef.current.find((item) => item.index === activeIndex);
    if (!point || !screen) {
      return null;
    }
    return { index: activeIndex, point, x: screen.x, y: screen.y };
  }, [activeIndex, map.points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    pointPixelsRef.current = drawHeatField(
      ctx,
      map,
      grid,
      width,
      height,
      SCREEN_LAYOUT,
      !hidePoints,
      hidePoints ? null : activeIndex,
    );
  }, [activeIndex, grid, hidePoints, map]);

  useEffect(() => {
    if (hidePoints) {
      setHoveredIndex(null);
      setSelectedIndex(null);
    }
  }, [hidePoints]);

  const pickNearestIndex = (clientX: number, clientY: number) => {
    if (hidePoints) {
      return null;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let nearest: { index: number; dist: number } | null = null;
    pointPixelsRef.current.forEach((point) => {
      const dist = Math.hypot(point.x - x, point.y - y);
      if (dist > 10) {
        return;
      }
      if (!nearest || dist < nearest.dist) {
        nearest = { index: point.index, dist };
      }
    });

    return nearest?.index ?? null;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-foreground">{map.fileName}</h3>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 border-slate-200 bg-white/85 text-slate-600 hover:bg-slate-50"
          disabled={isDownloading}
          onClick={() => {
            void onDownload();
          }}
          title="Download PNG"
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_168px] gap-3">
        <div className="relative">
        <canvas
          ref={canvasRef}
          className="aspect-square w-full rounded-lg border border-slate-200 bg-slate-50/40"
          onMouseMove={(event) => setHoveredIndex(pickNearestIndex(event.clientX, event.clientY))}
          onMouseLeave={() => setHoveredIndex(null)}
          onClick={(event) => {
            const picked = pickNearestIndex(event.clientX, event.clientY);
            setSelectedIndex((prev) => (prev === picked ? null : picked));
          }}
        />

        {activePayload && !hidePoints && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-sky-200 bg-white/96 px-2 py-1 text-[11px] shadow-md"
            style={{
              left: `${clamp(activePayload.x + 10, 4, 280)}px`,
              top: `${clamp(activePayload.y - 56, 4, 320)}px`,
            }}
          >
            <div className="font-semibold text-slate-800">Point #{activePayload.index + 1}</div>
            <div className="text-slate-600">X: {fmt2(activePayload.point.x)}</div>
            <div className="text-slate-600">Y: {fmt2(activePayload.point.y)}</div>
            <div className="text-slate-600">Z: {fmt2(activePayload.point.z)}</div>
          </div>
        )}
        </div>

        <div className="flex h-full flex-col justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-[11px]">
          {buildStatsRows(stats).map((row) => (
            <div
              key={row.label}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/85 px-2 py-1"
            >
              <span className="text-slate-500">{row.label}</span>
              <span className="font-semibold text-slate-900">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Surface3D: React.FC<{ map: ParsedIbeMap | null; grid: HeatGrid | null }> = ({ map, grid }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#f1f6ff");
    bg.addColorStop(0.5, "#f8fbff");
    bg.addColorStop(1, "#f3f9ff");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (!map || !grid) {
      ctx.fillStyle = "rgba(71,85,105,0.9)";
      ctx.font = "600 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("拖拽 CSV 文件到页面后生成 3D 小山坡", width / 2, height / 2);
      return;
    }

    const centerX = width * 0.56;
    const centerY = height * 0.58;
    const waferRadius = Math.min(width, height) * 0.3;
    const scaleXY = waferRadius * 1.7 * camera.zoom;
    const zScale = Math.min(width, height) * 0.16;
    const baseDepth = 0.42;
    const sideSegments = 72;

    const project = (x: number, y: number, z: number) => {
      const cosY = Math.cos(camera.rotY);
      const sinY = Math.sin(camera.rotY);
      const cosX = Math.cos(camera.rotX);
      const sinX = Math.sin(camera.rotX);

      const rx = x * cosY + z * sinY;
      const rz = -x * sinY + z * cosY;

      const ry = y * cosX - rz * sinX;
      const rz2 = y * sinX + rz * cosX;

      const dist = 3.7;
      const perspective = dist / (dist + rz2 + 1.45);

      return {
        x: centerX + rx * scaleXY * perspective,
        y: centerY + ry * scaleXY * perspective,
        z: rz2,
      };
    };

    const cells: Array<{
      p0: { x: number; y: number; z: number };
      p1: { x: number; y: number; z: number };
      p2: { x: number; y: number; z: number };
      p3: { x: number; y: number; z: number };
      depth: number;
      color: RGB;
      shade: number;
    }> = [];

    const valueAt = (gx: number, gy: number) => grid.values[gy * grid.width + gx];

    const shadow = ctx.createRadialGradient(centerX, centerY + 28, 10, centerX, centerY + 28, Math.min(width, height) * 0.42);
    shadow.addColorStop(0, "rgba(15, 23, 42, 0.18)");
    shadow.addColorStop(1, "rgba(15, 23, 42, 0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(0, 0, width, height);

    for (let gy = 0; gy < grid.height - 1; gy += 1) {
      for (let gx = 0; gx < grid.width - 1; gx += 1) {
        const v00 = valueAt(gx, gy);
        const v10 = valueAt(gx + 1, gy);
        const v01 = valueAt(gx, gy + 1);
        const v11 = valueAt(gx + 1, gy + 1);
        if (![v00, v10, v01, v11].every(Number.isFinite)) {
          continue;
        }

        const nx0 = gx / (grid.width - 1) - 0.5;
        const nx1 = (gx + 1) / (grid.width - 1) - 0.5;
        const ny0 = gy / (grid.height - 1) - 0.5;
        const ny1 = (gy + 1) / (grid.height - 1) - 0.5;

        if (
          Math.hypot(nx0, ny0) > 0.52 &&
          Math.hypot(nx1, ny0) > 0.52 &&
          Math.hypot(nx0, ny1) > 0.52 &&
          Math.hypot(nx1, ny1) > 0.52
        ) {
          continue;
        }

        const z00 = (ratioOfZ(v00, grid.min, grid.max) - 0.5) * 0.56;
        const z10 = (ratioOfZ(v10, grid.min, grid.max) - 0.5) * 0.56;
        const z01 = (ratioOfZ(v01, grid.min, grid.max) - 0.5) * 0.56;
        const z11 = (ratioOfZ(v11, grid.min, grid.max) - 0.5) * 0.56;

        const p0 = project(nx0, -ny0, z00 / zScale);
        const p1 = project(nx1, -ny0, z10 / zScale);
        const p2 = project(nx1, -ny1, z11 / zScale);
        const p3 = project(nx0, -ny1, z01 / zScale);

        const avg = (v00 + v10 + v01 + v11) / 4;
        const color = jetColor(ratioOfZ(avg, grid.min, grid.max));

        const ux = p1.x - p0.x;
        const uy = p1.y - p0.y;
        const vx = p3.x - p0.x;
        const vy = p3.y - p0.y;
        const cross = ux * vy - uy * vx;
        const shade = clamp(0.8 + Math.sign(cross) * 0.13, 0.58, 1.02);

        cells.push({
          p0,
          p1,
          p2,
          p3,
          depth: (p0.z + p1.z + p2.z + p3.z) / 4,
          color,
          shade,
        });
      }
    }

    const sideFaces: Array<{
      p0: { x: number; y: number; z: number };
      p1: { x: number; y: number; z: number };
      p2: { x: number; y: number; z: number };
      p3: { x: number; y: number; z: number };
      depth: number;
      shade: number;
    }> = [];

    for (let index = 0; index < sideSegments; index += 1) {
      const a0 = (index / sideSegments) * Math.PI * 2;
      const a1 = ((index + 1) / sideSegments) * Math.PI * 2;
      const r = 0.52;
      const x0 = Math.cos(a0) * r;
      const y0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r;
      const y1 = Math.sin(a1) * r;
      const top0 = project(x0, -y0, 0.05);
      const top1 = project(x1, -y1, 0.05);
      const bottom1 = project(x1, -y1, -baseDepth);
      const bottom0 = project(x0, -y0, -baseDepth);
      const light = clamp(0.62 + Math.cos((a0 + a1) * 0.5 - camera.rotY) * 0.16, 0.42, 0.82);
      sideFaces.push({
        p0: top0,
        p1: top1,
        p2: bottom1,
        p3: bottom0,
        depth: (top0.z + top1.z + bottom1.z + bottom0.z) / 4,
        shade: light,
      });
    }

    sideFaces.sort((a, b) => a.depth - b.depth);
    cells.sort((a, b) => a.depth - b.depth);

    ctx.save();
    sideFaces.forEach((face) => {
      const gray = Math.round(118 * face.shade);
      ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, 0.95)`;
      ctx.beginPath();
      ctx.moveTo(face.p0.x, face.p0.y);
      ctx.lineTo(face.p1.x, face.p1.y);
      ctx.lineTo(face.p2.x, face.p2.y);
      ctx.lineTo(face.p3.x, face.p3.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(35,35,35,0.45)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    cells.forEach((cell) => {
      const rr = Math.round(cell.color.r * cell.shade);
      const gg = Math.round(cell.color.g * cell.shade);
      const bb = Math.round(cell.color.b * cell.shade);
      ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, 0.93)`;
      ctx.beginPath();
      ctx.moveTo(cell.p0.x, cell.p0.y);
      ctx.lineTo(cell.p1.x, cell.p1.y);
      ctx.lineTo(cell.p2.x, cell.p2.y);
      ctx.lineTo(cell.p3.x, cell.p3.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(45,55,72,0.25)";
      ctx.lineWidth = 0.4;
      ctx.stroke();
    });

    ctx.restore();

    const barX = 20;
    const barY = 96;
    const barW = 18;
    const barH = Math.min(height * 0.58, 270);
    const steps = 42;
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const color = jetColor(1 - t);
      const y = barY + (barH / steps) * i;
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(barX, y, barW, barH / steps + 1);
    }
    ctx.strokeStyle = "rgba(30,41,59,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = "rgba(30,41,59,0.84)";
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "left";
    for (let i = 0; i <= 6; i += 1) {
      const t = i / 6;
      const y = barY + barH * t;
      const value = grid.max - (grid.max - grid.min) * t;
      ctx.fillText(value.toFixed(2), barX + barW + 10, y + 4);
    }

    ctx.fillStyle = "rgba(30,41,59,0.82)";
    ctx.font = "600 12px sans-serif";
    ctx.fillText("Drag to rotate, wheel to zoom", 20, 28);
    ctx.fillText("6-inch wafer", 20, 48);
  }, [camera, map, grid]);

  return (
    <div className="rounded-2xl border border-input bg-card/85 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">3D Surface</h3>
          <p className="text-xs text-muted-foreground">{map?.fileName ?? "无可展示文件"}</p>
        </div>
        <Button size="sm" type="button" variant="outline" className="h-8" onClick={() => setCamera(DEFAULT_CAMERA)}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-[430px] w-full cursor-grab rounded-xl border border-input/80 bg-background/60 active:cursor-grabbing"
        onMouseDown={(event) => {
          dragRef.current = { active: true, x: event.clientX, y: event.clientY };
        }}
        onMouseMove={(event) => {
          if (!dragRef.current.active) {
            return;
          }
          const dx = event.clientX - dragRef.current.x;
          const dy = event.clientY - dragRef.current.y;
          dragRef.current = { active: true, x: event.clientX, y: event.clientY };

          setCamera((prev) => ({
            ...prev,
            rotY: clamp(prev.rotY + dx * 0.006, 0.24, 1.32),
            rotX: clamp(prev.rotX + dy * 0.006, -1.12, -0.38),
          }));
        }}
        onMouseUp={() => {
          dragRef.current.active = false;
        }}
        onMouseLeave={() => {
          dragRef.current.active = false;
        }}
        onWheel={(event) => {
          event.preventDefault();
          setCamera((prev) => ({
            ...prev,
            zoom: clamp(prev.zoom + (event.deltaY > 0 ? -0.05 : 0.05), 0.86, 1.68),
          }));
        }}
      />
    </div>
  );
};

const mergeMaps = (prev: ParsedIbeMap[], incoming: ParsedIbeMap[]) => {
  const merged = new Map(prev.map((map) => [map.id, map]));
  incoming.forEach((map) => {
    merged.set(map.id, map);
  });
  return Array.from(merged.values());
};

const IbeThicknessView: React.FC = () => {
  useAppTitle({ title: "Wafer Topography Studio" });

  const [maps, setMaps] = useState<ParsedIbeMap[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [runtimePlatform, setRuntimePlatform] = useState("darwin");
  const [draggingGlobal, setDraggingGlobal] = useState(false);
  const [hidePoints, setHidePoints] = useState(false);
  const [downloadingSingleId, setDownloadingSingleId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const dragDepthRef = useRef(0);

  const selectedMaps = useMemo(
    () => selectedIds.map((id) => maps.find((map) => map.id === id)).filter((map): map is ParsedIbeMap => Boolean(map)),
    [maps, selectedIds],
  );

  const grid2DMap = useMemo(() => {
    const entries = new Map<string, HeatGrid>();
    selectedMaps.forEach((map) => {
      entries.set(map.id, buildHeatGrid(map, GRID_2D));
    });
    return entries;
  }, [selectedMaps]);

  const statsMap = useMemo(() => {
    const entries = new Map<string, TopographyStats>();
    selectedMaps.forEach((map) => {
      entries.set(map.id, computeStats(map.points));
    });
    return entries;
  }, [selectedMaps]);

  const primaryMap = selectedMaps[0] ?? null;
  const grid3D = useMemo(() => (primaryMap ? buildHeatGrid(primaryMap, GRID_3D) : null), [primaryMap]);

  useEffect(() => {
    void Environment()
      .then((info) => setRuntimePlatform(info.platform || "darwin"))
      .catch(() => setRuntimePlatform("darwin"));
  }, []);

  useEffect(() => {
    setSelectedIds((prev) => {
      const available = new Set(maps.map((map) => map.id));
      const kept = prev.filter((id) => available.has(id));
      if (kept.length > 0) {
        return kept;
      }
      if (maps.length > 0) {
        return [maps[0].id];
      }
      return [];
    });
  }, [maps]);

  const handleFilesDrop = async (files: File[]) => {
    const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
    if (csvFiles.length === 0) {
      setError("仅支持 CSV 文件上传。");
      return;
    }

    setLoading(true);
    setError("");

    const results = await Promise.allSettled(csvFiles.map((file) => parseIbeCsv(file)));
    const successMaps = results
      .filter((result): result is PromiseFulfilledResult<ParsedIbeMap> => result.status === "fulfilled")
      .map((result) => result.value);
    const failedMessages = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : "Failed to parse CSV file."));

    if (successMaps.length > 0) {
      setMaps((prev) => mergeMaps(prev, successMaps));
    }

    if (failedMessages.length > 0) {
      setError(failedMessages.join("; "));
    }

    setLoading(false);
  };

  useEffect(() => {
    const hasFilePayload = (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      return types.includes("Files");
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      setDraggingGlobal(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDraggingGlobal(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = 0;
      setDraggingGlobal(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) {
        void handleFilesDrop(files);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  const handleDownloadSingle = async (map: ParsedIbeMap) => {
    const grid = grid2DMap.get(map.id);
    const stats = statsMap.get(map.id);
    if (!grid || !stats) {
      return;
    }

    try {
      setDownloadingSingleId(map.id);
      const fileName = `${sanitizeName(map.fileName.replace(/\.csv$/i, ""))}_topography.png`;
      const blob = await createPngWithMetrics(map, grid, stats, !hidePoints);
      downloadBlob(blob, fileName);
      setDownloadNotice(`Saved to ${inferDownloadDir(runtimePlatform)} / ${fileName}`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Failed to download PNG.");
    } finally {
      setDownloadingSingleId(null);
    }
  };

  const handleDownloadAll = async () => {
    if (selectedMaps.length === 0 || downloadingAll) {
      return;
    }

    try {
      setDownloadingAll(true);
      const entries: PngEntry[] = [];
      for (const map of selectedMaps) {
        const grid = grid2DMap.get(map.id);
        const stats = statsMap.get(map.id);
        if (!grid || !stats) {
          continue;
        }
        const blob = await createPngWithMetrics(map, grid, stats, !hidePoints);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        entries.push({
          name: `${sanitizeName(map.fileName.replace(/\.csv$/i, ""))}_topography.png`,
          bytes,
        });
      }

      if (entries.length === 0) {
        setError("No valid maps available for download.");
        return;
      }

      const zipBytes = buildZip(entries);
      const zipName = "ibe-topography-maps.zip";
      downloadBlob(new Blob([zipBytes], { type: "application/zip" }), zipName);
      setDownloadNotice(`Saved to ${inferDownloadDir(runtimePlatform)} / ${zipName}`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Failed to generate ZIP package.");
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1580px] flex-col gap-5 p-6">
      {draggingGlobal && (
        <div className="pointer-events-none absolute inset-4 z-20 rounded-2xl border-2 border-dashed border-primary bg-primary/10" />
      )}

      <div className="rounded-2xl border border-input bg-card/90 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Data Input</h2>
        <p className="mt-2 text-xs text-muted-foreground">将 CSV 文件拖拽到页面任意位置即可上传，支持一次拖入多个文件。</p>
        {loading && <p className="mt-2 text-xs text-muted-foreground">Parsing file...</p>}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        {downloadNotice && <p className="mt-2 text-xs text-sky-700">{downloadNotice}</p>}
      </div>

      <div className="rounded-2xl border border-input bg-card/90 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">2D Heat Maps</h2>
            <p className="text-xs text-muted-foreground">Selected {selectedMaps.length} files, multi-panel adaptive layout</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={hidePoints ? "default" : "outline"}
              className={cn(
                "h-8 rounded-lg px-3 text-xs",
                hidePoints
                  ? "bg-slate-700 text-white hover:bg-slate-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
              onClick={() => setHidePoints((prev) => !prev)}
            >
              Hide Points
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 border-sky-300 text-sky-700 hover:bg-sky-50"
              onClick={() => {
                void handleDownloadAll();
              }}
              disabled={downloadingAll || selectedMaps.length === 0}
              title="Download all selected maps"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {maps.length === 0 && <p className="text-xs text-muted-foreground">暂无文件，先拖拽 CSV 文件到页面。</p>}
          {maps.map((map, index) => {
            const selected = selectedIds.includes(map.id);
            return (
              <Button
                key={map.id}
                size="sm"
                variant="outline"
                className={cn(
                  "h-9 rounded-xl border px-3 text-xs shadow-sm transition",
                  selected
                    ? FILE_BUTTON_THEMES[index % FILE_BUTTON_THEMES.length]
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
                onClick={() => {
                  setSelectedIds((prev) => {
                    if (prev.includes(map.id)) {
                      const filtered = prev.filter((id) => id !== map.id);
                      return filtered.length > 0 ? filtered : prev;
                    }
                    return [...prev, map.id];
                  });
                }}
              >
                <span className="max-w-[230px] truncate">{map.fileName}</span>
              </Button>
            );
          })}
        </div>

        {selectedMaps.length === 0 && <p className="text-xs text-muted-foreground">请先选择至少一个文件用于 2D 展示。</p>}
        {selectedMaps.length > 0 && (
          <div className="grid grid-cols-1 gap-4">
            {selectedMaps.map((map) => {
              const grid = grid2DMap.get(map.id);
              const stats = statsMap.get(map.id);
              if (!grid || !stats) {
                return null;
              }
              return (
                <Heatmap2DPanel
                  key={map.id}
                  map={map}
                  grid={grid}
                  stats={stats}
                  hidePoints={hidePoints}
                  isDownloading={downloadingSingleId === map.id}
                  onDownload={() => handleDownloadSingle(map)}
                />
              );
            })}
          </div>
        )}
      </div>

      <Surface3D map={primaryMap} grid={grid3D} />
    </div>
  );
};

export default IbeThicknessView;

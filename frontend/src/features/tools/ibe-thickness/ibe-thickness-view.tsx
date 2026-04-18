import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTitle } from "@/components/layout/app-title-context";
import { Button } from "@/components/ui/button";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { cn } from "@/lib/utils";
import { RotateCcw, Upload } from "lucide-react";

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

const EPSILON = 1e-6;
const GRID_2D = 170;
const GRID_3D = 64;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const Heatmap2D: React.FC<{ map: ParsedIbeMap | null; grid: HeatGrid | null }> = ({ map, grid }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#e7f8f1");
    background.addColorStop(0.5, "#f5f8eb");
    background.addColorStop(1, "#f9ecdf");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    if (!map || !grid) {
      ctx.fillStyle = "rgba(71,85,105,0.92)";
      ctx.font = "600 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Upload IBE CSV to generate a 2D heat map", width / 2, height / 2);
      return;
    }

    const padLeft = 52;
    const padRight = 30;
    const padTop = 26;
    const padBottom = 42;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const imageData = ctx.createImageData(grid.width, grid.height);
    for (let i = 0; i < grid.values.length; i += 1) {
      const v = grid.values[i];
      const pixel = i * 4;
      if (!Number.isFinite(v)) {
        imageData.data[pixel + 3] = 0;
        continue;
      }
      const color = jetColor(ratioOfZ(v, grid.min, grid.max));
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
      return;
    }
    offCtx.putImageData(imageData, 0, 0);

    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.drawImage(offscreen, padLeft, padTop, plotW, plotH);
    ctx.restore();

    const waferRadius = Math.min(plotW, plotH) * 0.48;
    ctx.strokeStyle = "rgba(105, 120, 100, 0.44)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(padLeft + plotW / 2, padTop + plotH / 2, waferRadius, 0, Math.PI * 2);
    ctx.stroke();

    for (let t = 0; t <= 7; t += 1) {
      const y = padTop + (plotH / 7) * t;
      ctx.strokeStyle = "rgba(120, 130, 150, 0.2)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
    }
    for (let t = 0; t <= 7; t += 1) {
      const x = padLeft + (plotW / 7) * t;
      ctx.strokeStyle = "rgba(120, 130, 150, 0.2)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
    }

    const xToPx = (x: number) => padLeft + ((x - map.bounds.minX) / map.bounds.spanX) * plotW;
    const yToPx = (y: number) => padTop + ((map.bounds.maxY - y) / map.bounds.spanY) * plotH;

    map.points.forEach((point) => {
      const ratio = ratioOfZ(point.z, map.bounds.minZ, map.bounds.maxZ);
      const color = jetColor(ratio);
      const px = xToPx(point.x);
      const py = yToPx(point.y);
      ctx.beginPath();
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.95)`;
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 0.8;
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(40, 53, 75, 0.55)";
    ctx.lineWidth = 1.1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    ctx.fillStyle = "rgba(39,53,75,0.82)";
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${grid.max.toFixed(4)} max`, padLeft + 6, padTop + 14);
    ctx.textAlign = "right";
    ctx.fillText(`${grid.min.toFixed(4)} min`, padLeft + plotW - 6, padTop + 14);
  }, [map, grid]);

  return (
    <div className="rounded-2xl border border-input bg-card/85 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">2D Heat Map</h3>
          <p className="text-xs text-muted-foreground">Wafer thickness contour style</p>
        </div>
      </div>
      <canvas ref={canvasRef} className="h-[430px] w-full rounded-xl border border-input/80 bg-background/60" />
    </div>
  );
};

const Surface3D: React.FC<{ map: ParsedIbeMap | null; grid: HeatGrid | null }> = ({ map, grid }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const [camera, setCamera] = useState<Camera>({ rotX: -0.92, rotY: 0.72, zoom: 1.15 });

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
    bg.addColorStop(0, "#e6f0ff");
    bg.addColorStop(0.45, "#f4f8ff");
    bg.addColorStop(1, "#edf6ff");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (!map || !grid) {
      ctx.fillStyle = "rgba(71,85,105,0.9)";
      ctx.font = "600 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Upload IBE CSV to generate a 3D surface", width / 2, height / 2);
      return;
    }

    const centerX = width * 0.5;
    const centerY = height * 0.52;
    const scaleXY = Math.min(width, height) * 0.33 * camera.zoom;
    const zScale = Math.min(width, height) * 0.25;

    const project = (x: number, y: number, z: number) => {
      const cosY = Math.cos(camera.rotY);
      const sinY = Math.sin(camera.rotY);
      const cosX = Math.cos(camera.rotX);
      const sinX = Math.sin(camera.rotX);

      const rx = x * cosY + z * sinY;
      const rz = -x * sinY + z * cosY;

      const ry = y * cosX - rz * sinX;
      const rz2 = y * sinX + rz * cosX;

      const dist = 3.3;
      const perspective = dist / (dist + rz2 + 1.6);

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

        const z00 = ratioOfZ(v00, grid.min, grid.max) * zScale;
        const z10 = ratioOfZ(v10, grid.min, grid.max) * zScale;
        const z01 = ratioOfZ(v01, grid.min, grid.max) * zScale;
        const z11 = ratioOfZ(v11, grid.min, grid.max) * zScale;

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
        const shade = clamp(0.78 + Math.sign(cross) * 0.14, 0.55, 1.05);

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

    cells.sort((a, b) => a.depth - b.depth);

    ctx.save();
    ctx.strokeStyle = "rgba(35,57,95,0.34)";
    ctx.lineWidth = 1;

    const baseA = project(-0.55, 0.55, 0);
    const baseB = project(0.55, 0.55, 0);
    const baseC = project(0.55, -0.55, 0);
    const baseD = project(-0.55, -0.55, 0);

    ctx.beginPath();
    ctx.moveTo(baseA.x, baseA.y);
    ctx.lineTo(baseB.x, baseB.y);
    ctx.lineTo(baseC.x, baseC.y);
    ctx.lineTo(baseD.x, baseD.y);
    ctx.closePath();
    ctx.stroke();

    cells.forEach((cell) => {
      const rr = Math.round(cell.color.r * cell.shade);
      const gg = Math.round(cell.color.g * cell.shade);
      const bb = Math.round(cell.color.b * cell.shade);
      ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, 0.92)`;
      ctx.beginPath();
      ctx.moveTo(cell.p0.x, cell.p0.y);
      ctx.lineTo(cell.p1.x, cell.p1.y);
      ctx.lineTo(cell.p2.x, cell.p2.y);
      ctx.lineTo(cell.p3.x, cell.p3.y);
      ctx.closePath();
      ctx.fill();
    });

    ctx.restore();

    ctx.fillStyle = "rgba(30, 41, 59, 0.84)";
    ctx.font = "600 12px sans-serif";
    ctx.fillText("X", baseC.x + 10, baseC.y + 4);
    ctx.fillText("Y", baseD.x - 14, baseD.y + 14);
    ctx.fillText("Z", baseA.x - 12, baseA.y - 10);
    ctx.fillText("Drag to rotate, wheel to zoom", 16, 24);
  }, [camera, map, grid]);

  return (
    <div className="rounded-2xl border border-input bg-card/85 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">3D Surface</h3>
          <p className="text-xs text-muted-foreground">Interactive topography view</p>
        </div>
        <Button
          size="sm"
          type="button"
          variant="outline"
          className="h-8"
          onClick={() => setCamera({ rotX: -0.92, rotY: 0.72, zoom: 1.15 })}
        >
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
            rotY: prev.rotY + dx * 0.012,
            rotX: clamp(prev.rotX + dy * 0.01, -1.45, -0.08),
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
            zoom: clamp(prev.zoom + (event.deltaY > 0 ? -0.06 : 0.06), 0.72, 2.2),
          }));
        }}
      />
    </div>
  );
};

const IbeThicknessView: React.FC = () => {
  useAppTitle({ title: "Wafer Topography Studio" });

  const [map, setMap] = useState<ParsedIbeMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const grid2D = useMemo(() => (map ? buildHeatGrid(map, GRID_2D) : null), [map]);
  const grid3D = useMemo(() => (map ? buildHeatGrid(map, GRID_3D) : null), [map]);

  const handleFile = async (file: File) => {
    setLoading(true);
    setError("");
    try {
      setMap(await parseIbeCsv(file));
    } catch (err) {
      setMap(null);
      setError(err instanceof Error ? err.message : "Failed to parse CSV file.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1450px] flex-col gap-5 p-6">
      <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-r from-[#eefaf4] via-[#f8fbf2] to-[#fdf2e7] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-700">WAFER THICKNESS ANALYTICS</p>
            <h1 className="mt-1 text-[28px] font-semibold text-slate-800">Wafer Topography Studio</h1>
            <p className="mt-1 text-sm text-slate-600">2D heat map and interactive 3D surface reconstructed from IBE X/Y/Z data.</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-white/80 px-4 py-2 text-xs text-slate-600">
            Recommended sample: /Users/xuzein/Documents/tmp/P001742-12.csv
          </div>
        </div>
      </div>

      <div className="grid h-full min-h-0 grid-cols-1 gap-5 xl:grid-cols-[320px_1fr]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="rounded-2xl border border-input bg-card/90 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Data Input</h2>
              <Upload className="h-4 w-4 text-muted-foreground" />
            </div>
            <FileDropZone
              accept={[".csv"]}
              maxFiles={1}
              uploadedFiles={map ? [{ name: map.fileName }] : []}
              onFilesDrop={(files) => {
                if (files[0]) {
                  void handleFile(files[0]);
                }
              }}
              className={cn("cursor-pointer", loading && "pointer-events-none opacity-75")}
            />
            {loading && <p className="mt-2 text-xs text-muted-foreground">Parsing file...</p>}
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>

          <div className="rounded-2xl border border-input bg-card/90 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">Overview</h2>
            {!map && <p className="mt-2 text-xs text-muted-foreground">Upload an IBE CSV to preview statistics.</p>}
            {map && (
              <div className="mt-3 space-y-2 text-xs">
                <div className="rounded-lg bg-muted/55 px-3 py-2 text-muted-foreground">File: <span className="text-foreground">{map.fileName}</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/55 px-3 py-2">
                    <div className="text-muted-foreground">Points</div>
                    <div className="mt-1 font-semibold text-foreground">{map.points.length}</div>
                  </div>
                  <div className="rounded-lg bg-muted/55 px-3 py-2">
                    <div className="text-muted-foreground">Pitch</div>
                    <div className="mt-1 font-semibold text-foreground">{map.pointPitch.toFixed(3)}</div>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/55 px-3 py-2 text-muted-foreground">
                  Z range: <span className="font-medium text-foreground">{map.bounds.minZ.toFixed(4)} - {map.bounds.maxZ.toFixed(4)}</span>
                </div>
                <div className="h-3 rounded-full" style={{ background: "linear-gradient(90deg, #0f52ff, #07d3ff, #8be44d, #ffd84e, #ff4329)" }} />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-1 gap-5 xl:grid-cols-2">
          <Heatmap2D map={map} grid={grid2D} />
          <Surface3D map={map} grid={grid3D} />
        </div>
      </div>
    </div>
  );
};

export default IbeThicknessView;

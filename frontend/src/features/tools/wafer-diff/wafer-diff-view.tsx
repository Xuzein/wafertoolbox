import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTitle } from "@/components/layout/app-title-context";
import { ClipboardSetText } from "@wailsjs/runtime/runtime";
import { Download, FileText, Loader2, Upload, X } from "lucide-react";
import type { ParsedAoiWaferMap } from "../wafer-overlay/wafer-overlay-types";
import {
  buildDiffWaferMap,
  downloadWaferMapPng,
  parseAoiWaferFile,
  validateMapsForDiff,
} from "../wafer-overlay/wafer-overlay-utils";
import { WaferMapSvg } from "../wafer-overlay/wafer-map-svg";

type WaferDiffViewCache = {
  diffMode: "strict" | "ignore-empty";
  showSame: boolean;
  showDiff: boolean;
  maps: ParsedAoiWaferMap[];
};

const defaultWaferDiffViewCache: WaferDiffViewCache = {
  diffMode: "strict",
  showSame: true,
  showDiff: true,
  maps: [],
};

let waferDiffViewCache: WaferDiffViewCache = defaultWaferDiffViewCache;

const WaferDiffView: React.FC = () => {
  useAppTitle({ title: "AOI Map Gap" });

  const [diffMode, setDiffMode] = useState<"strict" | "ignore-empty">(waferDiffViewCache.diffMode);
  const [showSame, setShowSame] = useState(waferDiffViewCache.showSame);
  const [showDiff, setShowDiff] = useState(waferDiffViewCache.showDiff);
  const [maps, setMaps] = useState<ParsedAoiWaferMap[]>(waferDiffViewCache.maps);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeDiffCellKey, setActiveDiffCellKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    waferDiffViewCache = {
      diffMode,
      showSame,
      showDiff,
      maps,
    };
  }, [diffMode, showSame, showDiff, maps]);

  const diffMap = useMemo(() => {
    if (maps.length !== 2) {
      return null;
    }
    return buildDiffWaferMap(maps[0], maps[1], {
      ignoreEmptyMismatch: diffMode === "ignore-empty",
    });
  }, [maps, diffMode]);

  useEffect(() => {
    if (maps.length !== 2) {
      return;
    }
    setNotice(`已按${diffMode === "strict" ? "严格模式" : "忽略空位 Gap"}重新计算`);
  }, [diffMode, maps.length]);

  useEffect(() => {
    if (!isRecomputing) {
      return;
    }
    const frame = window.requestAnimationFrame(() => setIsRecomputing(false));
    return () => window.cancelAnimationFrame(frame);
  }, [isRecomputing, diffMode, showSame, showDiff, maps.length]);

  const runRecompute = (fn: () => void) => {
    setIsRecomputing(true);
    window.setTimeout(() => {
      fn();
    }, 0);
  };

  const diffPoints = useMemo(() => {
    if (!diffMap || maps.length !== 2) {
      return [];
    }
    const leftMap = maps[0];
    const rightMap = maps[1];
    const points: Array<{
      serial: number;
      cellKey: string;
      rowIndex: number;
      colIndex: number;
      row: number;
      col: number;
      x: number;
      y: number;
      offsetXDie: number;
      offsetYDie: number;
      offsetXMM: number;
      offsetYMM: number;
      leftState: string;
      rightState: string;
    }> = [];

    const centerX = diffMap.center.x;
    const centerY = diffMap.center.y;
    const xPitch = diffMap.xDies > 0 ? diffMap.xDies : 1;
    const yPitch = diffMap.yDies > 0 ? diffMap.yDies : 1;

    for (let rowIndex = 0; rowIndex < diffMap.rowCount; rowIndex += 1) {
      for (let colIndex = 0; colIndex < diffMap.colCount; colIndex += 1) {
        if (diffMap.grid[rowIndex][colIndex] !== "fail") {
          continue;
        }
        const yFromBottom = diffMap.rowCount - 1 - rowIndex;
        const offsetXDie = colIndex - centerX;
        const offsetYDie = yFromBottom - centerY;
        const serial = points.length + 1;
        points.push({
          serial,
          cellKey: `${rowIndex}-${colIndex}`,
          rowIndex,
          colIndex,
          row: rowIndex + 1,
          col: colIndex + 1,
          x: colIndex + 1,
          y: rowIndex + 1,
          offsetXDie,
          offsetYDie,
          offsetXMM: offsetXDie * xPitch,
          offsetYMM: offsetYDie * yPitch,
          leftState: leftMap.grid[rowIndex][colIndex],
          rightState: rightMap.grid[rowIndex][colIndex],
        });
      }
    }

    return points;
  }, [diffMap, maps]);

  const visibleMap = useMemo(() => {
    if (!diffMap) {
      return null;
    }
    let passCount = 0;
    let failCount = 0;
    const grid = diffMap.grid.map((row) =>
      row.map((state) => {
        if (state === "pass" && !showSame) {
          return "empty";
        }
        if (state === "fail" && !showDiff) {
          return "empty";
        }
        if (state === "pass") {
          passCount += 1;
        } else if (state === "fail") {
          failCount += 1;
        }
        return state;
      }),
    );
    return {
      ...diffMap,
      grid,
      passCount,
      failCount,
      validCount: passCount + failCount,
      yieldText: passCount + failCount > 0 ? (passCount / (passCount + failCount)).toFixed(4) : "0",
    };
  }, [diffMap, showSame, showDiff]);

  const visibleDiffPoints = useMemo(() => {
    if (!showDiff) {
      return [];
    }
    return diffPoints;
  }, [diffPoints, showDiff]);

  const diffPointLabelMap = useMemo(() => {
    const labels: Record<string, string> = {};
    visibleDiffPoints.slice(0, 999).forEach((point) => {
      labels[point.cellKey] = `${point.serial}`;
    });
    return labels;
  }, [visibleDiffPoints]);

  useEffect(() => {
    if (!activeDiffCellKey) {
      return;
    }
    if (diffPointLabelMap[activeDiffCellKey]) {
      return;
    }
    setActiveDiffCellKey(null);
  }, [activeDiffCellKey, diffPointLabelMap]);

  const filterTextFiles = (files: FileList | File[]): File[] => {
    return Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".txt"));
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setError("");
    setNotice("");
    setCopyHint("");

    if (maps.length + files.length > 2) {
      setError("该工具仅支持 2 个 AOI txt 文件对比，请先删除后再上传");
      return;
    }

    setIsLoading(true);
    try {
      const parsedMaps = await Promise.all(files.map((file) => parseAoiWaferFile(file)));
      const nextMaps = [...maps];

      for (const map of parsedMaps) {
        if (nextMaps.some((item) => item.fileName === map.fileName)) {
          throw new Error(`文件已存在：${map.fileName}`);
        }

        if (nextMaps.length === 1) {
          const mismatch = validateMapsForDiff(nextMaps[0], map);
          if (mismatch) {
            throw new Error(`${map.fileName} 无法参与 Gap 对比，${mismatch}`);
          }
        }

        nextMaps.push(map);
      }

      setMaps(nextMaps);
      if (nextMaps.length === 2) {
        setNotice("已生成 AOI Gap 图");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败，请检查文件格式");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = filterTextFiles(event.target.files ?? []);
    if (files.length === 0) {
      setError("仅支持 .txt 文件");
      return;
    }
    void addFiles(files);
    event.target.value = "";
  };

  const handleRemove = (fileName: string) => {
    setMaps((prev) => prev.filter((map) => map.fileName !== fileName));
    setActiveDiffCellKey(null);
    setNotice("");
    setError("");
    setCopyHint("");
  };

  const handleClear = () => {
    setMaps([]);
    setActiveDiffCellKey(null);
    setNotice("");
    setError("");
    setCopyHint("");
  };

  const isFileDragEvent = (event: React.DragEvent<HTMLDivElement>): boolean => {
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

    const files = filterTextFiles(event.dataTransfer.files);
    if (files.length === 0) {
      setError("仅支持拖拽 .txt AOI 文件");
      return;
    }

    void addFiles(files);
  };

  const handleDownload = async () => {
    if (!diffMap || isDownloading) {
      return;
    }

    setIsDownloading(true);
    setError("");
    setCopyHint("");

    try {
      const saved = await downloadWaferMapPng(diffMap, {
        fileName: `aoi-map-gap-${diffMap.waferId}.png`,
        maxImageSize: 2800,
        requireSavedPath: true,
        backgroundColor: "#f4f4f4",
        passColor: "#ffffff",
        failColor: "#2563eb",
        borderColor: "#d9d9d9",
        axisColor: "#737373",
        circleColor: "#111111",
        centerColor: "#111111",
      });
      if (saved) {
        setSavedPath(saved);
        setIsSaveDialogOpen(true);
        setNotice(`已保存: ${saved}`);
      } else {
        setNotice("已触发下载");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败，请稍后重试");
      setNotice("");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyPath = async () => {
    if (!savedPath) {
      return;
    }
    const ok = await ClipboardSetText(savedPath);
    setCopyHint(ok ? "已复制路径" : "复制失败");
  };

  const handleExportDiffPoints = () => {
    if (visibleDiffPoints.length === 0 || maps.length !== 2) {
      return;
    }
    const lines = [
      `LOT:${maps[0].lot}`,
      `WAFER:${maps[0].wafer}`,
      `MODE:${diffMode}`,
      `LEFT:${maps[0].fileName}`,
      `RIGHT:${maps[1].fileName}`,
      `TOTAL_DIFF:${visibleDiffPoints.length}`,
      `CENTER_X:${diffMap?.center.x.toFixed(4) ?? "0"}`,
      `CENTER_Y:${diffMap?.center.y.toFixed(4) ?? "0"}`,
      `XDIES_MM:${(diffMap?.xDies ?? 0).toFixed(6)}`,
      `YDIES_MM:${(diffMap?.yDies ?? 0).toFixed(6)}`,
      "ROW,COL,X,Y,DX_DIE,DY_DIE,DX_MM,DY_MM,LEFT,RIGHT",
      ...visibleDiffPoints.map(
        (item) =>
          `${item.row},${item.col},${item.x},${item.y},${item.offsetXDie.toFixed(4)},${item.offsetYDie.toFixed(4)},${item.offsetXMM.toFixed(4)},${item.offsetYMM.toFixed(4)},${item.leftState},${item.rightState}`,
      ),
    ];
    const content = `${lines.join("\n")}\n`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aoi-map-gap-points-${maps[0].waferId}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const sameRate =
    visibleMap && visibleMap.validCount > 0
      ? `${((visibleMap.passCount / visibleMap.validCount) * 100).toFixed(2)}%`
      : "0.00%";

  return (
    <div
      className="relative flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85">
          <div className="rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm">
            松开鼠标，开始生成 AOI Gap 图
          </div>
        </div>
      )}

      <div className="shrink-0 rounded-lg border border-input bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 border border-chart-2/30 bg-chart-2 text-white hover:bg-chart-2/90"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            上传 AOI txt
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <div className="text-xs text-muted-foreground">
            仅支持 2 个文件，上传后自动生成六寸 wafer Gap 图
          </div>

          {maps.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="ml-auto h-7 px-2 text-xs text-muted-foreground"
            >
              清空
            </Button>
          )}
        </div>

        <div className="mt-3 rounded-md border border-input bg-background p-2">
          <div className="mb-2 text-xs text-muted-foreground">Gap 规则</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={diffMode === "strict" ? "default" : "outline"}
              className={cn(
                "h-7 text-xs",
                diffMode === "strict"
                  ? "border border-chart-2/30 bg-chart-2 text-white hover:bg-chart-2/90"
                  : "border-chart-2/30 text-chart-2 hover:bg-chart-2/12 hover:text-chart-2",
              )}
              disabled={isRecomputing}
              onClick={() => {
                if (diffMode === "strict") {
                  return;
                }
                runRecompute(() => setDiffMode("strict"));
              }}
            >
              严格模式
            </Button>
            <Button
              type="button"
              size="sm"
              variant={diffMode === "ignore-empty" ? "default" : "outline"}
              className={cn(
                "h-7 text-xs",
                diffMode === "ignore-empty"
                  ? "border border-chart-2/30 bg-chart-2 text-white hover:bg-chart-2/90"
                  : "border-chart-2/30 text-chart-2 hover:bg-chart-2/12 hover:text-chart-2",
              )}
              disabled={isRecomputing}
              onClick={() => {
                if (diffMode === "ignore-empty") {
                  return;
                }
                runRecompute(() => setDiffMode("ignore-empty"));
              }}
            >
              忽略空位 Gap
            </Button>
            <div className="self-center text-xs text-muted-foreground">
              {diffMode === "strict"
                ? "任一位置状态不同即判定为 Gap"
                : "若任一侧为空位则不计入 Gap"}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {maps.length === 0 ? (
            <div className="text-sm text-muted-foreground">请上传 2 个 AOI txt 文件</div>
          ) : (
            maps.map((map, index) => (
              <div
                key={map.fileName}
                className="group flex items-center gap-1.5 rounded-full border border-input bg-background px-3 py-1 text-xs"
              >
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-input bg-card px-1 leading-none text-foreground">
                  {index + 1}
                </span>
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-[240px] truncate text-foreground">{map.fileName}</span>
                <span className="text-muted-foreground">({map.waferId})</span>
                <button
                  onClick={() => handleRemove(map.fileName)}
                  className="rounded-full p-0.5 text-muted-foreground opacity-70 transition-colors hover:bg-muted hover:text-foreground"
                  title="删除"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {isLoading && <div className="mt-2 text-xs text-muted-foreground">正在解析文件...</div>}
        {isRecomputing && (
          <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在计算结果...
          </div>
        )}
        {notice && <div className="mt-2 text-xs text-[var(--success)]">{notice}</div>}
        {error && (
          <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Wafer Gap 图</h3>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              title="下载 Gap 图"
              onClick={() => void handleDownload()}
              disabled={!diffMap || isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {visibleMap ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-input bg-background p-3">
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-xs text-foreground">
                <button
                  type="button"
                  onClick={() => {
                    if (showSame && !showDiff) {
                      return;
                    }
                    runRecompute(() => setShowSame((prev) => !prev));
                  }}
                  disabled={isRecomputing}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors ${
                    showSame
                      ? "border-input bg-background text-foreground"
                      : "border-input bg-muted text-muted-foreground"
                  }`}
                  title="显示/隐藏一致点"
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-sm border border-input ${
                      showSame ? "bg-[var(--wafer-diff-same)]" : "bg-muted"
                    }`}
                  />
                  <span>一致</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (showDiff && !showSame) {
                      return;
                    }
                    runRecompute(() => setShowDiff((prev) => !prev));
                  }}
                  disabled={isRecomputing}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors ${
                    showDiff
                      ? "border-input bg-background text-foreground"
                      : "border-input bg-muted text-muted-foreground"
                  }`}
                  title="显示/隐藏 Gap 点"
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-sm border border-input ${
                      showDiff ? "bg-[var(--wafer-diff-diff)]" : "bg-muted"
                    }`}
                  />
                  <span>Gap</span>
                </button>
                <div className="text-muted-foreground">白色=无Gap，蓝色=Gap点</div>
                <div className="text-muted-foreground">蓝点编号与右侧 Gap 坐标列表对应</div>
              </div>
              <div className="relative min-h-0 flex-1">
                <WaferMapSvg
                  map={visibleMap}
                  cellLabels={diffPointLabelMap}
                  highlightedCellKey={activeDiffCellKey}
                  palette={{
                    passFill: "var(--wafer-diff-same)",
                    failFill: "var(--wafer-diff-diff)",
                    backgroundFill: "var(--muted)",
                    borderStroke: "var(--border)",
                    axisStroke: "var(--muted-foreground)",
                    circleStroke: "var(--primary)",
                    centerFill: "var(--primary)",
                  }}
                />
                {isRecomputing && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/65">
                    <div className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-xs text-foreground shadow-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      计算中...
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              上传 2 个 AOI txt 后自动生成 Gap 图
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Gap 统计</h3>
          {diffMap ? (
            <div className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-auto pr-1">
              <div className="rounded-lg border border-input bg-background p-3">
                <div className="text-xs text-muted-foreground">对比片号</div>
                <div className="mt-1 text-sm font-medium text-foreground">{visibleMap.waferId}</div>
              </div>
              <div className="rounded-lg border border-input bg-background p-3">
                <div className="text-xs text-muted-foreground">一致率</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{sameRate}</div>
              </div>
              <div className="rounded-lg border border-input bg-background p-3">
                <div className="text-xs text-muted-foreground">一致 / Gap</div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-foreground">{visibleMap.passCount}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-[var(--wafer-diff-diff)]">{visibleMap.failCount}</span>
                </div>
              </div>
              <div className="rounded-lg border border-input bg-background p-3">
                <div className="mb-2 text-xs text-muted-foreground">Gap 点坐标</div>
                <div className="mb-2 text-sm text-foreground">{visibleDiffPoints.length} 个</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleExportDiffPoints}
                  disabled={visibleDiffPoints.length === 0}
                >
                  下载 Gap 坐标
                </Button>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  X/Y 为矩阵坐标（从左上角 1 开始）；dX/dY 为相对 wafer 中心偏移（mm，Y 正方向向上）。
                </div>
                <div className="hide-scrollbar mt-2 max-h-44 overflow-auto rounded-md border border-input bg-card p-2 text-xs">
                  {visibleDiffPoints.length === 0 ? (
                    <div className="text-muted-foreground">无 Gap 点</div>
                  ) : (
                    visibleDiffPoints.slice(0, 20).map((item) => (
                      <button
                        key={`${item.rowIndex}-${item.colIndex}`}
                        type="button"
                        onMouseEnter={() => setActiveDiffCellKey(item.cellKey)}
                        onMouseLeave={() => setActiveDiffCellKey(null)}
                        onFocus={() => setActiveDiffCellKey(item.cellKey)}
                        onBlur={() => setActiveDiffCellKey(null)}
                        onClick={() => setActiveDiffCellKey(item.cellKey)}
                        className={cn(
                          "block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded px-1 py-0.5 text-left font-mono",
                          activeDiffCellKey === item.cellKey
                            ? "bg-chart-2/15 text-foreground"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        #{item.serial} X{item.x} Y{item.y} d({item.offsetXMM.toFixed(2)},{" "}
                        {item.offsetYMM.toFixed(2)})mm: {item.leftState} {"->"} {item.rightState}
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-input bg-background p-3">
                <div className="text-xs text-muted-foreground">矩阵尺寸</div>
                <div className="mt-1 text-sm text-foreground">
                  {visibleMap.rowCount} x {visibleMap.colCount}
                </div>
              </div>
              <div className="rounded-lg border border-input bg-background p-3">
                <div className="text-xs text-muted-foreground">圆心 / 半径</div>
                <div className="mt-1 text-sm text-foreground">
                  ({visibleMap.center.x.toFixed(2)}, {visibleMap.center.y.toFixed(2)}) / {visibleMap.radius.toFixed(2)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              暂无数据
            </div>
          )}
        </div>
      </div>

      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>下载完成</DialogTitle>
            <DialogDescription>
              文件已保存到以下路径（Windows 可复制后粘贴到资源管理器地址栏）:
            </DialogDescription>
          </DialogHeader>
          <div className="break-all rounded-md border border-input bg-muted/40 p-3 text-xs text-foreground">{savedPath}</div>
          {copyHint && <div className="text-xs text-[var(--success)]">{copyHint}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleCopyPath()}>
              复制路径
            </Button>
            <DialogClose asChild>
              <Button className="border border-chart-2/30 bg-chart-2 text-white hover:bg-chart-2/90">
                我知道了
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WaferDiffView;

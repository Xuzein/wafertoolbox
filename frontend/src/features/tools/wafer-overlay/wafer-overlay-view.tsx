import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Download, FileText, Loader2, X } from "lucide-react";
import { ClipboardSetText } from "@wailsjs/runtime/runtime";
import {
  buildOverlayWaferMap,
  downloadWaferMapPng,
  parseAoiWaferFile,
  validateMapsForOverlay,
} from "./wafer-overlay-utils";
import type { ParsedAoiWaferMap } from "./wafer-overlay-types";
import { WaferMapSvg } from "./wafer-map-svg";

type WaferOverlayViewCache = {
  maps: ParsedAoiWaferMap[];
};

const defaultWaferOverlayViewCache: WaferOverlayViewCache = {
  maps: [],
};

let waferOverlayViewCache: WaferOverlayViewCache = defaultWaferOverlayViewCache;

const formatYield = (map: ParsedAoiWaferMap): string => {
  if (map.validCount === 0) {
    return "0.00%";
  }
  return `${((map.passCount / map.validCount) * 100).toFixed(2)}%`;
};

const sequenceToneClasses = [
  "bg-chart-1/20 text-foreground border-chart-1/40",
  "bg-chart-2/20 text-foreground border-chart-2/40",
  "bg-chart-3/20 text-foreground border-chart-3/40",
  "bg-chart-4/20 text-foreground border-chart-4/40",
  "bg-chart-5/20 text-foreground border-chart-5/40",
];

const WaferMeta: React.FC<{ map: ParsedAoiWaferMap; title?: string; compact?: boolean }> = ({
  map,
  title,
  compact = false,
}) => {
  const computedYield = map.validCount > 0 ? ((map.passCount / map.validCount) * 100).toFixed(2) : "0.00";
  return (
    <div
      className={`grid grid-cols-2 gap-x-3 rounded-md border border-input bg-background text-xs ${
        compact ? "gap-y-1 p-2" : "gap-y-2 p-3"
      }`}
    >
      <div className="text-muted-foreground">标题</div>
      <div className="text-foreground font-medium">{title ?? map.fileName}</div>
      <div className="text-muted-foreground">片号</div>
      <div className="text-foreground">{map.waferId}</div>
      <div className="text-muted-foreground">DEVICE</div>
      <div className="text-foreground truncate">{map.device || "-"}</div>
      <div className="text-muted-foreground">矩阵</div>
      <div className="text-foreground">{map.rowCount} x {map.colCount}</div>
      <div className="text-muted-foreground">圆心(x, y)</div>
      <div className="text-foreground">
        ({map.center.x.toFixed(2)}, {map.center.y.toFixed(2)})
      </div>
      <div className="text-muted-foreground">半径</div>
      <div className="text-foreground">{map.radius.toFixed(2)}</div>
      <div className="text-muted-foreground">Pass / Fail</div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--success)]">{map.passCount}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-[var(--destructive)]">{map.failCount}</span>
      </div>
      <div className="text-muted-foreground">良率</div>
      <div className="text-foreground">{computedYield}%</div>
    </div>
  );
};

const OverlaySummary: React.FC<{ map: ParsedAoiWaferMap; fileCount: number }> = ({ map, fileCount }) => {
  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-input bg-background p-3">
        <div className="text-xs text-muted-foreground">叠图文件数</div>
        <div className="mt-1 text-2xl font-semibold text-foreground">{fileCount}</div>
      </div>
      <div className="rounded-lg border border-input bg-background p-3">
        <div className="text-xs text-muted-foreground">片号</div>
        <div className="mt-1 text-sm font-medium text-foreground">{map.waferId}</div>
      </div>
      <div className="rounded-lg border border-input bg-background p-3">
        <div className="text-xs text-muted-foreground">叠图良率</div>
        <div className="mt-1 text-2xl font-semibold text-foreground">{formatYield(map)}</div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-[var(--success)]">Pass {map.passCount}</span>
          <span className="text-[var(--destructive)]">Fail {map.failCount}</span>
        </div>
      </div>
      <div className="rounded-lg border border-input bg-background p-3">
        <div className="text-xs text-muted-foreground">矩阵尺寸</div>
        <div className="mt-1 text-sm text-foreground">{map.rowCount} x {map.colCount}</div>
      </div>
      <div className="rounded-lg border border-input bg-background p-3">
        <div className="text-xs text-muted-foreground">圆心 / 半径</div>
        <div className="mt-1 text-sm text-foreground">
          ({map.center.x.toFixed(2)}, {map.center.y.toFixed(2)}) / {map.radius.toFixed(2)}
        </div>
      </div>
    </div>
  );
};

const WaferOverlayView: React.FC = () => {
  useAppTitle({
    title: "AOI Wafer Overlay",
  });

  const [maps, setMaps] = useState<ParsedAoiWaferMap[]>(waferOverlayViewCache.maps);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [savedPath, setSavedPath] = useState<string>("");
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [draggingFileName, setDraggingFileName] = useState<string | null>(null);

  useEffect(() => {
    waferOverlayViewCache = {
      maps,
    };
  }, [maps]);

  const overlayMap = useMemo(() => buildOverlayWaferMap(maps), [maps]);
  const overlayDiffHighlight = useMemo(() => {
    if (maps.length !== 2 || !overlayMap) {
      return null;
    }

    const leftColor = "#ef4444";
    const rightColor = "#f59e0b";
    const bothColor = "#8b5cf6";
    const cellFillMap: Record<string, string> = {};
    const cellMarkers: Record<
      string,
      {
        fill: string;
        label: string;
      }
    > = {};
    const leftOnlyPoints: Array<{ x: number; y: number }> = [];
    const rightOnlyPoints: Array<{ x: number; y: number }> = [];
    const bothPoints: Array<{ x: number; y: number }> = [];
    let leftOnlyCount = 0;
    let rightOnlyCount = 0;
    let bothCount = 0;

    for (let rowIndex = 0; rowIndex < overlayMap.rowCount; rowIndex += 1) {
      for (let colIndex = 0; colIndex < overlayMap.colCount; colIndex += 1) {
        const leftFail = maps[0].grid[rowIndex][colIndex] === "fail";
        const rightFail = maps[1].grid[rowIndex][colIndex] === "fail";
        if (!leftFail && !rightFail) {
          continue;
        }
        const key = `${rowIndex}-${colIndex}`;
        if (leftFail && rightFail) {
          cellFillMap[key] = bothColor;
          cellMarkers[key] = { fill: bothColor, label: "共" };
          bothPoints.push({ x: colIndex + 1, y: rowIndex + 1 });
          bothCount += 1;
        } else if (leftFail) {
          cellFillMap[key] = leftColor;
          cellMarkers[key] = { fill: leftColor, label: "1" };
          leftOnlyPoints.push({ x: colIndex + 1, y: rowIndex + 1 });
          leftOnlyCount += 1;
        } else {
          cellFillMap[key] = rightColor;
          cellMarkers[key] = { fill: rightColor, label: "2" };
          rightOnlyPoints.push({ x: colIndex + 1, y: rowIndex + 1 });
          rightOnlyCount += 1;
        }
      }
    }

    return {
      leftColor,
      rightColor,
      bothColor,
      leftOnlyCount,
      rightOnlyCount,
      bothCount,
      cellFillMap,
      cellMarkers,
      leftOnlyPoints,
      rightOnlyPoints,
      bothPoints,
    };
  }, [maps, overlayMap]);

  const handleFilesDrop = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setError("");
    setNotice("");
    setIsLoading(true);

    try {
      const parsedMaps = await Promise.all(files.map((file) => parseAoiWaferFile(file)));
      const nextMaps = [...maps];
      for (const map of parsedMaps) {
        const duplicated = nextMaps.some((existing) => existing.fileName === map.fileName);
        if (duplicated) {
          throw new Error(`文件已存在：${map.fileName}`);
        }

        const mismatch = validateMapsForOverlay(nextMaps, map);
        if (mismatch) {
          throw new Error(`${map.fileName} 无法叠图，${mismatch}`);
        }
        nextMaps.push(map);
      }
      setMaps(nextMaps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败，请检查文件格式");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setMaps((prev) => prev.filter((item) => item.fileName !== fileName));
    setError("");
    setNotice("");
    setCopyHint("");
  };

  const handleClearAll = () => {
    setMaps([]);
    setError("");
    setNotice("");
    setCopyHint("");
  };

  const filterTextFiles = (files: FileList | File[]): File[] => {
    return Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".txt"));
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
      setNotice("");
      return;
    }
    void handleFilesDrop(files);
  };

  const handleDownload = async (
    map: ParsedAoiWaferMap,
    fileName: string,
    maxImageSize: number,
    options?: {
      pointColorOverrides?: Record<string, string>;
      preferWailsExporter?: boolean;
    },
  ) => {
    if (isDownloading) {
      return;
    }
    setIsDownloading(true);
    setError("");
    setCopyHint("");
    try {
      const savedPath = await downloadWaferMapPng(map, {
        fileName,
        maxImageSize,
        pointColorOverrides: options?.pointColorOverrides,
        preferWailsExporter: options?.preferWailsExporter ?? true,
      });
      if (savedPath) {
        setNotice(`已保存: ${savedPath}`);
        setSavedPath(savedPath);
        setIsSaveDialogOpen(true);
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

  const moveMapOrder = (sourceFileName: string, targetFileName: string) => {
    if (sourceFileName === targetFileName) {
      return;
    }

    setMaps((prev) => {
      const sourceIndex = prev.findIndex((item) => item.fileName === sourceFileName);
      const targetIndex = prev.findIndex((item) => item.fileName === targetFileName);
      if (sourceIndex < 0 || targetIndex < 0) {
        return prev;
      }

      const next = [...prev];
      const [draggedItem] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, draggedItem);
      return next;
    });
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col gap-5 p-6"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80">
          <div className="rounded-md bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm">
            松开鼠标，开始叠图计算
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 shrink-0">
        <div className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-muted-foreground">
          将 AOI `.txt` 文件拖拽到页面任意区域即可自动计算叠图
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">已上传 ({maps.length})</div>
            {maps.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="h-7 px-2 text-xs text-muted-foreground"
              >
                清空全部
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {maps.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无文件</div>
            ) : (
              maps.map((map) => (
                <div
                  key={map.fileName}
                  className="group flex items-center gap-1.5 rounded-full border border-input bg-card px-3 py-1 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-[170px] truncate text-foreground">{map.fileName}</span>
                  <span className="text-muted-foreground">({map.waferId})</span>
                  <button
                    onClick={() => handleRemoveFile(map.fileName)}
                    className="ml-0.5 rounded-full p-0.5 opacity-60 transition-opacity hover:bg-muted hover:opacity-100"
                    title="删除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          {isLoading && <div className="text-xs text-muted-foreground">正在解析文件...</div>}
          {notice && <div className="text-xs text-[var(--success)]">{notice}</div>}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(380px,1fr)_minmax(260px,1fr)] gap-4">
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">最终叠图效果</h3>
              {overlayMap && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  title="下载高清图"
                  disabled={isDownloading}
                  onClick={() =>
                    void handleDownload(overlayMap, `overlay-${overlayMap.waferId}.png`, 2800, {
                      pointColorOverrides: overlayDiffHighlight?.cellFillMap,
                      preferWailsExporter: overlayDiffHighlight ? false : true,
                    })
                  }
                >
                  {isDownloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
            {overlayMap ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-input bg-background p-3">
                {overlayDiffHighlight && (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-input bg-card px-3 py-2 text-xs">
                    <div className="inline-flex items-center gap-1.5 text-foreground">
                      <span
                        className="inline-block h-3 w-3 rounded-sm border border-input"
                        style={{ backgroundColor: overlayDiffHighlight.leftColor }}
                      />
                      图1缺陷 {overlayDiffHighlight.leftOnlyCount}
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-foreground">
                      <span
                        className="inline-block h-3 w-3 rounded-sm border border-input"
                        style={{ backgroundColor: overlayDiffHighlight.rightColor }}
                      />
                      图2缺陷 {overlayDiffHighlight.rightOnlyCount}
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-foreground">
                      <span
                        className="inline-block h-3 w-3 rounded-sm border border-input"
                        style={{ backgroundColor: overlayDiffHighlight.bothColor }}
                      />
                      共同缺陷 {overlayDiffHighlight.bothCount}
                    </div>
                    <div className="text-muted-foreground">标记说明：1=图1，2=图2，共=共同缺陷</div>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <WaferMapSvg
                    map={overlayMap}
                    cellFillMap={overlayDiffHighlight?.cellFillMap}
                    cellMarkers={overlayDiffHighlight?.cellMarkers}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                请先上传至少 1 个 AOI map 文件
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">叠图统计数据</h3>
            {overlayMap ? (
              <div className="hide-scrollbar min-h-0 flex-1 overflow-auto pr-1">
                <OverlaySummary map={overlayMap} fileCount={maps.length} />
                {overlayDiffHighlight && (
                  <div className="mt-3 rounded-lg border border-input bg-background p-3">
                    <div className="text-xs text-muted-foreground">缺陷坐标（X,Y）</div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="text-foreground">
                        图1缺陷:{" "}
                        {overlayDiffHighlight.leftOnlyPoints.length > 0
                          ? overlayDiffHighlight.leftOnlyPoints
                              .slice(0, 12)
                              .map((p) => `(${p.x},${p.y})`)
                              .join(" ")
                          : "-"}
                      </div>
                      <div className="text-foreground">
                        图2缺陷:{" "}
                        {overlayDiffHighlight.rightOnlyPoints.length > 0
                          ? overlayDiffHighlight.rightOnlyPoints
                              .slice(0, 12)
                              .map((p) => `(${p.x},${p.y})`)
                              .join(" ")
                          : "-"}
                      </div>
                      <div className="text-foreground">
                        共同缺陷:{" "}
                        {overlayDiffHighlight.bothPoints.length > 0
                          ? overlayDiffHighlight.bothPoints
                              .slice(0, 12)
                              .map((p) => `(${p.x},${p.y})`)
                              .join(" ")
                          : "-"}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                暂无叠图数据
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">每次 AOI Map 缩略图与良率信息</h3>
          {overlayMap ? (
            <div className="hide-scrollbar grid min-h-0 flex-1 gap-4 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
              {maps.map((map, index) => (
                <div
                  key={map.fileName}
                  draggable
                  onDragStart={() => setDraggingFileName(map.fileName)}
                  onDragEnd={() => setDraggingFileName(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggingFileName) {
                      moveMapOrder(draggingFileName, map.fileName);
                    }
                    setDraggingFileName(null);
                  }}
                  className={`relative rounded-lg border border-input bg-background p-3 ${
                    draggingFileName === map.fileName ? "opacity-60" : ""
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-1 text-[10px] leading-none ${
                          sequenceToneClasses[index % sequenceToneClasses.length]
                        }`}
                      >
                        {index + 1}
                      </span>
                      <div className="truncate text-xs text-foreground">{map.fileName}</div>
                    </div>
                    <button
                      onClick={() => handleRemoveFile(map.fileName)}
                      className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="删除"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-3">
                    <div className="h-52">
                      <WaferMapSvg map={map} />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isDownloading}
                      onClick={() =>
                        void handleDownload(
                          map,
                          `${map.fileName.replace(/\.[^/.]+$/, "")}-wafermap.png`,
                          2200,
                        )
                      }
                    >
                      {isDownloading ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-3.5 w-3.5" />
                      )}
                      {isDownloading ? "下载中..." : "下载"}
                    </Button>
                    <WaferMeta map={map} compact />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              暂无 wafermap
            </div>
          )}
        </div>
      </div>

      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>下载完成</DialogTitle>
            <DialogDescription>
              文件已保存到以下路径（Windows 可直接复制后粘贴到资源管理器地址栏）:
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-input bg-muted/40 p-3 text-xs text-foreground break-all">
            {savedPath}
          </div>
          {copyHint && <div className="text-xs text-[var(--success)]">{copyHint}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleCopyPath()}>
              复制路径
            </Button>
            <DialogClose asChild>
              <Button>我知道了</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default WaferOverlayView;

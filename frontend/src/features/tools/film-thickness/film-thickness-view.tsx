import { useEffect, useState } from "react";
import { ClipboardSetText } from "@wailsjs/runtime/runtime";
import { AnalyzeFilmThickness, SelectFilmThicknessOutputRoot } from "@wailsjs/go/main/App";
import type { main } from "@wailsjs/go/models";
import { useAppTitle } from "@/components/layout/app-title-context";
import { Button } from "@/components/ui/button";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Input } from "@/components/ui/input";
import { Copy, FileText, Folder, FolderOpen, Loader2, Play, Trash2, TriangleAlert } from "lucide-react";

const OUTPUT_ROOT_STORAGE_KEY = "film_thickness_output_root";
const DEFAULT_OUTPUT_ROOT = "tmp/wafer_maps";

const readFileAsBase64 = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const fmt = (value: number, digits = 4) => value.toFixed(digits);

const ResultPath: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [hint, setHint] = useState("");

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-input bg-muted/35 px-3 py-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{value}</span>
      <button
        type="button"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
        onClick={async () => {
          const ok = await ClipboardSetText(value);
          setHint(ok ? "已复制" : "复制失败");
          window.setTimeout(() => setHint(""), 1200);
        }}
        title="复制路径"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {hint && <span className="shrink-0 text-chart-2">{hint}</span>}
    </div>
  );
};

const FilmThicknessView: React.FC = () => {
  useAppTitle({ title: "膜厚分析" });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [outputRoot, setOutputRoot] = useState(() => {
    return localStorage.getItem(OUTPUT_ROOT_STORAGE_KEY) ?? DEFAULT_OUTPUT_ROOT;
  });
  const [result, setResult] = useState<main.FilmThicknessAnalyzeResult | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (outputRoot.trim()) {
      localStorage.setItem(OUTPUT_ROOT_STORAGE_KEY, outputRoot.trim());
    }
  }, [outputRoot]);

  const runAnalysis = async () => {
    if (selectedFiles.length === 0) {
      setError("请先上传 Rudolph 膜厚 CSV 文件");
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(null);
    try {
      const files = await Promise.all(
        selectedFiles.map(async (file) => ({
          fileName: file.name,
          dataBase64: await readFileAsBase64(file),
        })),
      );
      const nextResult = await AnalyzeFilmThickness({
        fileName: selectedFiles[0]?.name ?? "",
        dataBase64: "",
        outputRoot: outputRoot.trim(),
        files,
      });
      setResult(nextResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "膜厚分析失败");
    } finally {
      setIsRunning(false);
    }
  };

  const chooseOutputRoot = async () => {
    setError("");
    try {
      const selected = await SelectFilmThicknessOutputRoot(outputRoot.trim());
      if (selected) {
        setOutputRoot(selected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择输出目录失败");
    }
  };

  const addFiles = (files: File[]) => {
    setSelectedFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
      const next = [...prev];
      files.forEach((file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push(file);
        }
      });
      return next;
    });
    setResult(null);
    setError("");
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-5 p-6">
      <div className="app-surface p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              膜厚分析 · Film Thickness
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              解析 Rudolph CSV，按日期生成单片 wafer map、分页总览图和汇总 CSV。
            </p>
          </div>
          <Button
            className="h-9 rounded-lg bg-chart-2 px-4 text-white hover:bg-chart-2/90"
            disabled={selectedFiles.length === 0 || isRunning}
            onClick={() => void runAnalysis()}
          >
            {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {isRunning ? "生成中..." : "开始分析"}
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <FileDropZone
            accept={[".csv"]}
            maxFiles={999}
            uploadedFiles={selectedFiles}
            clickToSelect={false}
            onFilesDrop={addFiles}
            className="min-h-[180px] bg-background/60"
          />

          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">输出根目录</div>
              <div className="flex gap-2">
                <Input
                  value={outputRoot}
                  onChange={(event) => setOutputRoot(event.target.value)}
                  placeholder={DEFAULT_OUTPUT_ROOT}
                  className="h-10 rounded-lg bg-background"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 rounded-lg border-input px-3"
                  onClick={() => void chooseOutputRoot()}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  选择
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-input bg-muted/35 p-3 text-xs text-muted-foreground">
              {selectedFiles.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>已选择 {selectedFiles.length} 个 CSV</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => {
                        setSelectedFiles([]);
                        setResult(null);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      清空
                    </button>
                  </div>
                  <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                    {selectedFiles.map((file) => (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className="flex items-center gap-2 text-foreground"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-chart-2" />
                        <span className="truncate">{file.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                "等待上传 CSV 文件"
              )}
            </div>
            {error && (
              <div className="flex gap-2 rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="app-surface p-4 text-center">
              <div className="text-xs text-muted-foreground">Wafers</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{result.waferCount}</div>
            </div>
            <div className="app-surface p-4 text-center">
              <div className="text-xs text-muted-foreground">Dates</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{result.dates?.length ?? 0}</div>
            </div>
            <div className="app-surface p-4 text-center">
              <div className="text-xs text-muted-foreground">Overview Pages</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {(result.dates ?? []).reduce((sum, item) => sum + (item.pageImages?.length ?? 0), 0)}
              </div>
            </div>
          </div>

          <div className="app-surface space-y-3 p-4">
            <ResultPath label="输出目录" value={result.outputRoot} />
            <ResultPath label="汇总表" value={result.summaryPath} />
            {(result.dates ?? []).map((date) => (
              <div key={date.date} className="rounded-lg border border-input bg-background/60 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Folder className="h-4 w-4 text-chart-2" />
                  <span>{date.date}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {date.waferCount} wafers · {date.pageImages?.length ?? 0} pages
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{date.dirPath}</div>
              </div>
            ))}
          </div>

          <div className="app-surface min-h-0 p-4">
            <div className="mb-3 text-sm font-semibold text-foreground">Wafer Summary</div>
            <div className="hide-scrollbar max-h-[360px] overflow-auto rounded-lg border border-input">
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {["#", "Date", "Time", "Lot", "Wafer", "Slot", "Avg", "Min", "Max", "Range", "U%"].map((item) => (
                      <th key={item} className="border-b border-input px-3 py-2 text-left font-semibold text-foreground">
                        {item}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.wafers ?? []).map((wafer) => (
                    <tr key={`${wafer.sortIndex}-${wafer.imagePath}`} className="odd:bg-background even:bg-muted/25">
                      <td className="px-3 py-2">{wafer.sortIndex}</td>
                      <td className="px-3 py-2">{wafer.date}</td>
                      <td className="px-3 py-2">{wafer.time || "-"}</td>
                      <td className="px-3 py-2">{wafer.lotId || "-"}</td>
                      <td className="px-3 py-2">{wafer.waferId || "-"}</td>
                      <td className="px-3 py-2">{wafer.slotNumber || "-"}</td>
                      <td className="px-3 py-2 font-medium">{fmt(wafer.e2Avg)}</td>
                      <td className="px-3 py-2">{fmt(wafer.e2Min)}</td>
                      <td className="px-3 py-2">{fmt(wafer.e2Max)}</td>
                      <td className="px-3 py-2">{fmt(wafer.e2Range)}</td>
                      <td className="px-3 py-2">{fmt(wafer.uniformityPct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {(result.warnings?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-700">
              <div className="mb-2 font-semibold">解析提醒</div>
              <div className="space-y-1">
                {result.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default FilmThicknessView;

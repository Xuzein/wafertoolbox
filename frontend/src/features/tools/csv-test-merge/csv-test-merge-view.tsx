import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardSetText } from "@wailsjs/runtime/runtime";
import { SaveMergedTestItemExcel } from "@wailsjs/go/main/App";
import { useAppTitle } from "@/components/layout/app-title-context";
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
import { Download, FileText, Loader2, X } from "lucide-react";
import { parseSummaryCsv, type ParsedSummaryCsv } from "./csv-test-merge-utils";

const CsvTestMergeView: React.FC = () => {
  useAppTitle({ title: "CSV Wafer Fusion" });

  const [parsedFiles, setParsedFiles] = useState<ParsedSummaryCsv[]>([]);
  const [selectedTestItem, setSelectedTestItem] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [copyHint, setCopyHint] = useState("");
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);

  const allTestItems = useMemo(() => {
    const itemSet = new Set<string>();
    parsedFiles.forEach((file) => {
      file.testItems.forEach((item) => itemSet.add(item));
    });
    return Array.from(itemSet).sort((a, b) => a.localeCompare(b));
  }, [parsedFiles]);

  const selectedRows = useMemo(() => {
    if (!selectedTestItem) {
      return [];
    }
    return parsedFiles.map((file) => ({
      fileName: file.fileName,
      wafer: file.waferId,
      values: file.testData[selectedTestItem] ?? [],
    }));
  }, [parsedFiles, selectedTestItem]);

  const hasMissingItemFiles = selectedRows.some((row) => row.values.length === 0);
  const maxValueCount = selectedRows.reduce(
    (maxCount, row) => Math.max(maxCount, row.values.length),
    0,
  );

  const filterCsvFiles = (files: FileList | File[]): File[] => {
    return Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".csv"));
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setIsLoading(true);
    setError("");
    setNotice("");
    setCopyHint("");

    try {
      const parsed = await Promise.all(
        files.map(async (file) => {
          const text = await file.text();
          return parseSummaryCsv(text, file.name);
        }),
      );

      setParsedFiles((prev) => {
        const next = [...prev];
        parsed.forEach((item) => {
          const duplicate = next.some((existing) => existing.fileName === item.fileName);
          if (!duplicate) {
            next.push(item);
          }
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV 解析失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = filterCsvFiles(event.target.files ?? []);
    if (files.length === 0) {
      setError("仅支持上传 .csv 文件");
      return;
    }
    void addFiles(files);
    event.target.value = "";
  };

  const removeFile = (fileName: string) => {
    setParsedFiles((prev) => prev.filter((file) => file.fileName !== fileName));
    setNotice("");
    setError("");
    setCopyHint("");
  };

  const clearAll = () => {
    setParsedFiles([]);
    setSelectedTestItem("");
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
    const files = filterCsvFiles(event.dataTransfer.files);
    if (files.length === 0) {
      setError("仅支持拖拽 .csv 文件");
      return;
    }
    void addFiles(files);
  };

  const handleExport = async () => {
    if (!selectedTestItem || selectedRows.length === 0) {
      setError("请先上传 CSV 并选择测试项");
      return;
    }
    setIsExporting(true);
    setError("");
    setNotice("");
    setCopyHint("");
    try {
      const fileName = `merged-${selectedTestItem.replace(/[^\w.-]+/g, "_")}.xlsx`;
      const path = await SaveMergedTestItemExcel({
        fileName,
        testItem: selectedTestItem,
        rows: selectedRows.map((row) => ({
          wafer: row.wafer,
          values: row.values,
        })),
      });
      setSavedPath(path);
      setNotice(`已导出：${path}`);
      setIsSaveDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败，请稍后重试");
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyPath = async () => {
    if (!savedPath) {
      return;
    }
    const ok = await ClipboardSetText(savedPath);
    setCopyHint(ok ? "已复制路径" : "复制失败");
  };

  useEffect(() => {
    if (!selectedTestItem && allTestItems.length > 0) {
      setSelectedTestItem(allTestItems[0]);
      return;
    }
    if (selectedTestItem && !allTestItems.includes(selectedTestItem)) {
      setSelectedTestItem(allTestItems[0] ?? "");
    }
  }, [allTestItems, selectedTestItem]);

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
            松开鼠标，上传 CSV
          </div>
        </div>
      )}

      <div className="rounded-lg border border-input bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            上传 CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".csv"
            multiple
            onChange={handleFileInputChange}
          />
          {parsedFiles.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              清空
            </Button>
          )}
          <div className="text-xs text-muted-foreground">
            已上传 {parsedFiles.length} 个文件
          </div>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {parsedFiles.length === 0 ? (
            <div className="text-sm text-muted-foreground">请上传一个或多个 Summary CSV 文件</div>
          ) : (
            parsedFiles.map((file) => (
              <div
                key={file.fileName}
                className="group flex items-center gap-1.5 rounded-full border border-input bg-background px-3 py-1 text-xs"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="max-w-[220px] truncate text-foreground">{file.fileName}</span>
                <span className="text-muted-foreground">({file.waferId})</span>
                <button
                  className="rounded-full p-0.5 opacity-70 transition-colors hover:bg-muted hover:opacity-100"
                  onClick={() => removeFile(file.fileName)}
                  title="删除"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-lg border border-input bg-card p-4">
          <div className="text-sm font-semibold text-foreground">合并配置</div>
          <div className="mt-3 text-xs text-muted-foreground">测试项（来自所有上传文件）</div>
          <select
            className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none"
            value={selectedTestItem}
            onChange={(event) => setSelectedTestItem(event.target.value)}
            disabled={allTestItems.length === 0}
          >
            {allTestItems.length === 0 ? (
              <option value="">暂无测试项</option>
            ) : (
              allTestItems.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))
            )}
          </select>

          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div>匹配晶圆数: {selectedRows.length}</div>
            <div>最大数据点数: {maxValueCount}</div>
          </div>
          {hasMissingItemFiles && (
            <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700">
              部分文件不存在该测试项，导出后该 wafer 行会为空值
            </div>
          )}

          <Button
            className="mt-4 w-full"
            onClick={() => void handleExport()}
            disabled={!selectedTestItem || selectedRows.length === 0 || isExporting}
          >
            {isExporting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {isExporting ? "导出中..." : "导出 Excel"}
          </Button>
        </div>

        <div className="rounded-lg border border-input bg-card p-4">
          <div className="mb-2 text-sm font-semibold text-foreground">预览（每片 wafer 一列）</div>
          <div className="hide-scrollbar max-h-full overflow-auto rounded-md border border-input">
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  {selectedRows.length === 0 ? (
                    <th className="border-b border-input px-2 py-2 text-left font-medium text-foreground">Wafer</th>
                  ) : (
                    selectedRows.map((row) => (
                      <th
                        key={`header-${row.fileName}-${row.wafer}`}
                        className="border-b border-input px-2 py-2 text-left font-medium text-foreground"
                      >
                        {row.wafer}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {selectedRows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-muted-foreground" colSpan={1}>
                      暂无可预览数据
                    </td>
                  </tr>
                ) : (
                  Array.from({ length: maxValueCount }).map((_, pointIndex) => (
                    <tr key={`point-${pointIndex}`} className="align-top">
                      {selectedRows.map((row) => (
                        <td
                          key={`${row.fileName}-${row.wafer}-${pointIndex}`}
                          className="border-b border-input px-2 py-2 text-muted-foreground"
                        >
                          {row.values[pointIndex] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {notice && <div className="text-xs text-[var(--success)]">{notice}</div>}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出完成</DialogTitle>
            <DialogDescription>Excel 已保存到以下路径：</DialogDescription>
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

export default CsvTestMergeView;

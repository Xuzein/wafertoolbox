import type { DieState, ParsedAoiWaferMap, WaferCenter } from "./wafer-overlay-types";

const EMPTY_TOKEN = "___";

const toNumeric = (value: string | undefined, fallback = 0): number => {
  if (!value) {
    return fallback;
  }
  const num = Number(value.trim());
  return Number.isFinite(num) ? num : fallback;
};

const normalizeWaferId = (lot: string, wafer: string): string => {
  const lotText = lot.trim().toUpperCase();
  const waferNum = Number.parseInt(wafer, 10);
  const waferText = Number.isFinite(waferNum)
    ? waferNum.toString().padStart(2, "0")
    : wafer.trim().toUpperCase();
  return `${lotText}-${waferText}`;
};

const tokenToState = (token: string): DieState => {
  if (token === "000") {
    return "pass";
  }
  if (token === "001") {
    return "fail";
  }
  return "empty";
};

const calculateCenterAndRadius = (grid: DieState[][]): { center: WaferCenter; radius: number } => {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const validPoints: Array<{ x: number; y: number }> = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let colIndex = 0; colIndex < cols; colIndex += 1) {
      const state = grid[rowIndex][colIndex];
      if (state === "empty") {
        continue;
      }
      const x = colIndex;
      const y = rows - 1 - rowIndex;
      validPoints.push({ x, y });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (validPoints.length === 0) {
    const fallbackCenter = { x: (cols - 1) / 2, y: (rows - 1) / 2 };
    return { center: fallbackCenter, radius: Math.min(cols, rows) / 2 };
  }

  const center: WaferCenter = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };

  let radius = 0;
  for (const point of validPoints) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy) + 0.5);
  }

  return { center, radius };
};

export const parseAoiWaferFile = async (file: File): Promise<ParsedAoiWaferMap> => {
  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const headers = new Map<string, string>();
  const rowDataTokens: string[][] = [];

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "RowData") {
      const rowTokens = value.split(/\s+/).filter(Boolean);
      rowDataTokens.push(rowTokens);
      continue;
    }

    headers.set(key, value);
  }

  const lot = headers.get("LOT") ?? "";
  const wafer = headers.get("WAFER") ?? "";
  if (!lot || !wafer) {
    throw new Error(`${file.name} 缺少 LOT/WAFER 字段`);
  }

  const rowCount = toNumeric(headers.get("ROWCT"), rowDataTokens.length);
  const colCount = toNumeric(headers.get("COLCT"), rowDataTokens[0]?.length ?? 0);
  if (!rowCount || !colCount) {
    throw new Error(`${file.name} 缺少有效 ROWCT/COLCT`);
  }

  const grid: DieState[][] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const tokens = rowDataTokens[rowIndex] ?? [];
    const normalizedTokens =
      tokens.length >= colCount
        ? tokens.slice(0, colCount)
        : [...tokens, ...new Array(colCount - tokens.length).fill(EMPTY_TOKEN)];
    grid.push(normalizedTokens.map(tokenToState));
  }

  let passCount = 0;
  let failCount = 0;
  for (const row of grid) {
    for (const state of row) {
      if (state === "pass") {
        passCount += 1;
      } else if (state === "fail") {
        failCount += 1;
      }
    }
  }

  const { center, radius } = calculateCenterAndRadius(grid);

  return {
    fileName: file.name,
    device: headers.get("DEVICE") ?? "",
    lot: lot.trim().toUpperCase(),
    wafer: wafer.trim(),
    waferId: normalizeWaferId(lot, wafer),
    xDies: toNumeric(headers.get("XDIES")),
    yDies: toNumeric(headers.get("YDIES")),
    yieldText: headers.get("Yield") ?? "",
    rowCount,
    colCount,
    grid,
    center,
    radius,
    passCount,
    failCount,
    validCount: passCount + failCount,
  };
};

export const buildOverlayWaferMap = (maps: ParsedAoiWaferMap[]): ParsedAoiWaferMap | null => {
  if (maps.length === 0) {
    return null;
  }

  const base = maps[0];
  const rowCount = base.rowCount;
  const colCount = base.colCount;
  const overlayGrid: DieState[][] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row: DieState[] = [];
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const states = maps.map((map) => map.grid[rowIndex][colIndex]);
      const nonEmptyStates = states.filter((state) => state !== "empty");
      if (nonEmptyStates.length === 0) {
        row.push("empty");
        continue;
      }
      if (nonEmptyStates.some((state) => state === "fail")) {
        row.push("fail");
      } else {
        row.push("pass");
      }
    }
    overlayGrid.push(row);
  }

  let passCount = 0;
  let failCount = 0;
  for (const row of overlayGrid) {
    for (const state of row) {
      if (state === "pass") {
        passCount += 1;
      } else if (state === "fail") {
        failCount += 1;
      }
    }
  }

  const { center, radius } = calculateCenterAndRadius(overlayGrid);

  return {
    ...base,
    fileName: "叠图结果",
    grid: overlayGrid,
    center,
    radius,
    passCount,
    failCount,
    validCount: passCount + failCount,
    yieldText: base.validCount > 0 ? (passCount / (passCount + failCount)).toFixed(4) : "0",
  };
};

export const buildDiffWaferMap = (
  leftMap: ParsedAoiWaferMap,
  rightMap: ParsedAoiWaferMap,
  options?: {
    ignoreEmptyMismatch?: boolean;
  },
): ParsedAoiWaferMap => {
  const { ignoreEmptyMismatch = false } = options ?? {};
  const rowCount = leftMap.rowCount;
  const colCount = leftMap.colCount;
  const diffGrid: DieState[][] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row: DieState[] = [];
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const leftState = leftMap.grid[rowIndex][colIndex];
      const rightState = rightMap.grid[rowIndex][colIndex];
      if (leftState === "empty" && rightState === "empty") {
        row.push("empty");
      } else if (ignoreEmptyMismatch && (leftState === "empty" || rightState === "empty")) {
        row.push("empty");
      } else if (leftState === rightState) {
        row.push("pass");
      } else {
        row.push("fail");
      }
    }
    diffGrid.push(row);
  }

  let sameCount = 0;
  let diffCount = 0;
  for (const row of diffGrid) {
    for (const state of row) {
      if (state === "pass") {
        sameCount += 1;
      } else if (state === "fail") {
        diffCount += 1;
      }
    }
  }

  const { center, radius } = calculateCenterAndRadius(diffGrid);
  const comparedCount = sameCount + diffCount;
  return {
    ...leftMap,
    fileName: "aoi-map-diff",
    device: `${leftMap.device || "-"} vs ${rightMap.device || "-"}`,
    grid: diffGrid,
    center,
    radius,
    passCount: sameCount,
    failCount: diffCount,
    validCount: comparedCount,
    yieldText: comparedCount > 0 ? (sameCount / comparedCount).toFixed(4) : "0",
  };
};

export const validateMapsForOverlay = (
  existingMaps: ParsedAoiWaferMap[],
  incomingMap: ParsedAoiWaferMap,
): string | null => {
  if (existingMaps.length === 0) {
    return null;
  }

  const first = existingMaps[0];
  if (incomingMap.waferId !== first.waferId) {
    return `片号不一致：当前为 ${first.waferId}，新增文件为 ${incomingMap.waferId}`;
  }
  if (
    incomingMap.rowCount !== first.rowCount ||
    incomingMap.colCount !== first.colCount
  ) {
    return `矩阵尺寸不一致：当前为 ${first.rowCount}x${first.colCount}，新增文件为 ${incomingMap.rowCount}x${incomingMap.colCount}`;
  }
  return null;
};

export const validateMapsForDiff = (
  leftMap: ParsedAoiWaferMap,
  rightMap: ParsedAoiWaferMap,
): string | null => {
  if (leftMap.waferId !== rightMap.waferId) {
    return `片号不一致：${leftMap.waferId} / ${rightMap.waferId}`;
  }
  if (leftMap.rowCount !== rightMap.rowCount || leftMap.colCount !== rightMap.colCount) {
    return `矩阵尺寸不一致：${leftMap.rowCount}x${leftMap.colCount} / ${rightMap.rowCount}x${rightMap.colCount}`;
  }
  return null;
};

interface ExportPngOptions {
  fileName?: string;
  maxImageSize?: number;
  preferWailsExporter?: boolean;
  requireSavedPath?: boolean;
  backgroundColor?: string;
  passColor?: string;
  failColor?: string;
  borderColor?: string;
  axisColor?: string;
  circleColor?: string;
  centerColor?: string;
  pointColorOverrides?: Record<string, string>;
}

interface WailsBridge {
  go?: {
    main?: {
      App?: {
        SaveBase64Image?: (dataURL: string, fileName: string) => Promise<string>;
        SaveWaferMapPNG?: (request: {
          fileName: string;
          rowCount: number;
          colCount: number;
          xDies: number;
          yDies: number;
          centerX: number;
          centerY: number;
          radius: number;
          maxImageSize: number;
          backgroundColor?: string;
          passColor?: string;
          failColor?: string;
          borderColor?: string;
          axisColor?: string;
          circleColor?: string;
          centerColor?: string;
          passPoints: Array<{ x: number; y: number }>;
          failPoints: Array<{ x: number; y: number }>;
        }) => Promise<string>;
      };
    };
  };
}

export const downloadWaferMapPng = async (
  map: ParsedAoiWaferMap,
  options: ExportPngOptions = {},
): Promise<string | null> => {
  const {
    fileName = `${map.fileName.replace(/\.[^/.]+$/, "")}.png`,
    maxImageSize = 2400,
    preferWailsExporter = true,
    requireSavedPath = false,
    backgroundColor = "#f4f4f4",
    passColor = "#22c55e",
    failColor = "#e54b4f",
    borderColor = "#dddddd",
    axisColor = "#737373",
    circleColor = "#111111",
    centerColor = "#000000",
    pointColorOverrides,
  } = options;
  const bridge = window as unknown as WailsBridge;
  const saveWaferPNG = bridge.go?.main?.App?.SaveWaferMapPNG;
  if (saveWaferPNG && preferWailsExporter) {
    try {
      const passPoints: Array<{ x: number; y: number }> = [];
      const failPoints: Array<{ x: number; y: number }> = [];
      for (let rowIndex = 0; rowIndex < map.rowCount; rowIndex += 1) {
        for (let colIndex = 0; colIndex < map.colCount; colIndex += 1) {
          const state = map.grid[rowIndex][colIndex];
          if (state === "empty") {
            continue;
          }
          const point = { x: colIndex, y: rowIndex };
          if (state === "pass") {
            passPoints.push(point);
          } else {
            failPoints.push(point);
          }
        }
      }

      const savedPath = await saveWaferPNG({
        fileName,
        rowCount: map.rowCount,
        colCount: map.colCount,
        xDies: map.xDies,
        yDies: map.yDies,
        centerX: map.center.x,
        centerY: map.center.y,
        radius: map.radius,
        maxImageSize,
        backgroundColor,
        passColor,
        failColor,
        borderColor,
        axisColor,
        circleColor,
        centerColor,
        passPoints,
        failPoints,
      });
      return savedPath;
    } catch {
      // fallback to canvas mode
    }
  }

  const paddingCell = 4;
  const cellWRatio = map.xDies > 0 ? map.xDies : 1;
  const cellHRatio = map.yDies > 0 ? map.yDies : 1;
  const dataWidthRatio = map.colCount * cellWRatio + paddingCell * 2 * cellWRatio;
  const dataHeightRatio = map.rowCount * cellHRatio + paddingCell * 2 * cellHRatio;
  const baseScale = Math.max(8, Math.floor(maxImageSize / Math.max(dataWidthRatio, dataHeightRatio)));
  const cellW = baseScale * cellWRatio;
  const cellH = baseScale * cellHRatio;
  const width = Math.round(dataWidthRatio * baseScale);
  const height = Math.round(dataHeightRatio * baseScale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const centerX = (map.center.x + 0.5 + paddingCell) * cellW;
  const centerY = (map.rowCount - map.center.y - 0.5 + paddingCell) * cellH;

  ctx.strokeStyle = axisColor;
  ctx.lineWidth = Math.max(1, Math.floor(baseScale * 0.06));
  ctx.setLineDash([Math.max(2, Math.floor(baseScale * 0.16)), Math.max(2, Math.floor(baseScale * 0.16))]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = circleColor;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, Math.floor(baseScale * 0.08));
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, map.radius * cellW, map.radius * cellH, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (let rowIndex = 0; rowIndex < map.rowCount; rowIndex += 1) {
    for (let colIndex = 0; colIndex < map.colCount; colIndex += 1) {
      const state = map.grid[rowIndex][colIndex];
      if (state === "empty") {
        continue;
      }
      const x = (colIndex + paddingCell) * cellW;
      const y = (rowIndex + paddingCell) * cellH;
      const cellKey = `${rowIndex}-${colIndex}`;
      ctx.fillStyle =
        pointColorOverrides?.[cellKey] ??
        (state === "pass" ? passColor : failColor);
      ctx.fillRect(x, y, cellW, cellH);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = Math.max(1, Math.floor(baseScale * 0.03));
      ctx.strokeRect(x, y, cellW, cellH);
    }
  }

  ctx.fillStyle = centerColor;
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.max(2, Math.floor(baseScale * 0.3)), 0, Math.PI * 2);
  ctx.fill();

  const link = document.createElement("a");
  const dataURL = canvas.toDataURL("image/png");
  const saveToDisk = bridge.go?.main?.App?.SaveBase64Image;
  if (saveToDisk) {
    try {
      const savedPath = await saveToDisk(dataURL, fileName);
      return savedPath;
    } catch {
      // fallback to browser download mode
    }
  }

  if (requireSavedPath) {
    throw new Error("当前环境无法返回保存路径，请在 Wails 客户端中执行下载");
  }

  link.href = dataURL;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return null;
};

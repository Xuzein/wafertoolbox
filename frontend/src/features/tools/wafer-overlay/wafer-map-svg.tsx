import { memo, useMemo } from "react";
import type { ParsedAoiWaferMap } from "./wafer-overlay-types";
import { cn } from "@/lib/utils";

interface WaferMapSvgProps {
  map: ParsedAoiWaferMap;
  className?: string;
  palette?: WaferMapSvgPalette;
  cellFillMap?: Record<string, string>;
  cellLabels?: Record<string, string>;
  highlightedCellKey?: string | null;
  cellMarkers?: Record<
    string,
    {
      fill: string;
      stroke?: string;
      label?: string;
    }
  >;
}

export interface WaferMapSvgPalette {
  passFill?: string;
  failFill?: string;
  backgroundFill?: string;
  borderStroke?: string;
  axisStroke?: string;
  circleStroke?: string;
  centerFill?: string;
}

const DEFAULT_PALETTE: Required<WaferMapSvgPalette> = {
  passFill: "var(--success)",
  failFill: "var(--destructive)",
  backgroundFill: "var(--background)",
  borderStroke: "var(--border)",
  axisStroke: "var(--muted-foreground)",
  circleStroke: "var(--primary)",
  centerFill: "var(--accent-foreground)",
};
const SIX_INCH_WAFER_DIAMETER_MM = 150;
const SIX_INCH_WAFER_RADIUS_MM = SIX_INCH_WAFER_DIAMETER_MM / 2;

const WaferMapSvgComponent: React.FC<WaferMapSvgProps> = ({
  map,
  className,
  palette,
  cellFillMap,
  cellLabels,
  highlightedCellKey,
  cellMarkers,
}) => {
  const colors = useMemo(() => ({ ...DEFAULT_PALETTE, ...palette }), [palette]);
  const paddingCell = 2;
  const mmPadding = 2;

  const geometry = useMemo(() => {
    const cellW = map.xDies > 0 ? map.xDies : 1;
    const cellH = map.yDies > 0 ? map.yDies : 1;
    const padX = paddingCell * cellW + mmPadding;
    const padY = paddingCell * cellH + mmPadding;
    let minCol = Number.POSITIVE_INFINITY;
    let maxCol = Number.NEGATIVE_INFINITY;
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;
    const nonEmptyCells: Array<{ rowIndex: number; colIndex: number; state: "pass" | "fail" }> = [];

    for (let rowIndex = 0; rowIndex < map.rowCount; rowIndex += 1) {
      for (let colIndex = 0; colIndex < map.colCount; colIndex += 1) {
        const state = map.grid[rowIndex][colIndex];
        if (state === "empty") {
          continue;
        }
        nonEmptyCells.push({
          rowIndex,
          colIndex,
          state,
        });
        minCol = Math.min(minCol, colIndex);
        maxCol = Math.max(maxCol, colIndex);
        minRow = Math.min(minRow, rowIndex);
        maxRow = Math.max(maxRow, rowIndex);
      }
    }

    const hasDies = Number.isFinite(minCol);
    const dataLeft = hasDies ? padX + minCol * cellW : padX;
    const dataRight = hasDies ? padX + (maxCol + 1) * cellW : padX + map.colCount * cellW;
    const dataTop = hasDies ? padY + minRow * cellH : padY;
    const dataBottom = hasDies ? padY + (maxRow + 1) * cellH : padY + map.rowCount * cellH;
    const centerX = (dataLeft + dataRight) / 2;
    const centerY = (dataTop + dataBottom) / 2;
    const waferRadius = SIX_INCH_WAFER_RADIUS_MM;
    const viewLeft = Math.min(0, dataLeft, centerX - waferRadius) - mmPadding;
    const viewTop = Math.min(0, dataTop, centerY - waferRadius) - mmPadding;
    const viewRight = Math.max(dataRight, centerX + waferRadius) + mmPadding;
    const viewBottom = Math.max(dataBottom, centerY + waferRadius) + mmPadding;
    const viewW = viewRight - viewLeft;
    const viewH = viewBottom - viewTop;

    return {
      cellW,
      cellH,
      padX,
      padY,
      centerX,
      centerY,
      waferRadius,
      viewW,
      viewH,
      viewBox: `${viewLeft} ${viewTop} ${viewW} ${viewH}`,
      nonEmptyCells,
    };
  }, [map]);

  const baseRects = useMemo(
    () =>
      geometry.nonEmptyCells.map(({ rowIndex, colIndex, state }) => {
        const cellKey = `${rowIndex}-${colIndex}`;
        const fillColor = cellFillMap?.[cellKey] ?? (state === "pass" ? colors.passFill : colors.failFill);
        return (
          <rect
            key={`${rowIndex}-${colIndex}`}
            x={geometry.padX + colIndex * geometry.cellW}
            y={geometry.padY + rowIndex * geometry.cellH}
            width={geometry.cellW}
            height={geometry.cellH}
            fill={fillColor}
            stroke={colors.borderStroke}
            strokeWidth={0.04}
          />
        );
      }),
    [geometry, cellFillMap, colors.passFill, colors.failFill, colors.borderStroke],
  );

  const highlightedRect = useMemo(() => {
    if (!highlightedCellKey) {
      return null;
    }
    const [row, col] = highlightedCellKey.split("-").map((v) => Number.parseInt(v, 10));
    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      return null;
    }
    return (
      <rect
        x={geometry.padX + col * geometry.cellW}
        y={geometry.padY + row * geometry.cellH}
        width={geometry.cellW}
        height={geometry.cellH}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth={0.2}
      />
    );
  }, [highlightedCellKey, geometry]);

  const labels = useMemo(
    () =>
      cellLabels
        ? Object.entries(cellLabels).map(([cellKey, label]) => {
            const [row, col] = cellKey.split("-").map((v) => Number.parseInt(v, 10));
            if (!Number.isFinite(row) || !Number.isFinite(col)) {
              return null;
            }
            const x = geometry.padX + col * geometry.cellW + geometry.cellW / 2;
            const y = geometry.padY + row * geometry.cellH + geometry.cellH / 2;
            return (
              <text
                key={`label-${cellKey}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffffff"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.08}
                paintOrder="stroke"
                fontWeight={700}
                style={{ fontSize: `${Math.max(0.45, Math.min(geometry.cellW, geometry.cellH) * 0.55)}px` }}
              >
                {label}
              </text>
            );
          })
        : null,
    [cellLabels, geometry],
  );

  const markers = useMemo(
    () =>
      cellMarkers
        ? Object.entries(cellMarkers).map(([cellKey, marker]) => {
            const [row, col] = cellKey.split("-").map((v) => Number.parseInt(v, 10));
            if (!Number.isFinite(row) || !Number.isFinite(col)) {
              return null;
            }
            const x = geometry.padX + col * geometry.cellW + geometry.cellW / 2;
            const y = geometry.padY + row * geometry.cellH + geometry.cellH / 2;
            const r = Math.max(0.55, Math.min(geometry.cellW, geometry.cellH) * 0.42);
            return (
              <g key={`marker-${cellKey}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={marker.fill}
                  stroke={marker.stroke ?? "rgba(0,0,0,0.35)"}
                  strokeWidth={0.12}
                />
                {marker.label ? (
                  <text
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#ffffff"
                    fontWeight={700}
                    style={{ fontSize: `${Math.max(0.48, Math.min(geometry.cellW, geometry.cellH) * 0.52)}px` }}
                  >
                    {marker.label}
                  </text>
                ) : null}
              </g>
            );
          })
        : null,
    [cellMarkers, geometry],
  );

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center rounded-lg border border-border bg-card p-2",
        className,
      )}
    >
      <svg
        viewBox={geometry.viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
        role="img"
        aria-label={`wafer map ${map.fileName}`}
      >
        <rect
          x={0}
          y={0}
          width={geometry.viewW}
          height={geometry.viewH}
          fill={colors.backgroundFill}
        />

        {baseRects}
        {highlightedRect}
        {labels}
        {markers}

        <line
          x1={0}
          y1={geometry.centerY}
          x2={geometry.viewW}
          y2={geometry.centerY}
          stroke={colors.axisStroke}
          strokeWidth={0.4}
          strokeDasharray="1 1"
        />
        <line
          x1={geometry.centerX}
          y1={0}
          x2={geometry.centerX}
          y2={geometry.viewH}
          stroke={colors.axisStroke}
          strokeWidth={0.4}
          strokeDasharray="1 1"
        />

        <ellipse
          cx={geometry.centerX}
          cy={geometry.centerY}
          rx={geometry.waferRadius}
          ry={geometry.waferRadius}
          fill="none"
          stroke={colors.circleStroke}
          strokeOpacity={0.7}
          strokeWidth={0.65}
        />

        <circle cx={geometry.centerX} cy={geometry.centerY} r={0.5} fill={colors.centerFill} />
      </svg>
    </div>
  );
};

export const WaferMapSvg = memo(WaferMapSvgComponent);
WaferMapSvg.displayName = "WaferMapSvg";

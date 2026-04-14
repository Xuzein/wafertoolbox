import type { ParsedAoiWaferMap } from "./wafer-overlay-types";
import { cn } from "@/lib/utils";

interface WaferMapSvgProps {
  map: ParsedAoiWaferMap;
  className?: string;
  palette?: WaferMapSvgPalette;
  cellFillMap?: Record<string, string>;
  cellLabels?: Record<string, string>;
  highlightedCellKey?: string | null;
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

export const WaferMapSvg: React.FC<WaferMapSvgProps> = ({
  map,
  className,
  palette,
  cellFillMap,
  cellLabels,
  highlightedCellKey,
}) => {
  const colors = { ...DEFAULT_PALETTE, ...palette };
  const paddingCell = 2;
  const mmPadding = 2;
  const cellW = map.xDies > 0 ? map.xDies : 1;
  const cellH = map.yDies > 0 ? map.yDies : 1;
  const padX = paddingCell * cellW + mmPadding;
  const padY = paddingCell * cellH + mmPadding;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;

  for (let rowIndex = 0; rowIndex < map.rowCount; rowIndex += 1) {
    for (let colIndex = 0; colIndex < map.colCount; colIndex += 1) {
      if (map.grid[rowIndex][colIndex] === "empty") {
        continue;
      }
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
  const viewBox = `${viewLeft} ${viewTop} ${viewW} ${viewH}`;

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center rounded-lg border border-border bg-card p-2",
        className,
      )}
    >
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
        role="img"
        aria-label={`wafer map ${map.fileName}`}
      >
        <rect
          x={0}
          y={0}
          width={viewW}
          height={viewH}
          fill={colors.backgroundFill}
        />

        {map.grid.map((row, rowIndex) =>
          row.map((state, colIndex) => {
            if (state === "empty") {
              return null;
            }
            const cellKey = `${rowIndex}-${colIndex}`;
            const fillColor =
              cellFillMap?.[cellKey] ?? (state === "pass" ? colors.passFill : colors.failFill);
            const isHighlighted = highlightedCellKey === cellKey;
            return (
              <rect
                key={`${rowIndex}-${colIndex}`}
                x={padX + colIndex * cellW}
                y={padY + rowIndex * cellH}
                width={cellW}
                height={cellH}
                fill={fillColor}
                stroke={isHighlighted ? "var(--chart-2)" : colors.borderStroke}
                strokeWidth={isHighlighted ? 0.2 : 0.04}
              />
            );
          }),
        )}

        {cellLabels &&
          Object.entries(cellLabels).map(([cellKey, label]) => {
            const [row, col] = cellKey.split("-").map((v) => Number.parseInt(v, 10));
            if (!Number.isFinite(row) || !Number.isFinite(col)) {
              return null;
            }
            const x = padX + col * cellW + cellW / 2;
            const y = padY + row * cellH + cellH / 2;
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
                style={{ fontSize: `${Math.max(0.45, Math.min(cellW, cellH) * 0.55)}px` }}
              >
                {label}
              </text>
            );
          })}

        <line
          x1={0}
          y1={centerY}
          x2={viewW}
          y2={centerY}
          stroke={colors.axisStroke}
          strokeWidth={0.4}
          strokeDasharray="1 1"
        />
        <line
          x1={centerX}
          y1={0}
          x2={centerX}
          y2={viewH}
          stroke={colors.axisStroke}
          strokeWidth={0.4}
          strokeDasharray="1 1"
        />

        <ellipse
          cx={centerX}
          cy={centerY}
          rx={waferRadius}
          ry={waferRadius}
          fill="none"
          stroke={colors.circleStroke}
          strokeOpacity={0.7}
          strokeWidth={0.65}
        />

        <circle cx={centerX} cy={centerY} r={0.5} fill={colors.centerFill} />
      </svg>
    </div>
  );
};

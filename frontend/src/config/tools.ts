import type { IconifyIcon } from "@iconify/react";

export interface ToolItem {
  id: string;
  name: string;
  description: string;
  icon: string | IconifyIcon;
  path: string;
  category?: string;
}

export const tools: ToolItem[] = [
  {
    id: "aoi-map-diff",
    name: "AOI Map Gap",
    description: "比较两个AOI map，输出wafer gap点。",
    icon: "tabler--zoom-scan",
    path: "/tools/aoi-map-diff",
    category: "Wafer工具",
  },
  {
    id: "wafer-overlay",
    name: "AOI Wafer Overlay",
    description: "解析AOI map并叠加多个wafer结果。",
    icon: "tabler--target-arrow",
    path: "/tools/wafer-overlay",
    category: "Wafer工具",
  },
  {
    id: "csv-test-merge",
    name: "CSV Wafer Fusion",
    description: "上传多个 Summary CSV，按测试项合并并导出 Excel。",
    icon: "lucide--file-spreadsheet",
    path: "/tools/csv-test-merge",
    category: "CP工具",
  },
  {
    id: "ibe-thickness",
    name: "Wafer Topography Studio",
    description: "Build premium 2D heat maps and interactive 3D surface views from IBE X/Y/Z CSV data.",
    icon: "tabler--temperature-plus",
    path: "/tools/ibe-thickness",
    category: "Wafer工具",
  },
];

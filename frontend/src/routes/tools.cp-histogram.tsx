import { createFileRoute } from "@tanstack/react-router";
import CpHistogramView from "@/features/tools/cp-histogram/cp-histogram-view";

export const Route = createFileRoute("/tools/cp-histogram")({
  component: CpHistogramView,
});

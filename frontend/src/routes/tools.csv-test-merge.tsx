import CsvTestMergeView from "@/features/tools/csv-test-merge/csv-test-merge-view";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/csv-test-merge")({
  component: CsvTestMergeView,
});


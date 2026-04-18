import IbeThicknessView from "@/features/tools/ibe-thickness/ibe-thickness-view";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/ibe-thickness")({
  component: IbeThicknessView,
});

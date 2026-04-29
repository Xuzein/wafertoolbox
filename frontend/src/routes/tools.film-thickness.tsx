import { createFileRoute } from "@tanstack/react-router";
import FilmThicknessView from "@/features/tools/film-thickness/film-thickness-view";

export const Route = createFileRoute("/tools/film-thickness")({
  component: FilmThicknessView,
});

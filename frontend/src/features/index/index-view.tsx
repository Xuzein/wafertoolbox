import { Link } from "@tanstack/react-router";
import { useAppTitle } from "@/components/layout/app-title-context";
import { tools } from "@/config/tools";
import { cn } from "@/lib/utils";

const getToolIconTheme = (toolId: string) => {
  switch (toolId) {
    case "aoi-map-diff":
      return {
        box: "bg-chart-2/15 group-hover:bg-chart-2/25",
        icon: "text-chart-2",
      };
    case "wafer-overlay":
      return {
        box: "bg-chart-1/15 group-hover:bg-chart-1/25",
        icon: "text-chart-1",
      };
    case "csv-test-merge":
      return {
        box: "bg-chart-4/15 group-hover:bg-chart-4/25",
        icon: "text-chart-4",
      };
    default:
      return {
        box: "bg-primary/10 group-hover:bg-primary/20",
        icon: "text-primary",
      };
  }
};

const IndexView: React.FC = () => {
  useAppTitle({
    title: "首页",
  });

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1280px] flex-col p-6">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold text-foreground">工具箱</h1>
        <p className="mt-1 text-sm text-muted-foreground">选择工具开始使用</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tools.map((tool) => {
          const iconTheme = getToolIconTheme(tool.id);
          return (
            <Link
              key={tool.id}
              to={tool.path}
              className="group relative flex min-h-[204px] flex-col overflow-hidden rounded-xl border border-input/70 bg-card p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-card hover:shadow-md"
            >
            {tool.category === "Wafer工具" && (
              <div className="pointer-events-none absolute right-3 top-3 z-0 w-[24%] max-w-[76px] opacity-45 transition-all duration-200 group-hover:opacity-85 group-hover:brightness-110 group-hover:saturate-150 group-focus-visible:opacity-85">
                <img
                  src="/starshine-logo.png"
                  alt="StarShine"
                  className="h-auto w-full object-contain"
                  onError={(event) => {
                    const wrapper = event.currentTarget.parentElement;
                    if (wrapper) {
                      wrapper.style.display = "none";
                    }
                  }}
                />
              </div>
            )}
            <div className="relative z-10 mt-6 flex items-start gap-3">
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-md transition-colors",
                  iconTheme.box,
                )}
              >
                <span
                  className={cn("iconify h-6 w-6", tool.icon, iconTheme.icon)}
                />
              </div>
              <div className="min-w-0 pt-1">
                <h3 className="whitespace-nowrap text-sm font-medium text-card-foreground group-hover:text-foreground">
                  {tool.name}
                </h3>
              </div>
            </div>

            <p className="relative z-10 mt-5 line-clamp-2 rounded-lg bg-muted/55 px-3 py-2 text-xs leading-5 text-secondary-foreground/85">
              {tool.description}
            </p>

            <div className="relative z-10 mt-auto flex items-end justify-between pt-5">
              {tool.category && (
                <div>
                  <span className="inline-flex items-center rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {tool.category}
                  </span>
                </div>
              )}
              <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground/90">
                DESIGN BY IT
              </div>
            </div>
            </Link>
          );
        })}
      </div>

      {tools.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <span className="iconify lucide--tool-case mx-auto mb-3 h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无工具</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default IndexView;

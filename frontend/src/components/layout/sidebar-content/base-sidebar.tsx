import { Link, useRouterState } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { tools } from "@/config/tools";
import { SetAppearance } from "@wailsjs/go/main/App";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const themeOptions = [
  { value: "light", label: "浅色", icon: "lucide--sun" },
  { value: "dark", label: "深色", icon: "lucide--moon" },
  { value: "system", label: "跟随系统", icon: "lucide--monitor" },
] as const;

const SettingsPopover = () => {
  const { theme, setTheme } = useTheme();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="iconify lucide--settings w-4 h-4 shrink-0" />
          <span>设置</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56 p-2 border-none outline-none">
        {/* Theme Selection */}
        <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          主题
        </div>
        <div className="space-y-0.5">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setTheme(opt.value);
                SetAppearance(opt.value);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                theme === opt.value
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-popover-foreground hover:bg-accent",
              )}
            >
              <span
                className={cn("iconify", opt.icon, "w-3.5 h-3.5 shrink-0")}
              />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>

        {/* Version Info */}
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
            <span className="iconify lucide--info w-3.5 h-3.5 shrink-0" />
            <span>版本 v0.0.1</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

// Base nav item styles
const navItemClasses =
  "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

const activeNavClasses =
  "bg-chart-2 text-white font-medium shadow-sm";

const inactiveNavClasses = "text-sidebar-foreground/80";

const getSidebarIconTheme = (toolId: string) => {
  switch (toolId) {
    case "aoi-map-diff":
      return {
        box: "bg-chart-2/20",
        icon: "text-chart-2",
      };
    case "wafer-overlay":
      return {
        box: "bg-chart-1/20",
        icon: "text-chart-1",
      };
    default:
      return {
        box: "bg-primary/10",
        icon: "text-primary",
      };
  }
};

export const BaseSidebar = () => {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  // Check if home is active (only when exactly at "/")
  const isHomeActive = currentPath === "/";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tools List */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="space-y-0.5">
          {/* Home Entry */}
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className={cn(
              navItemClasses,
              isHomeActive ? activeNavClasses : inactiveNavClasses,
            )}
          >
            <span
              className={cn(
                "iconify lucide--home w-4 h-4 shrink-0",
                isHomeActive ? "text-white" : "text-primary",
              )}
            />
            <span>首页</span>
          </Link>

          {tools.map((tool) => {
            const isActive = currentPath === tool.path;
            const iconTheme = getSidebarIconTheme(tool.id);
            return (
              <Link
                key={tool.id}
                to={tool.path}
                activeOptions={{ exact: true }}
                className={cn(
                  navItemClasses,
                  isActive ? activeNavClasses : inactiveNavClasses,
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm",
                    isActive ? "bg-primary-foreground/20" : iconTheme.box,
                  )}
                >
                  <span
                    className={cn(
                      "iconify w-3.5 h-3.5",
                      tool.icon,
                      isActive ? "text-primary-foreground" : iconTheme.icon,
                    )}
                  />
                </span>
                <span className="truncate">{tool.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer - Settings */}
      <div className="shrink-0 p-2">
        <SettingsPopover />
      </div>
    </div>
  );
};

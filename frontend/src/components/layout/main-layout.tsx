import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Environment } from "@wailsjs/runtime/runtime";
import { SetAppearance } from "@wailsjs/go/main/App";
import { AppTitleProvider } from "./app-title-context";
import { BaseSidebar } from "./sidebar-content/base-sidebar";
import { TitleBar } from "./title-bar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SidebarHeader = () => {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    Environment().then((env) => {
      setIsMac(env.platform === "darwin");
    });
  }, []);

  return (
    <div
      className={`z-100 shrink-0 px-3 pb-3 ${isMac ? "mt-8" : "mt-3"} flex items-center justify-between`}
    >
      <div className="flex items-center gap-2">
        <span className="iconify lucide--tool-case h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-wide text-sidebar-foreground">
          Waferbox
        </span>
      </div>

      <div className="flex items-center gap-1"></div>
    </div>
  );
};

export const MainLayout = () => {
  const [isWindows, setIsWindows] = useState(false);
  const [password, setPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [authError, setAuthError] = useState("");
  const { theme } = useTheme();

  useEffect(() => {
    Environment().then((env) => {
      setIsWindows(env.platform === "windows");
      document.documentElement.classList.toggle(
        "platform-mac",
        env.platform === "darwin",
      );
      document.documentElement.classList.toggle(
        "platform-windows",
        env.platform === "windows",
      );
    });
  }, []);

  // Sync native window appearance with frontend theme.
  // We pass the raw `theme` ("system" | "light" | "dark") so that Go can
  // both apply the native appearance and persist the preference for next launch.
  useEffect(() => {
    if (theme) {
      SetAppearance(theme);
    }
  }, [theme]);

  return (
    <AppTitleProvider>
      <div className="relative flex h-screen w-screen bg-transparent">
        {/* Sidebar */}
        <aside
          className={`flex h-full w-52 flex-col text-sidebar-foreground select-none relative z-10 ${
            isWindows
              ? "border-r border-sidebar-border bg-sidebar"
              : "bg-transparent"
          }`}
        >
          {/* Header with Navigation Buttons */}
          <SidebarHeader />

          {/* Dynamic Sidebar Content */}
          <BaseSidebar />
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden bg-background">
          <div className="flex h-full flex-col overflow-hidden">
            <TitleBar />
            <section className="min-h-0 flex-1 overflow-auto bg-muted/30">
              <Outlet />
            </section>
          </div>
        </main>

        {!isUnlocked && (
          <div className="absolute inset-0 z-[120] flex items-center justify-center bg-background/50 backdrop-blur-md transition-all duration-500">
            {/* Ambient background glow for login */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none animate-glow" />
            
            <div className="w-full max-w-sm rounded-2xl glass-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl animate-fade-in-up flex flex-col items-center">
              <div className="mb-2 text-2xl font-semibold tracking-tight text-foreground bg-clip-text">
                验证身份
              </div>
              <div className="mb-6 text-sm text-muted-foreground text-center">
                请输入访问密码以继续使用系统
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (password === "starshine") {
                    setIsUnlocked(true);
                    setAuthError("");
                    return;
                  }
                  setAuthError("密码错误");
                }}
                className="w-full space-y-4"
              >
                <div className="space-y-1">
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    autoFocus
                    className="h-10 transition-all duration-300 focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring"
                  />
                  {authError && (
                    <div className="text-xs text-destructive mt-1 animate-fade-in-up">{authError}</div>
                  )}
                </div>
                <Button type="submit" className="w-full h-10 hover-lift">
                  进入系统
                </Button>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppTitleProvider>
  );
};

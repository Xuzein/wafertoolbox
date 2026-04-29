import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Environment, WindowHide } from "@wailsjs/runtime/runtime";
import { SetAppearance } from "@wailsjs/go/main/App";
import { AppTitleProvider } from "./app-title-context";
import { BaseSidebar } from "./sidebar-content/base-sidebar";
import { TitleBar } from "./title-bar";
import { signInHttp } from "@/@api/auth/auth.api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_USERNAME_KEY = "auth_username";
const LOCAL_ADMIN_USER_ID = "admin";
const LOCAL_ADMIN_PASSWORD = "1";
const LOCAL_ADMIN_TOKEN = "local-admin-token";

const getLoginErrorMessage = (message?: string) => {
  if (!message) {
    return "登录失败，请稍后重试";
  }

  if (message.includes("LOGIN.PASSWORD_NOT_CORRECT")) {
    return "账号或密码输入不正确";
  }

  return message;
};

const SidebarHeader = () => {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    Environment().then((env) => {
      setIsMac(env.platform === "darwin");
    });
  }, []);

  return (
    <div
      className={`drag-el z-100 shrink-0 border-b border-sidebar-border/80 px-3 pb-3 ${isMac ? "mt-8" : "mt-3"} flex items-center justify-between`}
    >
      <div className="flex items-center gap-2">
        <span className="iconify lucide--tool-case h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-wide text-sidebar-foreground">
          Waferbox
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground"></div>
    </div>
  );
};

export const MainLayout = () => {
  const [isWindows, setIsWindows] = useState(false);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const { resolvedTheme } = useTheme();

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

    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const storedUsername = localStorage.getItem(AUTH_USERNAME_KEY) ?? "";
    if (token) {
      setUsername(storedUsername);
      setIsUnlocked(true);
    }
  }, []);

  // Sync native window appearance with frontend theme
  useEffect(() => {
    if (resolvedTheme) {
      SetAppearance(resolvedTheme);
    }
  }, [resolvedTheme]);

  const onLogin = async () => {
    const trimmedUserId = userId.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUserId || !trimmedPassword) {
      setLoginError("请输入账户和密码");
      return;
    }

    setIsSubmitting(true);
    setLoginError("");
    try {
      if (
        trimmedUserId.toLowerCase() === LOCAL_ADMIN_USER_ID &&
        trimmedPassword === LOCAL_ADMIN_PASSWORD
      ) {
        localStorage.setItem(AUTH_TOKEN_KEY, LOCAL_ADMIN_TOKEN);
        localStorage.setItem(AUTH_USERNAME_KEY, LOCAL_ADMIN_USER_ID);
        setUsername(LOCAL_ADMIN_USER_ID);
        setIsUnlocked(true);
        setPassword("");
        return;
      }

      const result = await signInHttp({
        userId: trimmedUserId,
        password: trimmedPassword,
      });

      if (!result.success || !result.data?.token) {
        setLoginError(getLoginErrorMessage(result.msg));
        return;
      }

      localStorage.setItem(AUTH_TOKEN_KEY, result.data.token);
      const displayUsername = (result.data.username ?? "").trim();
      localStorage.setItem(AUTH_USERNAME_KEY, displayUsername);
      setUsername(displayUsername);
      setIsUnlocked(true);
      setPassword("");
    } catch (error) {
      console.error(error);
      setLoginError("登录请求失败，请检查网络或接口地址");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onLogout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
    setUsername("");
    setPassword("");
    setLoginError("");
    setIsUnlocked(false);
  };

  return (
    <AppTitleProvider>
      <div className="relative flex h-screen w-screen bg-background/95">
        {/* Sidebar */}
        <aside
          className={`
            drag-el flex h-full w-56 shrink-0 flex-col select-none text-sidebar-foreground
            border-r border-sidebar-border bg-sidebar
            ${isWindows ? "" : "backdrop-blur-sm"}
          `}
        >
          {/* Header with Navigation Buttons */}
          <SidebarHeader />

          {/* Dynamic Sidebar Content */}
          <BaseSidebar username={username} onLogout={onLogout} />
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden bg-background/70">
          <div className="flex h-full flex-col overflow-hidden">
            <TitleBar />
            <section className="min-h-0 flex-1 overflow-auto">
              <Outlet />
            </section>
          </div>
        </main>

        <Dialog open={!isUnlocked}>
          <DialogContent
            showCloseButton={false}
            overlayClassName="drag-el bg-background"
            className="no-drag max-w-[420px] overflow-hidden rounded-3xl border border-border/50 bg-card/95 p-0 shadow-xl backdrop-blur-sm"
          >
            <button
              type="button"
              className="no-drag absolute left-2.5 top-2.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-transparent text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
              aria-label="关闭"
              onClick={() => WindowHide()}
            >
              <span className="iconify lucide--x h-4 w-4" />
            </button>
            <div className="h-1 w-full bg-gradient-to-r from-chart-2/90 via-chart-2 to-chart-1/90" />
            <div className="drag-el h-6 w-full" />
            <div className="space-y-5 px-8 pb-8 pt-2">
              <DialogHeader className="space-y-3 text-center">
                <div className="flex h-10 items-center justify-center">
                  <img
                    src="/starshine-logo.png"
                    alt="StarShine"
                    className="h-8 w-auto object-contain"
                  />
                </div>
                <div className="space-y-1 text-center">
                  <DialogTitle className="text-[28px] font-semibold leading-none tracking-tight text-foreground">
                    欢迎登录
                  </DialogTitle>
                </div>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">账户</div>
                  <Input
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                    placeholder="请输入账户"
                    autoFocus
                    className="no-drag h-11 rounded-xl border-border bg-background/90 px-3 text-foreground placeholder:text-muted-foreground focus-visible:border-chart-2 focus-visible:ring-chart-2/30"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">密码</div>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    className="no-drag h-11 rounded-xl border-border bg-background/90 px-3 text-foreground placeholder:text-muted-foreground focus-visible:border-chart-2 focus-visible:ring-chart-2/30"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void onLogin();
                      }
                    }}
                  />
                </div>

                <div
                  className={`min-h-11 rounded-xl px-3 py-2 text-sm transition-colors ${
                    loginError
                      ? "border border-destructive/30 bg-destructive/8 text-destructive"
                      : "border border-transparent bg-transparent text-transparent"
                  }`}
                >
                  {loginError || "占位提示"}
                </div>
              </div>

              <DialogFooter className="pt-1">
                <Button
                  onClick={() => {
                    void onLogin();
                  }}
                  disabled={isSubmitting}
                  className="no-drag h-11 w-full rounded-xl bg-gradient-to-r from-chart-2 to-blue-500 text-white font-semibold tracking-wide shadow-md shadow-chart-2/25 transition-all hover:brightness-105"
                >
                  <span>{isSubmitting ? "登录中..." : "登录"}</span>
                  <span
                    className={`iconify lucide--arrow-right ml-2 h-4 w-4 ${
                      isSubmitting ? "opacity-0" : "opacity-100"
                    }`}
                  />
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppTitleProvider>
  );
};

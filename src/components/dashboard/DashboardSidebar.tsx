"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  BookOpen,
  BarChart2,
  Settings,
  LogOut,
  Zap,
  X,
  Menu,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { unsubscribePushDevice } from "@/lib/push";
import { useRouter } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/assignments", label: "Assignments", icon: BookOpen },
  { href: "/dashboard/insights", label: "Insights", icon: BarChart2 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function NavItems({
  pathname,
  collapsed,
  onClick,
  rail = false,
}: {
  pathname: string;
  collapsed: boolean;
  onClick?: () => void;
  rail?: boolean;
}) {
  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <nav className={`flex-1 py-3 ${rail ? "px-0" : "px-2 space-y-0.5"}`} aria-label="Main navigation">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onClick}
            aria-current={active ? "page" : undefined}
            aria-label={label}
            className={[
              "flex items-center px-3 text-sm font-medium transition-colors duration-150",
              rail ? "flex-col justify-center gap-1.5 py-4 rounded-none" : "gap-3 py-2.5 rounded-sm",
              collapsed ? "justify-center" : "",
              active
                ? "border border-transparent bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground border border-transparent",
            ].join(" ")}
            title={collapsed ? label : undefined}
          >
            <Icon size={rail ? 24 : 17} className={active ? "text-primary" : ""} />
            {!collapsed && <span>{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export default function DashboardSidebar({
  email,
  initial,
}: {
  email?: string;
  initial?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem("sidebar_collapsed");
      return stored === "true";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar_collapsed", String(next)); } catch {}
  }

  async function handleSignOut() {
    // Tear down push BEFORE signOut: the DELETE endpoint needs a valid
    // session, and the browser subscription would otherwise keep receiving
    // nudges after logout.
    await unsubscribePushDevice();
    await createClient().auth.signOut({ scope: "local" });
    router.push("/");
  }

  return (
    <>
      {/* ── Mobile hamburger ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-50 w-8 h-8 rounded-sm bg-card border border-border flex items-center justify-center text-foreground hover:text-primary-hover"
        aria-label="Open menu"
      >
        <Menu size={16} />
      </button>

      {/* ── Mobile drawer ────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-overlay/55"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-full shadow-lg">
            <div className="flex items-center justify-between px-5 py-5 border-b border-sidebar-border">
              <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-primary/40 bg-primary-soft">
                  <Zap size={14} className="text-primary" fill="currentColor" />
                </div>
                <span className="font-bold text-sidebar-foreground tracking-tight">CourseCue</span>
              </Link>
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="text-sidebar-muted hover:text-sidebar-muted bg-transparent">
                <X size={18} />
              </button>
            </div>
            <NavItems pathname={pathname} collapsed={false} onClick={() => setMobileOpen(false)} />
            <div className="border-t border-sidebar-border">
              {email && initial && (
                <Link href="/dashboard/settings#account" onClick={() => setMobileOpen(false)} aria-label="Account settings" className="flex items-center gap-3 px-4 py-3 border-b border-sidebar-border hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-foreground">
                  <div className="w-7 h-7 rounded-full bg-primary-soft border border-primary/30 flex items-center justify-center text-primary font-semibold text-xs shrink-0">
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sidebar-foreground text-xs font-medium truncate">Account</p>
                    <p className="text-sidebar-muted text-[11px] truncate">{email}</p>
                  </div>
                </Link>
              )}
              <div className="p-3">
                <button type="button" onClick={() => { setMobileOpen(false); setShowSignOutConfirm(true); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors bg-transparent border border-transparent">
                  <LogOut size={17} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside
        className={[
          "hidden lg:flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar min-h-screen sticky top-0 h-screen transition-all duration-200",
          collapsed ? "w-16" : "w-24",
        ].join(" ")}
      >
        {/* Logo */}
        <div className="flex justify-center px-2 py-6">
          <Link href="/dashboard" aria-label="CourseCue dashboard" title="CourseCue" className="text-sidebar-foreground">
            <Zap size={30} fill="currentColor" aria-hidden="true" />
          </Link>
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapse}
            className="w-full flex items-center justify-center py-2 text-sidebar-muted hover:text-sidebar-muted bg-transparent transition-colors"
            aria-label="Expand sidebar"
          >
            <ChevronRight size={14} />
          </button>
        )}

        <NavItems pathname={pathname} collapsed={collapsed} rail />

        {/* User info + sign out */}
        <div className="border-t border-sidebar-border">
          {email && initial && (
            <Link href="/dashboard/settings#account" aria-label="Account settings" className="flex flex-col items-center gap-1.5 px-2 py-3 hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-foreground" title={email}>
              <div className="w-8 h-8 rounded-full border border-sidebar-muted flex items-center justify-center text-sidebar-foreground font-semibold text-sm shrink-0">
                {initial}
              </div>
              {!collapsed && <p className="text-sidebar-foreground text-xs">Account</p>}
            </Link>
          )}
          <div className="p-2">
            <button
              type="button"
              onClick={() => setShowSignOutConfirm(true)}
              aria-label="Sign out"
              className={[
                "w-full flex flex-col items-center gap-1.5 px-2 py-3 rounded-sm text-xs font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors bg-transparent border border-transparent",
                collapsed ? "justify-center" : "",
              ].join(" ")}
              title={collapsed ? "Sign out" : undefined}
            >
              <LogOut size={17} />
              {!collapsed && <span>Sign out</span>}
            </button>
          </div>
          {!collapsed && <button type="button" onClick={toggleCollapse} aria-label="Collapse sidebar" className="flex min-h-11 w-full items-center justify-center text-sidebar-muted hover:bg-sidebar-accent"><ChevronLeft size={20} /></button>}
        </div>
      </aside>
      {/* Sign-out confirmation modal */}
      {showSignOutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-overlay/55" onClick={() => setShowSignOutConfirm(false)} />
          <div className="relative w-full max-w-sm rounded-md bg-card border border-border p-6 shadow-lg">
            <h3 className="text-foreground font-semibold text-base mb-2">Sign out</h3>
            <p className="text-muted-foreground text-sm mb-6">Are you sure you want to sign out? You can sign back in anytime.</p>
            <div className="flex items-center gap-3 justify-end">
              <button type="button" onClick={() => setShowSignOutConfirm(false)}
                className="rounded-sm border border-border bg-background text-muted-foreground hover:text-foreground text-sm font-medium px-4 py-2 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleSignOut}
                className="rounded-sm bg-danger hover:bg-danger-hover text-white text-sm font-medium px-4 py-2 transition-colors">
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

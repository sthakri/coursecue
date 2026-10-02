import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/push", () => ({ unsubscribePushDevice: vi.fn() }));

import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

afterEach(() => vi.unstubAllGlobals());

describe("account navigation", () => {
  it.each([false, true])("keeps account settings reachable when collapsed=%s", (collapsed) => {
    vi.stubGlobal("localStorage", { getItem: () => String(collapsed) });
    const html = renderToStaticMarkup(React.createElement(DashboardSidebar, { email: "student@example.test", initial: "S" }));
    const link = html.match(/<a[^>]*aria-label="Account settings"[^>]*>/)?.[0];
    expect(link).toContain('href="/dashboard/settings#account"');
  });
});

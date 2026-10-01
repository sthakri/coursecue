import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import InstallPage from "@/app/install/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

describe("install page hydration", () => {
  it.each([
    { userAgent: "Android Chrome", standalone: false },
    { userAgent: "iPhone Safari", standalone: true },
  ])("keeps the initial markup stable on $userAgent (standalone=$standalone)", (device) => {
    const serverMarkup = renderToString(createElement(InstallPage));
    const navigator = { userAgent: device.userAgent, standalone: device.standalone, maxTouchPoints: 5 };
    vi.stubGlobal("navigator", navigator);
    vi.stubGlobal("window", { navigator, matchMedia: () => ({ matches: device.standalone }) });
    expect(renderToString(createElement(InstallPage))).toBe(serverMarkup);
  });
});

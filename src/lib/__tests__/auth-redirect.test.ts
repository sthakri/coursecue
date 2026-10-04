import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { GET } from "@/app/auth/callback/route";

describe("post-auth redirect", () => {
  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)"])("rejects external target %s", async next => {
    const result = await GET(new NextRequest(`https://coursecue.example/auth/callback?next=${encodeURIComponent(next)}`));
    expect(result.headers.get("location")).toBe("https://coursecue.example/onboarding");
  });
  it("preserves a same-origin planner destination", async () => {
    const result = await GET(new NextRequest("https://coursecue.example/auth/callback?next=%2Fdashboard%2Fassignments"));
    expect(result.headers.get("location")).toBe("https://coursecue.example/dashboard/assignments");
  });
});

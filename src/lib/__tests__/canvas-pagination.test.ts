vi.mock("@/lib/canvas-request", () => ({ canvasRequest: (...args: unknown[]) => fetch(...args as Parameters<typeof fetch>) }));
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllPages, getCanvasAssignments } from "@/lib/canvas";

const HOST = "https://school.instructure.com";

it("keeps planner coursework when a listed course forbids its assignments endpoint", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([
    { course_id: 1, plannable_type: "assignment", plannable_id: 91, plannable: { title: "Visible exam" } },
  ])).mockResolvedValueOnce(new Response(null, { status: 403 })));
  const result = await getCanvasAssignments("tok", "school.instructure.com", [{ id: 1, name: "Restricted course" }]);
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe("Visible exam");
});

it("imports undated quizzes and assignments with submission status and skips unpublished work", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([
      { id: 91, name: "Undated practice quiz", due_at: null, published: true, submission: { workflow_state: "submitted" } },
      { id: 92, name: "Reading", due_at: null, published: true },
      { id: 93, name: "Draft exam", published: false },
    ]));
  vi.stubGlobal("fetch", fetchMock);
  const result = await getCanvasAssignments("tok", "school.instructure.com", [{ id: 1, name: "Course" }]);
  expect(result).toEqual([
    expect.objectContaining({ canvas_assignment_id: 91, title: "Undated practice quiz", due_at: null, is_completed: true }),
    expect.objectContaining({ canvas_assignment_id: 92, title: "Reading", due_at: null, is_completed: false }),
  ]);
  expect(fetchMock.mock.calls[1][0]).toContain("bucket=undated&include[]=submission");
});

function page(body: unknown[], link?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: link ? { Link: link } : undefined,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAllPages", () => {
  // Regression: any response with a Link header used to throw
  // TypeError "Invalid URL" (host was read from nextUrl AFTER clearing it),
  // which killed every sync at the API layer with toast "Invalid URL".
  it("follows a same-host next link and accumulates all pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page([{ id: 1 }], `<${HOST}/api/v1/x?page=2>; rel="next"`))
      .mockResolvedValueOnce(page([{ id: 2 }], `<${HOST}/api/v1/x?page=1>; rel="first"`));
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchAllPages<{ id: number }>("tok", "school.instructure.com", `${HOST}/api/v1/x`);

    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${HOST}/api/v1/x?page=2`);
  });

  it("stops paging when the next link points at a different host (token safety)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page([{ id: 1 }], `<https://evil.example.com/api/v1/x?page=2>; rel="next"`));
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchAllPages<{ id: number }>("tok", "school.instructure.com", `${HOST}/api/v1/x`);

    expect(items).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles a single page without a Link header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchAllPages<{ id: number }>("tok", "school.instructure.com", `${HOST}/api/v1/x`);

    expect(items).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it("never sends a bearer token on a plaintext pagination URL", async () => {
  const fetchMock = vi.fn().mockResolvedValue(page([{ id: 1 }], '<http://school.instructure.com/api/v1/x?page=2>; rel="next"'));
  vi.stubGlobal("fetch", fetchMock);
  await fetchAllPages("tok", "school.instructure.com", `${HOST}/api/v1/x`);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects redirects without requesting their destination", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://127.0.0.1" } }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchAllPages("tok", "school.instructure.com", `${HOST}/api/v1/x`)).rejects.toThrow("HTTP 302");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not accept a truncated result at the pagination cap", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => page([{ id: 1 }], `<${HOST}/api/v1/x?page=2>; rel="next"`)));
  await expect(fetchAllPages("tok", "school.instructure.com", `${HOST}/api/v1/x`)).rejects.toThrow("too many pages");
});

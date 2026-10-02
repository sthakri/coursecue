import { TablesInsert } from "@/database.types";

type CanvasAssignment = Omit<TablesInsert<"assignments">, "user_id" | "course_id"> & {
  canvas_course_id: number;
};

export type CanvasCourse = {
  id: number;
  name: string;
  course_code?: string;
};

// ponytail: one subclass beats a string sniff. 401 is the only auth signal
// Canvas returns; everything else stays a generic Error.
export class CanvasAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasAuthError";
  }
}

const ALLOWED_CANVAS_DOMAINS = /^(?:(?:[a-zA-Z0-9-]+\.)+(?:instructure\.com|instructure\.io)|[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,})$/;

function isPrivateIP(hostname: string): boolean {
  return /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|0\.|127\.|169\.254\.|fc|fe80)/i.test(hostname);
}

async function validateCanvasDomain(domain: string): Promise<void> {
  const hostname = domain.replace(/:\d+$/, "").toLowerCase();
  if (isPrivateIP(hostname)) {
    throw new Error(`Blocked private/internal domain: "${domain}".`);
  }
  if (!ALLOWED_CANVAS_DOMAINS.test(hostname)) {
    throw new Error(
      `Blocked disallowed Canvas domain: "${domain}". Only *.instructure.com, *.instructure.io, or standard school domains are permitted.`
    );
  }
  // DNS resolves HERE, server-side: a hostname that passes the allowlist regex
  // can still point at internal IPs (SSRF). Resolve and reject private ranges.
  const { promises: dns } = await import("dns");
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    for (const { address } of addrs) {
      if (isPrivateIP(address)) {
        throw new Error(`Blocked domain resolving to private IP: "${domain}".`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Blocked")) throw err;
    throw new Error(`Canvas domain does not resolve: "${domain}".`);
  }
}

export async function fetchAllPages<T>(
  token: string,
  domain: string,
  url: string
): Promise<T[]> {
  const all: T[] = [];
  let nextUrl = url;
  let pageCount = 0;
  const MAX_PAGES = 50;

  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new CanvasAuthError(`Canvas returned 401 — token expired or revoked`);
      }
      throw new Error(`Canvas API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data: T[] = await response.json();
    all.push(...data);

    const linkHeader = response.headers.get("Link");
    // Host of the page we JUST fetched, captured before clearing nextUrl.
    // (This used to read nextUrl after clearing it, so any Link header
    // threw "Invalid URL" and killed every sync.)
    const expectedHost = new URL(nextUrl).host;
    nextUrl = "";
    if (linkHeader) {
      // The "next" URL carries our Bearer token on the NEXT request, so it
      // must stay on the same host — a hostile/compromised Canvas host could
      // otherwise redirect pagination anywhere and exfiltrate the token.
      for (const link of linkHeader.split(",")) {
        const match = link.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          try {
            if (new URL(match[1]).host === expectedHost) nextUrl = match[1];
          } catch { /* not a URL — stop paging */ }
          break;
        }
      }
    }
  }

  return all;
}

export async function getCanvasCourses(
  token: string,
  domain: string
): Promise<CanvasCourse[]> {
  await validateCanvasDomain(domain);

  const url = `https://${domain}/api/v1/courses?per_page=100&enrollment_state=active&enrollment_type=student&include[]=term`;
  const courses = await fetchAllPages<CanvasCourse>(token, domain, url);

  return courses.filter((c) => c.name && c.name.trim() !== "");
}

export function isCanvasItemCompleted(item: Record<string, unknown>): boolean {
  const plannable = item.plannable as Record<string, unknown> | undefined;
  const submissions = item.submissions;
  const plannerOverride = item.planner_override as Record<string, unknown> | undefined;

  // 1. Check student planner override (marked complete in Canvas UI).
  // NOTE: `dismissed` is deliberately NOT completion — hiding an item in the
  // Canvas Planner is not doing the work. Counting it as completed inflated
  // completion rates and silently dropped items from overdue lists.
  if (plannerOverride?.marked_complete === true) {
    return true;
  }

  // 2. Check direct submissions boolean
  if (submissions === true) {
    return true;
  }

  // 3. Check submissions object
  if (typeof submissions === "object" && submissions !== null) {
    const sub = submissions as Record<string, unknown>;
    if (sub.submitted === true || sub.has_submission === true || sub.excused === true) {
      return true;
    }
    if (typeof sub.workflow_state === "string") {
      const state = sub.workflow_state.toLowerCase();
      if (["submitted", "graded", "pending_review", "complete"].includes(state)) {
        return true;
      }
    }
  }

  // 4. Check array submissions
  if (Array.isArray(submissions) && submissions.length > 0) {
    return submissions.some((s) => {
      if (typeof s === "object" && s !== null) {
        const sub = s as Record<string, unknown>;
        if (sub.submitted === true || sub.has_submission === true || sub.excused === true) return true;
        if (typeof sub.workflow_state === "string") {
          const state = sub.workflow_state.toLowerCase();
          return ["submitted", "graded", "pending_review", "complete"].includes(state);
        }
      }
      return false;
    });
  }

  // 5. Check plannable submission status
  if (plannable?.has_submitted_submissions === true) {
    return true;
  }

  return false;
}

// Canvas changes the type of gradable items in planner items: an assignment
// that links to a quiz arrives with plannable_type "quiz", and a graded
// discussion arrives as "discussion_topic" (planner_item_json in canvas-lms
// overwrites the type and plannable_id with the quiz or topic id). Filtering
// on "assignment" alone dropped every classic quiz and graded discussion.
const PLANNABLE_SYNCED_TYPES = new Set(["assignment", "quiz", "discussion_topic"]);

/**
 * Map one planner item to an assignment row, or null for types we do not
 * track (planner notes, wiki pages, calendar events, announcements).
 * Graded quizzes and discussions carry their real assignment id at
 * plannable.assignment_id. Use it so the row key stays in the assignment id
 * space. Ungraded ones have assignment_id null and fall back to plannable_id.
 * ponytail: quiz and discussion ids live in different tables than assignment
 * ids, so a same number collision is possible in theory; the full fix is a
 * type column in the schema, not worth it today.
 */
export function plannerItemToAssignment(item: unknown, domain: string): CanvasAssignment | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.plannable_type !== "string" || !PLANNABLE_SYNCED_TYPES.has(record.plannable_type)) {
    return null;
  }
  const plannable = record.plannable as Record<string, unknown> | undefined;
  // Some Canvas installs return a path-only html_url ("/courses/1/..."),
  // which would resolve against the CourseCue origin and 404. Make it absolute.
  const rawUrl = typeof record.html_url === "string" ? record.html_url : null;
  const html_url = rawUrl?.startsWith("/") ? `https://${domain}${rawUrl}` : rawUrl;
  return {
    canvas_assignment_id: Number(plannable?.assignment_id ?? record.plannable_id),
    canvas_course_id: Number(record.course_id),
    title: String(plannable?.title ?? ""),
    due_at: typeof plannable?.due_at === "string"
      ? plannable.due_at
      : typeof record.plannable_date === "string"
      ? record.plannable_date
      : null,
    points_possible:
      plannable?.points_possible != null
        ? Number(plannable.points_possible)
        : null,
    html_url,
    submission_types: Array.isArray(plannable?.submission_types)
      ? (plannable.submission_types as string[])
      : [],
    is_completed: isCanvasItemCompleted(record),
    priority: 3,
  };
}

export async function getCanvasAssignments(
  token: string,
  domain: string
): Promise<CanvasAssignment[]> {
  await validateCanvasDomain(domain);

  const today = new Date();
  const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    per_page: "100",
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  const assignmentsUrl = `https://${domain}/api/v1/planner/items?${params}`;
  const items = await fetchAllPages<unknown>(token, domain, assignmentsUrl);

  return items
    .map((item) => plannerItemToAssignment(item, domain))
    .filter((a): a is CanvasAssignment => a !== null);
}

export async function testCanvasConnection(
  token: string,
  domain: string
): Promise<{ success: boolean; courseCount: number; error?: string }> {
  try {
    await validateCanvasDomain(domain);

    const response = await fetch(
      `https://${domain}/api/v1/courses?per_page=50&enrollment_state=active&enrollment_type=student`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      return { success: false, courseCount: 0, error: `HTTP ${response.status}` };
    }

    const courses: unknown[] = await response.json();
    return { success: true, courseCount: courses.length };
  } catch (err) {
    return {
      success: false,
      courseCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

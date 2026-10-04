import { canvasRequest } from "@/lib/canvas-request";
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

class CanvasPermissionError extends Error {}

const ALLOWED_CANVAS_DOMAINS = /^(?:(?:[a-zA-Z0-9-]+\.)+(?:instructure\.com|instructure\.io)|[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,})$/;

function validateCanvasDomain(domain: string): void {
  if (!ALLOWED_CANVAS_DOMAINS.test(domain) || domain.includes(":")) {
    throw new Error("Enter the hostname of your school’s Canvas site, without a path or port.");
  }
}

export async function fetchAllPages<T>(
  token: string,
  domain: string,
  url: string
): Promise<T[]> {
  validateCanvasDomain(domain);
  const origin = `https://${domain.toLowerCase()}`;
  const all: T[] = [];
  let nextUrl = url;
  let pageCount = 0;
  const MAX_PAGES = 50;

  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    if (new URL(nextUrl).origin !== origin) throw new Error("Unsafe Canvas pagination URL");
    const response = await canvasRequest(nextUrl, token);

    if (!response.ok) {
      if (response.status === 401) {
        throw new CanvasAuthError(`Canvas returned 401 — token expired or revoked`);
      }
      if (response.status === 403) throw new CanvasPermissionError("Canvas did not allow access to this coursework.");
      throw new Error(`Canvas API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data: T[] = await response.json();
    if (!Array.isArray(data)) throw new Error("Unexpected Canvas response");
    all.push(...data);

    const linkHeader = response.headers.get("Link");
    // Host of the page we JUST fetched, captured before clearing nextUrl.
    // (This used to read nextUrl after clearing it, so any Link header
    // threw "Invalid URL" and killed every sync.)
    const expectedOrigin = origin;
    nextUrl = "";
    if (linkHeader) {
      // The "next" URL carries our Bearer token on the NEXT request, so it
      // must stay on the same host — a hostile/compromised Canvas host could
      // otherwise redirect pagination anywhere and exfiltrate the token.
      for (const link of linkHeader.split(",")) {
        const match = link.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          try {
            if (new URL(match[1]).origin === expectedOrigin) nextUrl = match[1];
          } catch { /* not a URL — stop paging */ }
          break;
        }
      }
    }
  }

  if (nextUrl) throw new Error("Canvas returned too many pages. Sync was not applied.");
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
 * Assignment-backed work keeps its Canvas assignment ID. Other quizzes use
 * negative even IDs; discussions use negative odd IDs, avoiding collisions.
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
  let html_url: string | null = null;
  try {
    const url = new URL(rawUrl ?? "", `https://${domain}`);
    if (rawUrl && url.origin === `https://${domain}` && !url.username && !url.password) html_url = url.href;
  } catch { /* Unusable external URLs never become links. */ }
  const itemId = Number(plannable?.assignment_id ?? record.plannable_id);
  const courseId = Number(record.course_id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(courseId) || courseId <= 0) return null;
  const nativeAssignment = record.plannable_type === "assignment" || plannable?.assignment_id != null;
  const canvasId = nativeAssignment ? itemId : -(itemId * 2 + (record.plannable_type === "quiz" ? 0 : 1));
  if (!Number.isSafeInteger(canvasId)) return null;
  return {
    canvas_assignment_id: canvasId,
    canvas_course_id: courseId,
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
  domain: string,
  courses: CanvasCourse[] = [],
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

  const assignments = items
    .map((item) => plannerItemToAssignment(item, domain))
    .filter((a): a is CanvasAssignment => a !== null);
  // The date-based planner omits work without a deadline. Fetch it separately
  // from each active course, including per-student submission status.
  for (let offset = 0; offset < courses.length; offset += 5) {
    const batches = await Promise.all(courses.slice(offset, offset + 5).map(async course => {
      let undated: Record<string, unknown>[];
      try {
        undated = await fetchAllPages<Record<string, unknown>>(token, domain,
          `https://${domain}/api/v1/courses/${course.id}/assignments?bucket=undated&include[]=submission&per_page=100`);
      } catch (error) {
        // A listed course can forbid its assignments endpoint (unpublished or
        // restricted course). Keep accessible planner work; never hide other failures.
        if (error instanceof CanvasPermissionError) return [];
        throw error;
      }
      return undated.filter(item => item.published !== false).map(item => plannerItemToAssignment({
        course_id: course.id, plannable_type: "assignment", plannable_id: item.id,
        html_url: item.html_url, plannable: { ...item, title: item.name }, submissions: item.submission,
      }, domain)).filter((item): item is CanvasAssignment => item !== null);
    }));
    assignments.push(...batches.flat());
  }
  return [...new Map(assignments.map(item => [item.canvas_assignment_id, item])).values()];
}

export async function testCanvasConnection(
  token: string,
  domain: string
): Promise<{ success: boolean; courseCount: number; error?: string }> {
  try {
    await validateCanvasDomain(domain);

    const response = await canvasRequest(
      `https://${domain}/api/v1/courses?per_page=50&enrollment_state=active&enrollment_type=student`, token
    );

    if (!response.ok) {
      const error = response.status === 401 || response.status === 403
        ? "Canvas couldn't verify your access token. Check it or create a new token, then try again."
        : response.status === 429
          ? "Canvas is receiving too many requests. Wait a few minutes, then try again."
          : "Canvas is unavailable right now. Please try again later.";
      return { success: false, courseCount: 0, error };
    }

    const courses: unknown[] = await response.json();
    return { success: true, courseCount: courses.length };
  } catch {
    return {
      success: false,
      courseCount: 0,
      error: "We couldn't connect to Canvas. Check your Canvas domain and connection, then try again.",
    };
  }
}

import { describe, it, expect } from "vitest";
import { plannerItemToAssignment } from "@/lib/canvas";

// Fixture shapes mirror canvas-lms planner_item_json output (verified against
// lib/api/v1/planner_item.rb): quiz-linked assignments arrive with
// plannable_type "quiz" and plannable_id pointing at the quiz, with the real
// assignment id at plannable.assignment_id.
const gradedQuizItem = {
  course_id: 100,
  plannable_type: "quiz",
  plannable_id: 555,
  plannable_date: "2026-09-20T15:00:00Z",
  html_url: "https://school.instructure.com/courses/100/quizzes/555",
  plannable: {
    id: 555,
    title: "Chapter 3 Quiz",
    due_at: "2026-09-20T15:00:00Z",
    points_possible: 25,
    assignment_id: 9001,
  },
  submissions: { submitted: false },
};

describe("plannerItemToAssignment", () => {
  it("keeps quizzes instead of dropping them (missed quiz regression)", () => {
    const result = plannerItemToAssignment(gradedQuizItem, "school.instructure.com");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Chapter 3 Quiz");
    expect(result!.canvas_course_id).toBe(100);
    expect(result!.due_at).toBe("2026-09-20T15:00:00Z");
  });

  it("uses the assignment id (not the quiz id) as the row key for graded quizzes", () => {
    const result = plannerItemToAssignment(gradedQuizItem, "school.instructure.com");
    expect(result!.canvas_assignment_id).toBe(9001);
  });

  it("makes path-only html_url absolute against the Canvas domain", () => {
    // Real payload from canvas.txstate.edu: planner items ship relative URLs.
    const result = plannerItemToAssignment(
      { ...gradedQuizItem, html_url: "/courses/100/quizzes/555" },
      "canvas.txstate.edu"
    );
    expect(result!.html_url).toBe("https://canvas.txstate.edu/courses/100/quizzes/555");
  });

  it("keeps ungraded quizzes in a separate identity namespace", () => {
    const ungradedQuiz = {
      course_id: 100,
      plannable_type: "quiz",
      plannable_id: 777,
      plannable_date: "2026-09-22T10:00:00Z",
      html_url: "https://school.instructure.com/courses/100/quizzes/777",
      plannable: {
        id: 777,
        title: "Practice Quiz",
        due_at: null,
        points_possible: 0,
        assignment_id: null,
      },
      submissions: false,
    };
    const result = plannerItemToAssignment(ungradedQuiz, "school.instructure.com");
    expect(result!.canvas_assignment_id).toBe(-1554);
    expect(result!.due_at).toBe("2026-09-22T10:00:00Z"); // plannable_date fallback
    expect(result!.is_completed).toBe(false);
  });

  it("keeps graded discussions, keyed by their assignment id", () => {
    const discussion = {
      course_id: 100,
      plannable_type: "discussion_topic",
      plannable_id: 42,
      html_url: "https://school.instructure.com/courses/100/discussion_topics/42",
      plannable: {
        id: 42,
        title: "Week 4 Discussion",
        due_at: "2026-09-25T23:59:00Z",
        points_possible: 10,
        assignment_id: 9010,
      },
      submissions: { submitted: true },
    };
    const result = plannerItemToAssignment(discussion, "school.instructure.com");
    expect(result!.canvas_assignment_id).toBe(9010);
    expect(result!.is_completed).toBe(true);
  });

  it("leaves plain assignments keyed by plannable_id (behavior unchanged)", () => {
    const assignment = {
      course_id: 100,
      plannable_type: "assignment",
      plannable_id: 1234,
      html_url: "https://school.instructure.com/courses/100/assignments/1234",
      plannable: {
        id: 1234,
        title: "Homework 5",
        due_at: "2026-09-18T23:59:00Z",
        points_possible: 50,
        submission_types: ["online_upload"],
      },
      submissions: { submitted: false },
    };
    const result = plannerItemToAssignment(assignment, "school.instructure.com");
    expect(result!.canvas_assignment_id).toBe(1234);
    expect(result!.submission_types).toEqual(["online_upload"]);
  });

  it("still skips non-gradable planner items", () => {
    const note = {
      plannable_type: "planner_note",
      plannable_id: 9,
      plannable: { id: 9, title: "bring books", todo_date: "2026-09-19T00:00:00Z" },
    };
    const page = { plannable_type: "wiki_page", plannable_id: 5, plannable: { id: 5, title: "Read p. 3" } };
    const event = { plannable_type: "calendar_event", plannable_id: 6, plannable: { id: 6, title: "Study hall" } };
    expect(plannerItemToAssignment(note, "x")).toBeNull();
    expect(plannerItemToAssignment(page, "x")).toBeNull();
    expect(plannerItemToAssignment(event, "x")).toBeNull();
    expect(plannerItemToAssignment(null, "x")).toBeNull();
    expect(plannerItemToAssignment("nope", "x")).toBeNull();
  });
});

it("separates assignment, quiz and discussion IDs even when Canvas reuses a number", () => {
  const ids = ["assignment", "quiz", "discussion_topic"].map(plannable_type => plannerItemToAssignment({
    course_id: 100, plannable_type, plannable_id: 42, plannable: { title: "Coursework" },
  }, "school.instructure.com")!.canvas_assignment_id);
  expect(new Set(ids).size).toBe(3);
});
it.each(["javascript:alert(1)", "https://other.example/course", "//other.example/course"])("does not expose unsafe coursework link %s", html_url => {
  expect(plannerItemToAssignment({ ...gradedQuizItem, html_url }, "school.instructure.com")!.html_url).toBeNull();
});

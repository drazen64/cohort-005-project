import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment, updateComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

describe("createComment", () => {
  it("posts a Discussion Question with a trimmed body, stamped at now", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How do closures work?  ",
      NOW
    );

    expect(question).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How do closures work?",
      createdAt: NOW.toISOString(),
    });
  });

  it("posts a Discussion Reply under a Discussion Question", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      NOW
    );

    expect(reply).toMatchObject({ parentId: question.id, body: "Because." });
  });

  it("keeps replies one level deep", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      NOW
    );

    expect(() =>
      createComment(db, base.user.id, lessonId, reply.id, "But why?", NOW)
    ).toThrow("Replies can only be one level deep");
  });

  it("refuses a reply to a question on another lesson", () => {
    const otherLessonId = db
      .insert(schema.lessons)
      .values({ moduleId: 1, title: "Lesson 2", position: 2 })
      .returning()
      .get().id;
    const question = createComment(
      db,
      base.user.id,
      otherLessonId,
      null,
      "Why?",
      NOW
    );

    expect(() =>
      createComment(
        db,
        base.instructor.id,
        lessonId,
        question.id,
        "Because.",
        NOW
      )
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("refuses an empty comment", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, null, "   ", NOW)
    ).toThrow("Comment cannot be empty");
  });
});

describe("updateComment", () => {
  it("lets the author edit their comment, stamping editedAt", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );

    expect(
      updateComment(db, question.id, base.user.id, " Why not? ", NOW)
    ).toMatchObject({
      body: "Why not?",
      editedAt: NOW.toISOString(),
    });
  });

  it("refuses an edit by anyone else", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );

    expect(() =>
      updateComment(db, question.id, base.instructor.id, "Hijacked", NOW)
    ).toThrow("You can only edit your own comments");
  });
});

describe("deleteComment", () => {
  it("lets the author soft-delete their comment at now", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );

    expect(
      deleteComment(db, question.id, base.user.id, false, NOW)
    ).toMatchObject({
      id: question.id,
      deletedAt: NOW.toISOString(),
    });
  });

  it("lets staff delete someone else's comment", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );

    expect(
      deleteComment(db, question.id, base.instructor.id, true, NOW).deletedAt
    ).toBe(NOW.toISOString());
  });

  it("refuses a non-staff user deleting someone else's comment", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );

    expect(() =>
      deleteComment(db, question.id, base.instructor.id, false, NOW)
    ).toThrow("You can only delete your own comments");
  });

  it("leaves an already-deleted comment as it was", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );
    deleteComment(db, question.id, base.user.id, false, NOW);
    const later = new Date(2026, 9, 7);

    expect(
      deleteComment(db, question.id, base.user.id, false, later).deletedAt
    ).toBe(NOW.toISOString());
  });

  it("refuses to edit a deleted comment", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );
    deleteComment(db, question.id, base.user.id, false, NOW);

    expect(() =>
      updateComment(db, question.id, base.user.id, "Back", NOW)
    ).toThrow("Comment has been deleted");
  });
});

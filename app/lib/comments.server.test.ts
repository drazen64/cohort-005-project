import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment, updateComment } from "./comments.server";
import { fakeNotifications } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let notifications: ReturnType<typeof fakeNotifications>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotifications();

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
  it("posts a Discussion Question with a trimmed body, stamped at now", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How do closures work?  ",
      notifications,
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

  it("posts a Discussion Reply under a Discussion Question", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );
    const reply = await createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      notifications,
      NOW
    );

    expect(reply).toMatchObject({ parentId: question.id, body: "Because." });
  });

  it("keeps replies one level deep", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );
    const reply = await createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      notifications,
      NOW
    );

    await expect(
      createComment(
        db,
        base.user.id,
        lessonId,
        reply.id,
        "But why?",
        notifications,
        NOW
      )
    ).rejects.toThrow("Replies can only be one level deep");
  });

  it("refuses a reply to a question on another lesson", async () => {
    const otherLessonId = db
      .insert(schema.lessons)
      .values({ moduleId: 1, title: "Lesson 2", position: 2 })
      .returning()
      .get().id;
    const question = await createComment(
      db,
      base.user.id,
      otherLessonId,
      null,
      "Why?",
      notifications,
      NOW
    );

    await expect(
      createComment(
        db,
        base.instructor.id,
        lessonId,
        question.id,
        "Because.",
        notifications,
        NOW
      )
    ).rejects.toThrow("Parent comment belongs to a different lesson");
  });

  it("refuses an empty comment", async () => {
    await expect(
      createComment(db, base.user.id, lessonId, null, "   ", notifications, NOW)
    ).rejects.toThrow("Comment cannot be empty");
  });
});

describe("updateComment", () => {
  it("lets the author edit their comment, stamping editedAt", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );

    expect(
      updateComment(db, question.id, base.user.id, " Why not? ", NOW)
    ).toMatchObject({
      body: "Why not?",
      editedAt: NOW.toISOString(),
    });
  });

  it("refuses an edit by anyone else", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );

    expect(() =>
      updateComment(db, question.id, base.instructor.id, "Hijacked", NOW)
    ).toThrow("You can only edit your own comments");
  });
});

describe("deleteComment", () => {
  it("lets the author soft-delete their comment at now", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );

    expect(
      deleteComment(db, question.id, base.user.id, false, NOW)
    ).toMatchObject({
      id: question.id,
      deletedAt: NOW.toISOString(),
    });
  });

  it("lets staff delete someone else's comment", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );

    expect(
      deleteComment(db, question.id, base.instructor.id, true, NOW).deletedAt
    ).toBe(NOW.toISOString());
  });

  it("refuses a non-staff user deleting someone else's comment", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );

    expect(() =>
      deleteComment(db, question.id, base.instructor.id, false, NOW)
    ).toThrow("You can only delete your own comments");
  });

  it("leaves an already-deleted comment as it was", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );
    deleteComment(db, question.id, base.user.id, false, NOW);
    const later = new Date(2026, 9, 7);

    expect(
      deleteComment(db, question.id, base.user.id, false, later).deletedAt
    ).toBe(NOW.toISOString());
  });

  it("refuses to edit a deleted comment", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      notifications,
      NOW
    );
    deleteComment(db, question.id, base.user.id, false, NOW);

    expect(() =>
      updateComment(db, question.id, base.user.id, "Back", NOW)
    ).toThrow("Comment has been deleted");
  });
});

describe("Discussion Reply Notification", () => {
  it("notifies only the question's author when someone else replies", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "How do closures work?",
      notifications,
      NOW
    );
    const reply = await createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "A closure keeps the variables of the scope it was made in.",
      notifications,
      NOW
    );

    const replies = notifications.triggers.filter(
      (t) => t.notification === "discussionReply"
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      notification: "discussionReply",
      recipients: [{ id: base.user.id }],
      actor: { id: base.instructor.id, name: "Test Instructor" },
      idempotencyKey: `discussion-reply:${reply.id}`,
      data: {
        commentId: reply.id,
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        snippet: "A closure keeps the variables of the scope it was made in.",
        url: `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`,
      },
    });
  });

  it("sends nothing when the author replies in their own thread", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "How do closures work?",
      notifications,
      NOW
    );
    await createComment(
      db,
      base.user.id,
      lessonId,
      question.id,
      "Never mind, I found it.",
      notifications,
      NOW
    );

    expect(
      notifications.triggers.filter((t) => t.notification === "discussionReply")
    ).toEqual([]);
  });

  it("still posts the reply when sending the Notification fails", async () => {
    const failing = fakeNotifications({ failWith: new Error("Knock is down") });
    const question = await createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      failing,
      NOW
    );

    const reply = await createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      failing,
      NOW
    );

    expect(reply).toMatchObject({ parentId: question.id, body: "Because." });
  });
});

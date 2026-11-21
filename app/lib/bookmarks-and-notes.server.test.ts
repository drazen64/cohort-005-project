import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./bookmarks-and-notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesLater(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let studentId: number;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  studentId = base.user.id;

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get().id;
}

describe("bookmarking a Lesson", () => {
  it("bookmarks a Lesson with no Bookmark, and un-bookmarks it on the next toggle", () => {
    expect(isBookmarked(db, studentId, lessonIds[0])).toBe(false);

    expect(toggleBookmark(db, studentId, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, studentId, lessonIds[0])).toBe(true);

    expect(toggleBookmark(db, studentId, lessonIds[0], NOW)).toBe(false);
    expect(isBookmarked(db, studentId, lessonIds[0])).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    toggleBookmark(db, studentId, lessonIds[0], NOW);

    // A racing request that skips the toggle's read still cannot duplicate.
    db.insert(schema.bookmarks)
      .values({ userId: studentId, lessonId: lessonIds[0] })
      .onConflictDoNothing()
      .run();

    expect(listBookmarks(db, studentId)).toHaveLength(1);
  });

  it("keeps one Student's Bookmark separate from another's", () => {
    const other = addStudent("Ben");
    toggleBookmark(db, other, lessonIds[0], NOW);

    expect(isBookmarked(db, studentId, lessonIds[0])).toBe(false);
  });
});

describe("saving a Note", () => {
  it("creates the Note with its body trimmed", () => {
    const result = saveNote(
      db,
      studentId,
      lessonIds[0],
      "  # not a heading *  ",
      NOW
    );

    expect(result).toEqual({
      ok: true,
      note: { body: "# not a heading *", updatedAt: NOW.toISOString() },
    });
    expect(getNote(db, studentId, lessonIds[0])?.body).toBe(
      "# not a heading *"
    );
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, studentId, lessonIds[0], "First thought", NOW);
    saveNote(db, studentId, lessonIds[0], "Second thought", minutesLater(5));

    expect(getNote(db, studentId, lessonIds[0])).toEqual({
      body: "Second thought",
      updatedAt: minutesLater(5).toISOString(),
    });
    expect(listNotes(db, studentId)).toHaveLength(1);
  });

  it("accepts a Note of exactly the cap", () => {
    const result = saveNote(
      db,
      studentId,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH),
      NOW
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a Note over the cap and leaves the old one alone", () => {
    saveNote(db, studentId, lessonIds[0], "Keep me", NOW);

    const result = saveNote(
      db,
      studentId,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH + 1),
      minutesLater(1)
    );

    expect(result).toEqual({ ok: false, error: NOTE_TOO_LONG_MESSAGE });
    expect(getNote(db, studentId, lessonIds[0])?.body).toBe("Keep me");
  });

  it("clears the Note when saved empty", () => {
    saveNote(db, studentId, lessonIds[0], "Something", NOW);

    expect(
      saveNote(db, studentId, lessonIds[0], "   ", minutesLater(1))
    ).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, studentId, lessonIds[0])).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("lists only the Student's own Bookmarks, newest first, with Lesson and Course", () => {
    toggleBookmark(db, studentId, lessonIds[0], NOW);
    toggleBookmark(db, studentId, lessonIds[2], minutesLater(1));
    toggleBookmark(db, addStudent("Ben"), lessonIds[1], minutesLater(2));

    expect(listBookmarks(db, studentId)).toEqual([
      expect.objectContaining({
        lessonId: lessonIds[2],
        lessonTitle: "Lesson 3",
        courseTitle: base.course.title,
        courseSlug: base.course.slug,
      }),
      expect.objectContaining({
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
      }),
    ]);
  });

  it("lists only the Student's own Notes, last edited first, with Lesson and Course", () => {
    saveNote(db, studentId, lessonIds[0], "Older", NOW);
    saveNote(db, studentId, lessonIds[1], "Newer", minutesLater(1));
    saveNote(db, addStudent("Ben"), lessonIds[2], "Not mine", minutesLater(2));
    saveNote(
      db,
      studentId,
      lessonIds[0],
      "Older, edited last",
      minutesLater(3)
    );

    expect(listNotes(db, studentId)).toEqual([
      expect.objectContaining({
        body: "Older, edited last",
        lessonTitle: "Lesson 1",
        courseTitle: base.course.title,
        courseSlug: base.course.slug,
      }),
      expect.objectContaining({ body: "Newer", lessonTitle: "Lesson 2" }),
    ]);
  });
});

describe("approving a Refund", () => {
  it("keeps the Student's Bookmarks and Notes", async () => {
    const notifications = fakeNotifications();
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: studentId,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: studentId, courseId: base.course.id })
      .run();
    toggleBookmark(db, studentId, lessonIds[0], NOW);
    saveNote(db, studentId, lessonIds[0], "Mine", NOW);

    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      studentId,
      "It was not what I expected.",
      NOW,
      notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      admin.id,
      null,
      NOW,
      notifications
    );

    expect(approved.ok).toBe(true);
    expect(listBookmarks(db, studentId)).toHaveLength(1);
    expect(listNotes(db, studentId)).toHaveLength(1);
  });
});

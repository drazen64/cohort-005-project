import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// A Student's own flag on a Lesson, and a Student's own writing about one.
// Both are private to the Student: every function here is scoped to a single
// userId, and nothing outside the Student's Lesson page and Saved page should
// call the Note readers. See GLOSSARY.md.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Content access is the caller's job (`requireContentAccess`).

type Db = BetterSQLite3Database<typeof schema>;

function ownedBy(
  table: typeof bookmarks | typeof notes,
  userId: number,
  lessonId: number
) {
  return and(eq(table.userId, userId), eq(table.lessonId, lessonId));
}

// ─── Bookmarks ───

export function isBookmarked(db: Db, userId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(ownedBy(bookmarks, userId, lessonId))
    .get();
}

/**
 * Adds the Bookmark if the Lesson has none, removes it if it has one, and
 * returns whether the Lesson is now bookmarked. The unique index on
 * (user, lesson) makes a racing second insert a no-op rather than a duplicate.
 */
export function toggleBookmark(
  db: Db,
  userId: number,
  lessonId: number,
  now: Date
): boolean {
  const removed = db
    .delete(bookmarks)
    .where(ownedBy(bookmarks, userId, lessonId))
    .returning({ id: bookmarks.id })
    .all();
  if (removed.length > 0) return false;

  db.insert(bookmarks)
    .values({ userId, lessonId, createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return true;
}

// ─── Notes ───

export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select({ body: notes.body, updatedAt: notes.updatedAt })
    .from(notes)
    .where(ownedBy(notes, userId, lessonId))
    .get();
}

export type SaveNoteResult =
  | { ok: true; note: { body: string; updatedAt: string } | null }
  | { ok: false; error: string };

/**
 * Saves the Student's Note on a Lesson: creates it, or replaces its body and
 * moves `updatedAt` on. The body is trimmed; over MAX_NOTE_LENGTH it is
 * refused, never truncated. An empty body clears the Note.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: NOTE_TOO_LONG_MESSAGE };
  }

  if (trimmed.length === 0) {
    db.delete(notes)
      .where(ownedBy(notes, userId, lessonId))
      .run();
    return { ok: true, note: null };
  }

  const at = now.toISOString();
  const note = db
    .insert(notes)
    .values({ userId, lessonId, body: trimmed, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: at },
    })
    .returning({ body: notes.body, updatedAt: notes.updatedAt })
    .get();
  return { ok: true, note };
}

// ─── The Saved page ───

const lessonAndCourse = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first, each with its Lesson and Course. */
export function listBookmarks(db: Db, userId: number) {
  return db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      ...lessonAndCourse,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes, last edited first, each with its Lesson and Course. */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonAndCourse,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}

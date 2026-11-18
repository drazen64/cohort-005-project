import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import type { Db } from "~/lib/refunds.server";

// ─── Comments ───
// Writing Discussion Questions and Discussion Replies: posting, editing and
// soft-deleting them. See GLOSSARY.md (Discussions).
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now` last. Uses positional parameters (project convention).

type Comment = typeof comments.$inferSelect;

function getComment(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

function getCourseForLesson(db: Db, lessonId: number) {
  return db
    .select({ courseId: courses.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function assertValidBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

/**
 * Posts a Discussion Question (`parentId` null) or a Discussion Reply to one.
 * Throws an Error with a user-facing message when the comment isn't allowed.
 */
export function createComment(
  db: Db,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
): Comment {
  const trimmed = assertValidBody(body);

  const course = getCourseForLesson(db, lessonId);
  if (!course) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = getComment(db, parentId);
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  return db
    .insert(comments)
    .values({
      userId,
      lessonId,
      parentId,
      body: trimmed,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();
}

/** Edits the author's own comment. Throws when it isn't theirs or is deleted. */
export function updateComment(
  db: Db,
  commentId: number,
  userId: number,
  body: string,
  now: Date
): Comment {
  const trimmed = assertValidBody(body);

  const existing = getComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.deletedAt !== null) {
    throw new Error("Comment has been deleted");
  }
  if (existing.userId !== userId) {
    throw new Error("You can only edit your own comments");
  }

  return db
    .update(comments)
    .set({ body: trimmed, editedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

/**
 * Soft-deletes a comment. Its author can delete it, and so can staff
 * (`isStaff`: the course's Instructor or a Platform Admin). Deleting an
 * already-deleted comment changes nothing.
 */
export function deleteComment(
  db: Db,
  commentId: number,
  userId: number,
  isStaff: boolean,
  now: Date
): Comment {
  const existing = getComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !isStaff) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return existing;
  }

  return db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import {
  archiveNotificationsForComment,
  sendNotification,
  type NotificationUser,
  type Notifications,
} from "~/lib/notifications.server";
import type { Db } from "~/db";

// ─── Comments ───
// Writing Discussion Questions and Discussion Replies: posting, editing and
// soft-deleting them. See GLOSSARY.md (Discussions).
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now` last. Uses positional parameters (project convention).
// Functions that fire Notifications also take the Notifications port.

type Comment = typeof comments.$inferSelect;

function getComment(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

function getCourseForLesson(db: Db, lessonId: number) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
      lessonTitle: lessons.title,
    })
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

function getNotificationUser(
  db: Db,
  userId: number
): NotificationUser | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

const SNIPPET_LENGTH = 120;

function snippetOf(body: string) {
  return body.length > SNIPPET_LENGTH
    ? `${body.slice(0, SNIPPET_LENGTH - 1)}…`
    : body;
}

/**
 * Posts a Discussion Question (`parentId` null) or a Discussion Reply to one.
 * Throws an Error with a user-facing message when the comment isn't allowed.
 *
 * A Discussion Question notifies the course's Instructor, unless they asked it.
 * A Discussion Reply notifies the question's author, unless they wrote it.
 */
export async function createComment(
  db: Db,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  notifications: Notifications,
  now: Date
): Promise<Comment> {
  const trimmed = assertValidBody(body);

  const course = getCourseForLesson(db, lessonId);
  if (!course) {
    throw new Error("Lesson not found");
  }

  let parent: Comment | undefined;
  if (parentId !== null) {
    parent = getComment(db, parentId);
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

  const comment = db
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

  const url = `/courses/${course.courseSlug}/lessons/${lessonId}#comment-${comment.id}`;

  if (!parent && course.instructorId !== userId) {
    const recipient = getNotificationUser(db, course.instructorId);
    const actor = getNotificationUser(db, userId);
    if (recipient && actor) {
      await sendNotification(notifications, {
        notification: "discussionQuestion",
        recipients: [recipient],
        actor,
        idempotencyKey: `discussion-question:${comment.id}`,
        // `commentId` stays a top-level scalar: deleting the comment finds
        // these Notifications by it (archiveForComment).
        data: {
          commentId: comment.id,
          courseTitle: course.courseTitle,
          lessonTitle: course.lessonTitle,
          snippet: snippetOf(comment.body),
          url,
        },
      });
    }
  }

  if (parent && parent.userId !== userId) {
    const recipient = getNotificationUser(db, parent.userId);
    const actor = getNotificationUser(db, userId);
    if (recipient && actor) {
      await sendNotification(notifications, {
        notification: "discussionReply",
        recipients: [recipient],
        actor,
        idempotencyKey: `discussion-reply:${comment.id}`,
        data: {
          commentId: comment.id,
          questionId: parent.id,
          courseTitle: course.courseTitle,
          lessonTitle: course.lessonTitle,
          snippet: snippetOf(comment.body),
          url,
        },
      });
    }
  }

  return comment;
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
 *
 * Archives the Notifications this comment caused. A deleted Discussion
 * Question's replies stay visible, so their Notifications stay too.
 */
export async function deleteComment(
  db: Db,
  commentId: number,
  userId: number,
  isStaff: boolean,
  notifications: Notifications,
  now: Date
): Promise<Comment> {
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

  const deleted = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  await archiveNotificationsForComment(notifications, commentId);

  return deleted;
}

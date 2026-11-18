import { and, eq } from "drizzle-orm";
import { courses, enrollments } from "~/db/schema";
import { notifyUser, type Notifications } from "~/lib/notifications.server";
import type { Db } from "~/db";

// ─── Enrollments ───
// Giving a Student their Enrollment on a course, through an Individual Purchase
// or a Claimed Seat. See GLOSSARY.md (Enrollment).
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now` last. Uses positional parameters (project convention).
// Functions that fire Notifications also take the Notifications port.

type Enrollment = typeof enrollments.$inferSelect;

/**
 * Enrols a Student on a course. A Student has at most one Enrollment per
 * course, so this throws if they already have one. A Lapsed Student has none
 * and can be enrolled again.
 *
 * Once saved, the course's Instructor gets a New Enrollment Notification,
 * unless they enrolled themselves. Enrollments are off in the default
 * preferences, so it only reaches Instructors who opted in.
 */
export async function enrollUser(
  db: Db,
  userId: number,
  courseId: number,
  notifications: Notifications,
  now: Date
): Promise<Enrollment> {
  const existing = db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
  if (existing) {
    throw new Error("User is already enrolled in this course");
  }

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) {
    throw new Error("Course not found");
  }

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();

  await notifyUser(db, notifications, course.instructorId, userId, {
    notification: "enrollment",
    idempotencyKey: `enrollment:${enrollment.id}`,
    data: {
      enrollmentId: enrollment.id,
      courseId: course.id,
      courseTitle: course.title,
      url: `/instructor/${course.id}/students`,
    },
  });

  return enrollment;
}

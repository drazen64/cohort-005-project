import { and, eq } from "drizzle-orm";
import { courses, enrollments } from "~/db/schema";
import type { Db } from "~/lib/refunds.server";

// ─── Enrollments ───
// Giving a Student their Enrollment on a course, through an Individual Purchase
// or a Claimed Seat. See GLOSSARY.md (Enrollment).
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now` last. Uses positional parameters (project convention).

type Enrollment = typeof enrollments.$inferSelect;

/**
 * Enrols a Student on a course. A Student has at most one Enrollment per
 * course, so this throws if they already have one. A Lapsed Student has none
 * and can be enrolled again.
 */
export function enrollUser(
  db: Db,
  userId: number,
  courseId: number,
  now: Date
): Enrollment {
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

  return db
    .insert(enrollments)
    .values({ userId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();
}

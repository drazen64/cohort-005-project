import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { fakeNotifications } from "./notifications.server";
import { enrollUser } from "./enrollments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("enrollUser", () => {
  it("gives the Student an Enrollment, stamped at now", async () => {
    const enrollment = await enrollUser(
      db,
      base.user.id,
      base.course.id,
      fakeNotifications(),
      NOW
    );

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: NOW.toISOString(),
    });
  });

  it("refuses a second Enrollment on the same course", async () => {
    await enrollUser(
      db,
      base.user.id,
      base.course.id,
      fakeNotifications(),
      NOW
    );

    await expect(
      enrollUser(db, base.user.id, base.course.id, fakeNotifications(), NOW)
    ).rejects.toThrow("User is already enrolled in this course");
  });

  it("refuses a course that doesn't exist", async () => {
    await expect(
      enrollUser(db, base.user.id, 9999, fakeNotifications(), NOW)
    ).rejects.toThrow("Course not found");
  });

  it("enrols a Lapsed Student again", async () => {
    const first = await enrollUser(
      db,
      base.user.id,
      base.course.id,
      fakeNotifications(),
      NOW
    );
    db.delete(schema.enrollments).run();

    const again = await enrollUser(
      db,
      base.user.id,
      base.course.id,
      fakeNotifications(),
      NOW
    );

    expect(again.id).not.toBe(first.id);
  });

  describe("New Enrollment Notification", () => {
    it("notifies the course's Instructor that the Student enrolled", async () => {
      const notifications = fakeNotifications();

      const enrollment = await enrollUser(
        db,
        base.user.id,
        base.course.id,
        notifications,
        NOW
      );

      expect(notifications.triggers).toEqual([
        {
          notification: "enrollment",
          recipients: [
            {
              id: base.instructor.id,
              name: "Test Instructor",
              email: "instructor@example.com",
              avatarUrl: null,
            },
          ],
          actor: {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
          idempotencyKey: `enrollment:${enrollment.id}`,
          data: {
            enrollmentId: enrollment.id,
            courseId: base.course.id,
            courseTitle: "Test Course",
            url: `/instructor/${base.course.id}/students`,
          },
        },
      ]);
    });

    it("notifies the Instructor again when a Lapsed Student enrols again", async () => {
      const notifications = fakeNotifications();
      const first = await enrollUser(
        db,
        base.user.id,
        base.course.id,
        notifications,
        NOW
      );
      db.delete(schema.enrollments).run();

      const again = await enrollUser(
        db,
        base.user.id,
        base.course.id,
        notifications,
        NOW
      );

      expect(notifications.triggers.map((t) => t.idempotencyKey)).toEqual([
        `enrollment:${first.id}`,
        `enrollment:${again.id}`,
      ]);
    });

    it("doesn't notify the Instructor about enrolling on their own course", async () => {
      const notifications = fakeNotifications();

      await enrollUser(
        db,
        base.instructor.id,
        base.course.id,
        notifications,
        NOW
      );

      expect(notifications.triggers).toEqual([]);
    });

    it("still enrols the Student when the Notification fails", async () => {
      const notifications = fakeNotifications({
        failWith: new Error("Knock is down"),
      });

      const enrollment = await enrollUser(
        db,
        base.user.id,
        base.course.id,
        notifications,
        NOW
      );

      expect(enrollment.userId).toBe(base.user.id);
    });
  });
});

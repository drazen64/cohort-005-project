import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
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
  it("gives the Student an Enrollment, stamped at now", () => {
    const enrollment = enrollUser(db, base.user.id, base.course.id, NOW);

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: NOW.toISOString(),
    });
  });

  it("refuses a second Enrollment on the same course", () => {
    enrollUser(db, base.user.id, base.course.id, NOW);

    expect(() => enrollUser(db, base.user.id, base.course.id, NOW)).toThrow(
      "User is already enrolled in this course"
    );
  });

  it("refuses a course that doesn't exist", () => {
    expect(() => enrollUser(db, base.user.id, 9999, NOW)).toThrow(
      "Course not found"
    );
  });

  it("enrols a Lapsed Student again", () => {
    const first = enrollUser(db, base.user.id, base.course.id, NOW);
    db.delete(schema.enrollments).run();

    const again = enrollUser(db, base.user.id, base.course.id, NOW);

    expect(again.id).not.toBe(first.id);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { fakeNotifications } from "./notifications.server";
import { buyCourse, buyTeamLicence } from "./purchases.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("buyCourse", () => {
  it("records the Individual Purchase and enrols the buyer", async () => {
    const { purchase, enrollment } = await buyCourse(
      db,
      base.user.id,
      base.course.id,
      4900,
      "DE",
      fakeNotifications(),
      NOW
    );

    expect(purchase).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 4900,
      country: "DE",
      createdAt: NOW.toISOString(),
    });
    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
  });

  it("tells the course's Instructor about the new Enrollment", async () => {
    const notifications = fakeNotifications();

    const { enrollment } = await buyCourse(
      db,
      base.user.id,
      base.course.id,
      4900,
      null,
      notifications,
      NOW
    );

    expect(notifications.triggers).toMatchObject([
      {
        notification: "enrollment",
        recipients: [{ id: base.instructor.id }],
        actor: { id: base.user.id },
        idempotencyKey: `enrollment:${enrollment.id}`,
      },
    ]);
  });
});

describe("buyTeamLicence", () => {
  it("creates the Team Licence's Seats without enrolling the buyer", async () => {
    const { purchase, seats } = await buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      3 * 4900,
      null,
      3,
      NOW
    );

    expect(purchase).toMatchObject({
      userId: base.user.id,
      amountPaid: 3 * 4900,
      createdAt: NOW.toISOString(),
    });
    expect(seats).toHaveLength(3);
    expect(new Set(seats.map((s) => s.code)).size).toBe(3);
    expect(seats.every((s) => s.redeemedByUserId === null)).toBe(true);
  });

  it("puts every Team Licence the buyer owns on the same team", async () => {
    const first = await buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      4900,
      null,
      1,
      NOW
    );
    const second = await buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      4900,
      null,
      1,
      NOW
    );

    expect(second.team.id).toBe(first.team.id);
  });
});

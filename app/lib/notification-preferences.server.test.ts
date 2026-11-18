import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  fakeNotifications,
  type FakeNotifications,
} from "./notifications.server";
import {
  listPreferenceSwitches,
  setPreference,
} from "./notification-preferences.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotifications();
});

function buy(userId: number) {
  return db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 7900 })
    .returning()
    .get();
}

function buySeats(userId: number, seats: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = buy(userId);
  for (let i = 0; i < seats; i++) {
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .run();
  }
  return purchase;
}

async function visibleCategories(userId: number) {
  const switches = await listPreferenceSwitches(db, userId, notifications);
  return switches.map((s) => s.category);
}

describe("listPreferenceSwitches", () => {
  it("shows a Student with nothing bought only Discussion Replies", async () => {
    expect(await visibleCategories(base.user.id)).toEqual([
      "discussionReplies",
    ]);
  });

  it("shows a buyer with an Individual Purchase Refund Request updates", async () => {
    buy(base.user.id);

    expect(await visibleCategories(base.user.id)).toEqual([
      "refundRequestUpdates",
      "discussionReplies",
    ]);
  });

  it("shows a Team Admin on a Team Licence Seat claims", async () => {
    buySeats(base.user.id, 3);

    expect(await visibleCategories(base.user.id)).toEqual([
      "refundRequestUpdates",
      "seatClaims",
      "discussionReplies",
    ]);
  });

  it("shows an Instructor Enrollments and Discussion Questions", async () => {
    expect(await visibleCategories(base.instructor.id)).toEqual([
      "enrollments",
      "discussionQuestions",
      "discussionReplies",
    ]);
  });

  it("shows a Platform Admin Open Refund Requests", async () => {
    const platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    expect(await visibleCategories(platformAdmin.id)).toEqual([
      "openRefundRequests",
      "discussionReplies",
    ]);
  });

  // Knock delivers every category to someone with no preference set (a user
  // Cadence never synced), so the card must not show the defaults' Enrollments
  // off: that isn't in force.
  it("shows every switch on to someone with no preference set yet, as Knock delivers", async () => {
    expect(
      await listPreferenceSwitches(db, base.instructor.id, notifications)
    ).toEqual([
      { category: "enrollments", enabled: true },
      { category: "discussionQuestions", enabled: true },
      { category: "discussionReplies", enabled: true },
    ]);
  });

  it("shows the person's saved preferences", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: true },
      discussionQuestions: { feed: false },
      discussionReplies: { feed: true },
    });

    expect(
      await listPreferenceSwitches(db, base.instructor.id, notifications)
    ).toEqual([
      { category: "enrollments", enabled: true },
      { category: "discussionQuestions", enabled: false },
      { category: "discussionReplies", enabled: true },
    ]);
  });
});

describe("setPreference", () => {
  it("flips one category and leaves every other category as it was", async () => {
    notifications.preferences.set(base.instructor.id, {
      refundRequestUpdates: { feed: false },
      openRefundRequests: { feed: true },
      seatClaims: { feed: false },
      enrollments: { feed: false },
      discussionQuestions: { feed: true },
      discussionReplies: { feed: false },
    });

    await setPreference(base.instructor.id, "enrollments", true, notifications);

    expect(notifications.preferenceWrites).toEqual([
      {
        userId: base.instructor.id,
        preferences: {
          refundRequestUpdates: { feed: false },
          openRefundRequests: { feed: true },
          seatClaims: { feed: false },
          enrollments: { feed: true },
          discussionQuestions: { feed: true },
          discussionReplies: { feed: false },
        },
      },
    ]);
  });

  it("leaves every other category delivering when there is no set yet", async () => {
    await setPreference(
      base.instructor.id,
      "discussionReplies",
      false,
      notifications
    );

    expect(
      await listPreferenceSwitches(db, base.instructor.id, notifications)
    ).toEqual([
      { category: "enrollments", enabled: true },
      { category: "discussionQuestions", enabled: true },
      { category: "discussionReplies", enabled: false },
    ]);
  });

  it("rejects when the save fails, so the switch can be put back", async () => {
    const failing = fakeNotifications({ failWith: new Error("Knock is down") });

    await expect(
      setPreference(base.user.id, "discussionReplies", false, failing)
    ).rejects.toThrow("Knock is down");
  });
});

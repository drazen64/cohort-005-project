import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.server";
import { enrollUser } from "./enrollments.server";
import { claimSeat } from "./seats.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  teamAdmin = db
    .insert(schema.users)
    .values({
      name: "Tess Admin",
      email: "tess@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
});

function buySeats(seats: number, country: string | null = null) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: teamAdmin.id,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      country,
      createdAt: NOW.toISOString(),
    })
    .returning()
    .get();
  const codes = Array.from({ length: seats }, (_, i) => {
    const code = `SEAT-${purchase.id}-${i}`;
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code,
        purchaseId: purchase.id,
      })
      .run();
    return code;
  });
  return { purchase, codes };
}

function getSeat(code: string) {
  return db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.code, code))
    .get()!;
}

function addStudent(name: string, email: string) {
  return db
    .insert(schema.users)
    .values({ name, email, role: UserRole.Student })
    .returning()
    .get();
}

function claim(code: string, userId: number, country = "") {
  return claimSeat(db, code, userId, country, fakeNotifications(), NOW);
}

describe("claimSeat", () => {
  it("claims an Unclaimed Seat and enrols the Student, stamped at now", async () => {
    const { codes } = buySeats(2);

    const result = await claim(codes[0], base.user.id);

    expect(result).toMatchObject({
      ok: true,
      enrollment: {
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: NOW.toISOString(),
      },
    });
    expect(getSeat(codes[0])).toMatchObject({
      redeemedByUserId: base.user.id,
      redeemedAt: NOW.toISOString(),
    });
  });

  it("refuses a code that doesn't exist", async () => {
    expect(await claim("NOPE", base.user.id)).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("refuses a Claimed Seat", async () => {
    const { codes } = buySeats(1);
    const other = addStudent("Olly", "olly@example.com");
    await claim(codes[0], other.id);

    expect(await claim(codes[0], base.user.id)).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("refuses a Student who is already enrolled, leaving the Seat unclaimed", async () => {
    const { codes } = buySeats(1);
    await enrollUser(
      db,
      base.user.id,
      base.course.id,
      fakeNotifications(),
      NOW
    );

    expect(await claim(codes[0], base.user.id)).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(getSeat(codes[0]).redeemedByUserId).toBeNull();
  });

  it("refuses a Seat while its Team Licence has an Open Refund Request", async () => {
    const { purchase, codes } = buySeats(2);
    await raiseRefundRequest(
      db,
      purchase.id,
      teamAdmin.id,
      "Team changed.",
      fakeNotifications(),
      NOW
    );

    expect(await claim(codes[0], base.user.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining("can't be claimed right now"),
    });
  });

  it("refuses a Student claiming from another country than the purchaser", async () => {
    const { codes } = buySeats(1, "DE");

    expect(await claim(codes[0], base.user.id, "FR")).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
    expect((await claim(codes[0], base.user.id, "DE")).ok).toBe(true);
  });

  describe("Notifications", () => {
    it("tells the owning Team Admin who claimed a Seat, on which course, and how many Seats are left", async () => {
      const { purchase, codes } = buySeats(3);
      const notifications = fakeNotifications();

      await claimSeat(db, codes[0], base.user.id, "", notifications, NOW);

      const seat = getSeat(codes[0]);
      expect(
        notifications.triggers.find((t) => t.notification === "seatClaimed")
      ).toEqual({
        notification: "seatClaimed",
        recipients: [
          {
            id: teamAdmin.id,
            name: "Tess Admin",
            email: "tess@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        idempotencyKey: `seat-claimed:${seat.id}`,
        data: {
          seatId: seat.id,
          purchaseId: purchase.id,
          courseTitle: "Test Course",
          seatsLeft: 2,
          url: "/team",
        },
      });
    });

    it("sends one Notification per claim, counting down to no Seats left", async () => {
      const { codes } = buySeats(2);
      const other = addStudent("Olly", "olly@example.com");
      const notifications = fakeNotifications();

      await claimSeat(db, codes[0], base.user.id, "", notifications, NOW);
      await claimSeat(db, codes[1], other.id, "", notifications, NOW);

      expect(
        notifications.triggers
          .filter((t) => t.notification === "seatClaimed")
          .map((t) => t.data.seatsLeft)
      ).toEqual([1, 0]);
    });

    it("tells the course's Instructor about the new Enrollment", async () => {
      const { codes } = buySeats(1);
      const notifications = fakeNotifications();

      const result = await claimSeat(
        db,
        codes[0],
        base.user.id,
        "",
        notifications,
        NOW
      );

      const enrollment = notifications.triggers.find(
        (t) => t.notification === "enrollment"
      );
      expect(enrollment).toMatchObject({
        recipients: [{ id: base.instructor.id }],
        actor: { id: base.user.id },
        idempotencyKey: result.ok
          ? `enrollment:${result.enrollment.id}`
          : "unreachable",
      });
    });

    it("doesn't tell the Team Admin about claiming a Seat themselves", async () => {
      const { codes } = buySeats(2);
      const notifications = fakeNotifications();

      await claimSeat(db, codes[0], teamAdmin.id, "", notifications, NOW);

      expect(
        notifications.triggers.filter((t) => t.notification === "seatClaimed")
      ).toEqual([]);
    });

    it("sends nothing when the claim is refused", async () => {
      const notifications = fakeNotifications();

      await claimSeat(db, "NOPE", base.user.id, "", notifications, NOW);

      expect(notifications.triggers).toEqual([]);
    });

    it("still claims the Seat when Notifications fail", async () => {
      const { codes } = buySeats(1);
      const notifications = fakeNotifications({
        failWith: new Error("Knock is down"),
      });

      const result = await claimSeat(
        db,
        codes[0],
        base.user.id,
        "",
        notifications,
        NOW
      );

      expect(result.ok).toBe(true);
      expect(getSeat(codes[0]).redeemedByUserId).toBe(base.user.id);
    });
  });
});

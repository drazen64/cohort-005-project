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

describe("claimSeat", () => {
  it("claims an Unclaimed Seat and enrols the Student, stamped at now", () => {
    const { codes } = buySeats(2);

    const result = claimSeat(db, codes[0], base.user.id, "", NOW);

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

  it("refuses a code that doesn't exist", () => {
    expect(claimSeat(db, "NOPE", base.user.id, "", NOW)).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("refuses a Claimed Seat", () => {
    const { codes } = buySeats(1);
    const other = db
      .insert(schema.users)
      .values({
        name: "Olly",
        email: "olly@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    claimSeat(db, codes[0], other.id, "", NOW);

    expect(claimSeat(db, codes[0], base.user.id, "", NOW)).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("refuses a Student who is already enrolled, leaving the Seat unclaimed", () => {
    const { codes } = buySeats(1);
    enrollUser(db, base.user.id, base.course.id, NOW);

    expect(claimSeat(db, codes[0], base.user.id, "", NOW)).toEqual({
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

    expect(claimSeat(db, codes[0], base.user.id, "", NOW)).toMatchObject({
      ok: false,
      error: expect.stringContaining("can't be claimed right now"),
    });
  });

  it("refuses a Student claiming from another country than the purchaser", () => {
    const { codes } = buySeats(1, "DE");

    expect(claimSeat(db, codes[0], base.user.id, "FR", NOW)).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
    expect(claimSeat(db, codes[0], base.user.id, "DE", NOW).ok).toBe(true);
  });
});

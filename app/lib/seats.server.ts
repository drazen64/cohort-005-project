import { and, eq } from "drizzle-orm";
import { coupons, enrollments, purchases } from "~/db/schema";
import { enrollUser } from "~/lib/enrollments.server";
import { getSeatAvailability, type Db } from "~/lib/refunds.server";

// ─── Seats ───
// A Student claiming a Seat on a Team Licence, which gives them an Enrollment.
// See GLOSSARY.md (Seat, Claimed Seat).
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now` last. Uses positional parameters (project convention).

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type ClaimSeatResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

/**
 * Claims the Seat with this code for the Student and enrols them. Returns a
 * user-facing error instead when the Seat can't be claimed: it's already
 * claimed, on hold or refunded, the Student is already enrolled, or they are
 * in a different country from the Team Licence's buyer.
 */
export function claimSeat(
  db: Db,
  code: string,
  userId: number,
  userCountry: string,
  now: Date
): ClaimSeatResult {
  const seat = db.select().from(coupons).where(eq(coupons.code, code)).get();
  if (!seat) {
    return { ok: false, error: "Coupon not found" };
  }

  if (seat.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    return { ok: false, error: SEAT_ON_HOLD };
  }
  if (availability === "refunded") {
    return { ok: false, error: SEAT_REFUNDED };
  }

  const existingEnrollment = db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, seat.courseId)
      )
    )
    .get();
  if (existingEnrollment) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();
  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  db.update(coupons)
    .set({ redeemedByUserId: userId, redeemedAt: now.toISOString() })
    .where(eq(coupons.id, seat.id))
    .run();

  const enrollment = enrollUser(db, userId, seat.courseId, now);

  return { ok: true, enrollment };
}

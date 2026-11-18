import { and, count, eq, isNull } from "drizzle-orm";
import { coupons, courses, enrollments, purchases } from "~/db/schema";
import { enrollUser, getNotificationUser } from "~/lib/enrollments.server";
import {
  sendNotification,
  type Notifications,
} from "~/lib/notifications.server";
import { getSeatAvailability, type Db } from "~/lib/refunds.server";

// ─── Seats ───
// A Student claiming a Seat on a Team Licence, which gives them an Enrollment.
// See GLOSSARY.md (Seat, Claimed Seat).
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now` last. Uses positional parameters (project convention).
// Functions that fire Notifications also take the Notifications port.

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
 *
 * Once claimed, the Team Admin who bought the Team Licence gets a Seat claimed
 * Notification (unless they claimed it themselves) and the course's Instructor
 * a New Enrollment one. A failed Notification never fails the claim.
 */
export async function claimSeat(
  db: Db,
  code: string,
  userId: number,
  userCountry: string,
  notifications: Notifications,
  now: Date
): Promise<ClaimSeatResult> {
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

  const enrollment = await enrollUser(
    db,
    userId,
    seat.courseId,
    notifications,
    now
  );

  if (purchase && purchase.userId !== userId) {
    await notifySeatClaimed(db, seat, purchase.userId, userId, notifications);
  }

  return { ok: true, enrollment };
}

/**
 * Tells the Team Admin who bought the Team Licence that one of its Seats was
 * claimed, by whom, and how many Seats are left. One per claim; there is no
 * separate "all Seats claimed" Notification.
 */
async function notifySeatClaimed(
  db: Db,
  seat: typeof coupons.$inferSelect,
  teamAdminId: number,
  claimedById: number,
  notifications: Notifications
) {
  const recipient = getNotificationUser(db, teamAdminId);
  const actor = getNotificationUser(db, claimedById);
  const course = db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, seat.courseId))
    .get();
  if (!recipient || !actor || !course) return;

  await sendNotification(notifications, {
    notification: "seatClaimed",
    recipients: [recipient],
    actor,
    idempotencyKey: `seat-claimed:${seat.id}`,
    data: {
      seatId: seat.id,
      purchaseId: seat.purchaseId,
      courseTitle: course.title,
      seatsLeft: countSeatsLeft(db, seat.purchaseId),
      url: "/team",
    },
  });
}

/** Seats on a Team Licence that can still be claimed: unclaimed, not refunded. */
function countSeatsLeft(db: Db, purchaseId: number): number {
  const row = db
    .select({ seatsLeft: count() })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, purchaseId),
        isNull(coupons.redeemedByUserId),
        isNull(coupons.refundedAt)
      )
    )
    .get();
  return row?.seatsLeft ?? 0;
}

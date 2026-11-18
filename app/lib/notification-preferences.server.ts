import { eq } from "drizzle-orm";
import { coupons, courses, purchases, UserRole, users } from "~/db/schema";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORY_NAMES,
  mergePreference,
  type NotificationCategory,
} from "~/lib/notifications";
import type { Notifications } from "~/lib/notifications.server";
import type { Db } from "~/db";

// ─── Notification preferences ───
// The `/settings` Notifications card: one switch per preference category,
// shown only when the category applies to what the person is or has (spec
// #31), never their `UserRole` alone. A hidden switch keeps its default, so it
// can appear later without anything being written.
//
// Preferences live behind the Notifications port; only the `feed` channel is
// used in v1.

export type PreferenceSwitch = {
  category: NotificationCategory;
  enabled: boolean;
};

function hasPurchase(db: Db, userId: number) {
  return (
    db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.userId, userId))
      .get() !== undefined
  );
}

// A Team Licence is the Purchase that granted Seats; its buyer is the Team
// Admin.
function isTeamAdmin(db: Db, userId: number) {
  return (
    db
      .select({ id: coupons.id })
      .from(coupons)
      .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
      .where(eq(purchases.userId, userId))
      .get() !== undefined
  );
}

// An Instructor builds and owns courses, so owning one is what counts, not
// the role.
function isInstructor(db: Db, userId: number) {
  return (
    db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.instructorId, userId))
      .get() !== undefined
  );
}

// The only record of who is Cadence staff. Open Refund Requests go to every
// user with this role (refunds.server.ts), so the switch follows it too.
function isPlatformAdmin(db: Db, userId: number) {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user?.role === UserRole.Admin;
}

function visibleCategories(db: Db, userId: number) {
  const instructor = isInstructor(db, userId);
  const visible: Record<NotificationCategory, boolean> = {
    refundRequestUpdates: hasPurchase(db, userId),
    openRefundRequests: isPlatformAdmin(db, userId),
    seatClaims: isTeamAdmin(db, userId),
    enrollments: instructor,
    discussionQuestions: instructor,
    discussionReplies: true,
  };
  return NOTIFICATION_CATEGORY_NAMES.filter((category) => visible[category]);
}

export async function listPreferenceSwitches(
  db: Db,
  userId: number,
  notifications: Notifications
): Promise<PreferenceSwitch[]> {
  const preferences =
    (await notifications.getPreferences(userId)) ??
    DEFAULT_NOTIFICATION_PREFERENCES;
  return visibleCategories(db, userId).map((category) => ({
    category,
    // Unset delivers (notifications.ts).
    enabled: preferences[category]?.feed ?? true,
  }));
}

/**
 * Turns one category on or off on the Notification Feed, leaving the rest of
 * the person's set as it is. Writing a set replaces it whole, so this reads,
 * merges and writes back. A failure rejects, so the caller can put the switch
 * back.
 */
export async function setPreference(
  userId: number,
  category: NotificationCategory,
  enabled: boolean,
  notifications: Notifications
): Promise<void> {
  const current = await notifications.getPreferences(userId);
  await notifications.setPreferences(
    userId,
    mergePreference(current, category, "feed", enabled)
  );
}

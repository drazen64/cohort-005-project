// ─── Notifications catalogue ───
// Cadence's names for its Notifications, their preference categories and
// channels (spec #31). Shared by the server port (notifications.server.ts) and
// the client feed port (notification-feed.ts). Only the Knock adapters know
// Knock's keys for these (knock-keys.ts).

/** One per Notification in the v1 catalogue. */
export type NotificationName =
  | "refundRequestApproved"
  | "refundRequestDeclined"
  | "openRefundRequest"
  | "seatClaimed"
  | "enrollment"
  | "discussionQuestion"
  | "discussionReply"
  | "refundRequestConfirmation";

/** Preference categories. A person mutes Notifications per category. */
export const NOTIFICATION_CATEGORY_NAMES = [
  "refundRequestUpdates",
  "openRefundRequests",
  "seatClaims",
  "enrollments",
  "discussionQuestions",
  "discussionReplies",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORY_NAMES)[number];

/** Where a Notification is delivered. Only the Notification Feed in v1. */
export type NotificationChannel = "feed";

export const NOTIFICATION_CATEGORIES: Record<
  NotificationName,
  NotificationCategory
> = {
  refundRequestApproved: "refundRequestUpdates",
  refundRequestDeclined: "refundRequestUpdates",
  refundRequestConfirmation: "refundRequestUpdates",
  openRefundRequest: "openRefundRequests",
  seatClaimed: "seatClaims",
  enrollment: "enrollments",
  discussionQuestion: "discussionQuestions",
  discussionReply: "discussionReplies",
};

/**
 * A person's Notification preferences, category × channel. `true` delivers,
 * `false` mutes. A category or channel left out is unset, which delivers.
 */
export type NotificationPreferences = Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
>;

/**
 * Written once for every synced user who has no preference set yet:
 * Enrollments off, every other category on, Notification Feed only.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  refundRequestUpdates: { feed: true },
  openRefundRequests: { feed: true },
  seatClaims: { feed: true },
  enrollments: { feed: false },
  discussionQuestions: { feed: true },
  discussionReplies: { feed: true },
};

/**
 * Flips one category on one channel and leaves the rest of the set as it is.
 * Starts from the defaults when the person has no preference set yet. Writing
 * a set replaces it whole, so a change is always read → merge → write.
 */
export function mergePreference(
  preferences: NotificationPreferences | null,
  category: NotificationCategory,
  channel: NotificationChannel,
  enabled: boolean
): NotificationPreferences {
  const set = preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
  return { ...set, [category]: { ...set[category], [channel]: enabled } };
}

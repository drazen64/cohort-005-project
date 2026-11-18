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
export type NotificationCategory =
  | "refundRequestUpdates"
  | "openRefundRequests"
  | "seatClaims"
  | "enrollments"
  | "discussionQuestions"
  | "discussionReplies";

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

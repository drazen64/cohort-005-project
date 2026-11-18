import type {
  NotificationCategory,
  NotificationChannel,
  NotificationName,
} from "~/lib/notifications";

// ─── Knock keys ───
// How Cadence's Notification names map to Knock's keys. Used only by the Knock
// adapters (notifications-knock.server.ts, notification-feed-knock.ts). The
// workflows and categories are created in the Knock dashboard by a person:
// see scripts/knock-workflows-wizard.sh, which must use these same keys.

/** One Knock workflow per Notification. */
export const KNOCK_WORKFLOW_KEYS: Record<NotificationName, string> = {
  refundRequestApproved: "refund-request-approved",
  refundRequestDeclined: "refund-request-declined",
  openRefundRequest: "open-refund-request",
  seatClaimed: "seat-claimed",
  enrollment: "new-enrollment",
  discussionQuestion: "discussion-question",
  discussionReply: "discussion-reply",
  refundRequestConfirmation: "refund-request-confirmation",
};

/** The category each workflow is assigned in Knock. */
export const KNOCK_CATEGORY_KEYS: Record<NotificationCategory, string> = {
  refundRequestUpdates: "refund-request-updates",
  openRefundRequests: "open-refund-requests",
  seatClaims: "seat-claims",
  enrollments: "enrollments",
  discussionQuestions: "discussion-questions",
  discussionReplies: "discussion-replies",
};

export const KNOCK_CHANNEL_TYPES: Record<NotificationChannel, string> = {
  feed: "in_app_feed",
};

export function notificationForWorkflowKey(
  workflowKey: string
): NotificationName | null {
  for (const [name, key] of Object.entries(KNOCK_WORKFLOW_KEYS)) {
    if (key === workflowKey && isNotificationName(name)) return name;
  }
  return null;
}

function isNotificationName(name: string): name is NotificationName {
  return name in KNOCK_WORKFLOW_KEYS;
}

/** Knock user ids are Cadence user ids as strings. */
export function knockUserId(userId: number): string {
  return String(userId);
}

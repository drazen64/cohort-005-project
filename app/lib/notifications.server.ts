import type { FeedConnection } from "~/lib/notification-feed";
import type { NotificationName } from "~/lib/notifications";
import { readServerEnv } from "~/lib/env.server";
import { knockNotifications } from "~/lib/notifications-knock.server";

// ─── Notifications ───
// The server side of Notifications (GLOSSARY.md), behind a Cadence-owned port
// shaped like `MailTransport` (ADR 0013). Services that fire Notifications take
// the port as a parameter, the way they take `db` and `now`.
//
// Adapters:
// - `knockNotifications` (notifications-knock.server.ts): talks to Knock. The
//   only server module that knows Knock or its keys.
// - `fakeNotifications`: records every call in memory, for tests.
// - `noopNotifications`: logs instead of sending. The default when
//   KNOCK_SECRET_API_KEY is missing, so the Notification Feed shows its empty
//   state.
//
// Everything here uses Cadence's names (notifications.ts). User sync
// (identify) and preferences join the port in later tickets.
//
// Until user sync lands, the Knock adapter identifies recipients and the actor
// inline on every trigger, which is why a trigger carries whole users.

/** A Cadence user as a Notification's recipient or sender. */
export type NotificationUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/**
 * What a Notification row needs to render, captured when it is sent. Values
 * stay flat scalars so they can be filtered on later (e.g. by `commentId`).
 */
export type NotificationData = Record<string, string | number | boolean | null>;

export type NotificationTrigger = {
  notification: NotificationName;
  recipients: NotificationUser[];
  /** Who did it. `null` for the system (shows the Cadence "C" avatar). */
  actor: NotificationUser | null;
  data: NotificationData;
  /** One per domain event, e.g. `discussion-reply:<commentId>`. */
  idempotencyKey: string;
};

export interface Notifications {
  trigger(trigger: NotificationTrigger): Promise<void>;
  /**
   * Archives every Notification a comment caused (those whose data has this
   * `commentId`), so they leave recipients' feeds.
   */
  archiveForComment(commentId: number): Promise<void>;
  /**
   * Signs a short-lived user token for the person's Notification Feed. `null`
   * when there is no feed to connect to (the feed shows its empty state).
   */
  connectFeed(userId: number): Promise<FeedConnection | null>;
}

export function noopNotifications(
  log: (message: string) => void = console.info
): Notifications {
  return {
    async trigger(trigger) {
      log(
        `[notifications] KNOCK_SECRET_API_KEY not set; not sending ${trigger.notification} (${trigger.idempotencyKey}) to users ${trigger.recipients.map((r) => r.id).join(", ")}`
      );
    },
    async archiveForComment(commentId) {
      log(
        `[notifications] KNOCK_SECRET_API_KEY not set; not archiving Notifications for comment ${commentId}`
      );
    },
    async connectFeed() {
      return null;
    },
  };
}

export type FakeNotifications = Notifications & {
  triggers: NotificationTrigger[];
  archivedCommentIds: number[];
};

/** In-memory adapter for tests. `failWith` makes every call reject. */
export function fakeNotifications(
  options: { failWith?: Error } = {}
): FakeNotifications {
  const triggers: NotificationTrigger[] = [];
  const archivedCommentIds: number[] = [];
  return {
    triggers,
    archivedCommentIds,
    async trigger(trigger) {
      if (options.failWith) throw options.failWith;
      triggers.push(trigger);
    },
    async archiveForComment(commentId) {
      if (options.failWith) throw options.failWith;
      archivedCommentIds.push(commentId);
    },
    async connectFeed() {
      if (options.failWith) throw options.failWith;
      return null;
    },
  };
}

export function defaultNotifications(): Notifications {
  const env = readServerEnv();
  const secretApiKey = env.KNOCK_SECRET_API_KEY;
  if (!secretApiKey) return noopNotifications();
  return knockNotifications({
    secretApiKey,
    publicApiKey: env.KNOCK_PUBLIC_API_KEY,
    signingKey: env.KNOCK_SIGNING_KEY,
    feedChannelId: env.KNOCK_FEED_CHANNEL_ID,
  });
}

/**
 * Sends a Notification best-effort: it runs after the domain write has
 * committed, and a failure is logged and never fails the action.
 */
export async function sendNotification(
  notifications: Notifications,
  trigger: NotificationTrigger
): Promise<void> {
  try {
    await notifications.trigger(trigger);
  } catch (error) {
    console.error(
      `[notifications] Failed to send ${trigger.notification} (${trigger.idempotencyKey})`,
      error
    );
  }
}

/**
 * Archives a deleted comment's Notifications best-effort: a failure is logged
 * and never fails the delete.
 */
export async function archiveNotificationsForComment(
  notifications: Notifications,
  commentId: number
): Promise<void> {
  try {
    await notifications.archiveForComment(commentId);
  } catch (error) {
    console.error(
      `[notifications] Failed to archive Notifications for comment ${commentId}`,
      error
    );
  }
}

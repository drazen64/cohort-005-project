import type { FeedConnection } from "~/lib/notification-feed";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationName,
  type NotificationPreferences,
} from "~/lib/notifications";
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
// Everything here uses Cadence's names (notifications.ts). Archiving by
// comment id joins the port in a later ticket.
//
// Users are synced explicitly (`syncNotificationUser`), never inline on a
// trigger: a user Knock learned about any other way would have no preference
// set, and Enrollments would default to on. A trigger still carries whole
// users so services don't care how the adapter addresses them.

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
   * Signs a short-lived user token for the person's Notification Feed. `null`
   * when there is no feed to connect to (the feed shows its empty state).
   */
  connectFeed(userId: number): Promise<FeedConnection | null>;
  /** Creates or updates the person's profile (name, email, avatar). */
  identify(user: NotificationUser): Promise<void>;
  /** The person's preference set, or `null` if they have none yet. */
  getPreferences(userId: number): Promise<NotificationPreferences | null>;
  /**
   * Replaces the person's whole preference set. To change one category, read
   * the set, `mergePreference` and write it back.
   */
  setPreferences(
    userId: number,
    preferences: NotificationPreferences
  ): Promise<void>;
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
    async connectFeed() {
      return null;
    },
    async identify(user) {
      log(
        `[notifications] KNOCK_SECRET_API_KEY not set; not syncing user ${user.id}`
      );
    },
    async getPreferences() {
      return null;
    },
    async setPreferences(userId) {
      log(
        `[notifications] KNOCK_SECRET_API_KEY not set; not saving preferences for user ${userId}`
      );
    },
  };
}

export type FakeNotifications = Notifications & {
  triggers: NotificationTrigger[];
  /** Every user synced, in order. */
  identified: NotificationUser[];
  /** Every preference set written, in order. */
  preferenceWrites: { userId: number; preferences: NotificationPreferences }[];
  /** Current preference sets by user id, as `getPreferences` reads them. */
  preferences: Map<number, NotificationPreferences>;
};

/** In-memory adapter for tests. `failWith` makes every call reject. */
export function fakeNotifications(
  options: { failWith?: Error } = {}
): FakeNotifications {
  const triggers: NotificationTrigger[] = [];
  const identified: NotificationUser[] = [];
  const preferenceWrites: FakeNotifications["preferenceWrites"] = [];
  const preferences = new Map<number, NotificationPreferences>();
  return {
    triggers,
    identified,
    preferenceWrites,
    preferences,
    async trigger(trigger) {
      if (options.failWith) throw options.failWith;
      triggers.push(trigger);
    },
    async connectFeed() {
      if (options.failWith) throw options.failWith;
      return null;
    },
    async identify(user) {
      if (options.failWith) throw options.failWith;
      identified.push(user);
    },
    async getPreferences(userId) {
      if (options.failWith) throw options.failWith;
      return preferences.get(userId) ?? null;
    },
    async setPreferences(userId, set) {
      if (options.failWith) throw options.failWith;
      preferenceWrites.push({ userId, preferences: set });
      preferences.set(userId, set);
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
 * Syncs a user to the Notifications vendor best-effort: their name, email and
 * avatar, plus the default preference set if they have none yet (an existing
 * set is never overwritten). A failure is logged and never fails the action.
 */
export async function syncNotificationUser(
  notifications: Notifications,
  user: NotificationUser
): Promise<void> {
  try {
    await notifications.identify(user);
    const preferences = await notifications.getPreferences(user.id);
    if (preferences === null) {
      await notifications.setPreferences(
        user.id,
        DEFAULT_NOTIFICATION_PREFERENCES
      );
    }
  } catch (error) {
    console.error(`[notifications] Failed to sync user ${user.id}`, error);
  }
}

import Knock, { NotFoundError, signUserToken } from "@knocklabs/node";
import {
  KNOCK_CATEGORY_KEYS,
  KNOCK_CHANNEL_TYPES,
  KNOCK_PREFERENCE_SET_ID,
  KNOCK_WORKFLOW_KEYS,
  knockUserId,
} from "~/lib/knock-keys";
import {
  NOTIFICATION_CATEGORY_NAMES,
  type NotificationChannel,
  type NotificationPreferences,
} from "~/lib/notifications";
import type { Notifications } from "~/lib/notifications.server";

// ─── Knock adapter for the Notifications port ───
// The only server module that talks to Knock (ADR 0013). It maps Cadence's
// names to Knock's keys (knock-keys.ts).

/** How long a signed user token for the Notification Feed lives. */
const USER_TOKEN_TTL_SECONDS = 60 * 60;

type KnockPreferenceSet = Awaited<ReturnType<Knock["users"]["getPreferences"]>>;
type KnockPreferenceSetRequest = Parameters<Knock["users"]["setPreferences"]>[2];

const CHANNELS = Object.keys(KNOCK_CHANNEL_TYPES) as NotificationChannel[];

// Cadence's preferences → a Knock preference set, category × channel type.
function toKnockPreferences(
  preferences: NotificationPreferences
): KnockPreferenceSetRequest {
  const categories: Record<string, { channel_types: Record<string, boolean> }> =
    {};
  for (const category of NOTIFICATION_CATEGORY_NAMES) {
    const channels = preferences[category];
    if (!channels) continue;
    const channelTypes: Record<string, boolean> = {};
    for (const channel of CHANNELS) {
      const enabled = channels[channel];
      if (enabled !== undefined) {
        channelTypes[KNOCK_CHANNEL_TYPES[channel]] = enabled;
      }
    }
    categories[KNOCK_CATEGORY_KEYS[category]] = { channel_types: channelTypes };
  }
  return { categories, __persistence_strategy__: "replace" };
}

// A Knock preference set → Cadence's preferences. Anything Cadence doesn't
// write (conditions, other categories or channel types) is left out, which
// reads as unset.
function fromKnockPreferences(
  set: KnockPreferenceSet
): NotificationPreferences {
  const preferences: NotificationPreferences = {};
  for (const category of NOTIFICATION_CATEGORY_NAMES) {
    const setting = set.categories?.[KNOCK_CATEGORY_KEYS[category]];
    if (setting === undefined) continue;
    const channels: Partial<Record<NotificationChannel, boolean>> = {};
    for (const channel of CHANNELS) {
      const enabled =
        typeof setting === "boolean"
          ? setting
          : setting.channel_types?.[
              KNOCK_CHANNEL_TYPES[channel] as keyof NonNullable<
                typeof setting.channel_types
              >
            ];
      if (typeof enabled === "boolean") channels[channel] = enabled;
    }
    preferences[category] = channels;
  }
  return preferences;
}

export function knockNotifications(config: {
  secretApiKey: string;
  publicApiKey: string | undefined;
  signingKey: string | undefined;
  feedChannelId: string | undefined;
}): Notifications {
  // No SDK retries in v1 (spec #31): a failed trigger is logged, not retried.
  const knock = new Knock({ apiKey: config.secretApiKey, maxRetries: 0 });

  return {
    async trigger(trigger) {
      await knock.workflows.trigger(
        KNOCK_WORKFLOW_KEYS[trigger.notification],
        {
          // By id only: users are synced explicitly, with their default
          // preferences (syncNotificationUser), never inline-identified here.
          recipients: trigger.recipients.map((r) => knockUserId(r.id)),
          actor: trigger.actor ? knockUserId(trigger.actor.id) : null,
          data: trigger.data,
        },
        { idempotencyKey: trigger.idempotencyKey }
      );
    },

    async connectFeed(userId) {
      const { publicApiKey, signingKey, feedChannelId } = config;
      if (!publicApiKey || !signingKey || !feedChannelId) return null;
      const id = knockUserId(userId);
      return {
        userId: id,
        userToken: await signUserToken(id, {
          signingKey,
          expiresInSeconds: USER_TOKEN_TTL_SECONDS,
        }),
        publicApiKey,
        feedChannelId,
      };
    },

    async identify(user) {
      // Knock's identify is an upsert (PUT /v1/users/:id).
      await knock.users.update(knockUserId(user.id), {
        name: user.name,
        email: user.email,
        avatar: user.avatarUrl,
      });
    },

    async getPreferences(userId) {
      try {
        const set = await knock.users.getPreferences(
          knockUserId(userId),
          KNOCK_PREFERENCE_SET_ID
        );
        // A user with no set yet comes back without categories.
        if (!set.categories || Object.keys(set.categories).length === 0) {
          return null;
        }
        return fromKnockPreferences(set);
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },

    async setPreferences(userId, preferences) {
      await knock.users.setPreferences(
        knockUserId(userId),
        KNOCK_PREFERENCE_SET_ID,
        toKnockPreferences(preferences)
      );
    },
  };
}

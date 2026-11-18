import Knock, { signUserToken } from "@knocklabs/node";
import { KNOCK_WORKFLOW_KEYS, knockUserId } from "~/lib/knock-keys";
import type {
  NotificationUser,
  Notifications,
} from "~/lib/notifications.server";

// ─── Knock adapter for the Notifications port ───
// The only server module that talks to Knock (ADR 0013). It maps Cadence's
// names to Knock's keys (knock-keys.ts).

/** How long a signed user token for the Notification Feed lives. */
const USER_TOKEN_TTL_SECONDS = 60 * 60;

// Inline-identifies the user, so a recipient or sender Knock hasn't seen yet
// exists by the time the workflow runs, with a current name and avatar.
function knockUser(user: NotificationUser) {
  return {
    id: knockUserId(user.id),
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl,
  };
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
          recipients: trigger.recipients.map(knockUser),
          actor: trigger.actor ? knockUser(trigger.actor) : null,
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
  };
}

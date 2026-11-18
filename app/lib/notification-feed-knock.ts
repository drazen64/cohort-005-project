import Knock, { type FeedItem, type FeedStoreState } from "@knocklabs/client";
import type {
  FeedConnection,
  FeedNotification,
  FeedState,
  NotificationFeed,
} from "~/lib/notification-feed";
import { notificationForWorkflowKey } from "~/lib/knock-keys";

// ─── Knock adapter for the Notification Feed port ───
// The only browser module that talks to Knock. Construct it in the browser
// only (it opens a websocket). One instance per signed-in user: when the user
// changes, dispose it and build a new one with the new connection.
//
// Live updates come over Knock's real-time socket; nothing polls (polling hit
// Knock's rate limit in the prototype).

const PAGE_SIZE = 20;

function toNotification(item: FeedItem): FeedNotification {
  const actor = item.actors[0];
  return {
    id: item.id,
    notification: notificationForWorkflowKey(item.source.key),
    insertedAt: item.inserted_at,
    seenAt: item.seen_at,
    readAt: item.read_at,
    actor:
      actor && "name" in actor
        ? { name: actor.name ?? "", avatarUrl: actor.avatar ?? null }
        : null,
    data: item.data ?? {},
  };
}

function toFeedState(state: FeedStoreState): FeedState {
  return {
    notifications: state.items.map(toNotification),
    unseenCount: state.metadata.unseen_count,
    unreadCount: state.metadata.unread_count,
    loading: state.loading,
    hasMore: state.pageInfo.after !== null,
  };
}

export function knockFeed(
  connection: FeedConnection,
  /** Fetches a fresh signed user token before the current one expires. */
  refreshUserToken: () => Promise<string | undefined>
): NotificationFeed {
  const knock = new Knock(connection.publicApiKey);
  knock.authenticate({ id: connection.userId }, connection.userToken, {
    // Cadence syncs users from the server; the browser never identifies.
    identificationStrategy: "skip",
    onUserTokenExpiring: refreshUserToken,
    timeBeforeExpirationInMs: 60_000,
  });
  const feed = knock.feeds.initialize(connection.feedChannelId, {
    page_size: PAGE_SIZE,
  });

  return {
    getState: () => toFeedState(feed.store.getState()),
    subscribe(listener) {
      return feed.store.subscribe((state) => listener(toFeedState(state)));
    },
    async start() {
      feed.listenForUpdates();
      await feed.fetch();
    },
    async loadMore() {
      if (feed.store.getState().pageInfo.after === null) return;
      await feed.fetchNextPage();
    },
    async markAllSeen() {
      // Bulk update by channel, so items that haven't loaded are covered too.
      await feed.markAllAsSeen();
    },
    dispose() {
      feed.dispose();
      knock.logout();
    },
  };
}

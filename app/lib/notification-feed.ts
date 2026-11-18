import type { NotificationName } from "~/lib/notifications";

// ─── Notification Feed (client port) ───
// What the bell and its popover use to read a person's Notification Feed, in
// Cadence's language (ADR 0013). The Knock adapter lives in
// notification-feed-knock.ts; `emptyFeed` is used when the server has no feed
// to connect to (no Knock keys in local dev).
//
// The browser talks to the vendor directly, authenticated with a short-lived
// signed user token that the server mints for the session user.

/** Handed from the server to the browser to open one person's feed. */
export type FeedConnection = {
  userId: string;
  userToken: string;
  publicApiKey: string;
  feedChannelId: string;
};

export type FeedNotification = {
  id: string;
  /** Which Notification this is; `null` if the feed sent one Cadence doesn't know. */
  notification: NotificationName | null;
  insertedAt: string;
  seenAt: string | null;
  readAt: string | null;
  /** The sender, or `null` when the system sent it. */
  actor: { name: string; avatarUrl: string | null } | null;
  /** The trigger data the Notification was sent with. */
  data: Record<string, unknown>;
};

export type FeedState = {
  /** Newest first. */
  notifications: FeedNotification[];
  unseenCount: number;
  unreadCount: number;
  loading: boolean;
  hasMore: boolean;
};

export interface NotificationFeed {
  getState(): FeedState;
  /** Calls `listener` on every change, including live arrivals. */
  subscribe(listener: (state: FeedState) => void): () => void;
  /** Loads the first page and starts listening for live updates. */
  start(): Promise<void>;
  /** Loads the next page, if there is one. */
  loadMore(): Promise<void>;
  /** Marks every Notification seen, including ones not loaded yet. */
  markAllSeen(): Promise<void>;
  /** Closes the live connection. The feed can't be used afterwards. */
  dispose(): void;
}

export const EMPTY_FEED_STATE: FeedState = {
  notifications: [],
  unseenCount: 0,
  unreadCount: 0,
  loading: false,
  hasMore: false,
};

export function emptyFeed(): NotificationFeed {
  return {
    getState: () => EMPTY_FEED_STATE,
    subscribe: () => () => {},
    start: async () => {},
    loadMore: async () => {},
    markAllSeen: async () => {},
    dispose: () => {},
  };
}

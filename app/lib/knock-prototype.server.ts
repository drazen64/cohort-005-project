// PROTOTYPE — throwaway. Lives on the `prototype/notification-feed` branch only.
// Answers "What does the Notification Feed look like in Cadence?" (wayfinder #18).
// Talks to the real Knock Development environment. No error handling beyond
// what keeps the page rendering.
import { createSign } from "node:crypto";

const KNOCK_API = "https://api.knock.app/v1";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see root .env)`);
  return value;
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

/** RS256 user token, as Knock's enhanced security mode requires. */
export function signKnockUserToken(userId: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ sub: String(userId), iat: now, exp: now + 60 * 60 })
  );
  const pem = Buffer.from(env("KNOCK_SIGNING_KEY"), "base64").toString("utf8");
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(pem, "base64url");
  return `${header}.${payload}.${signature}`;
}

export type NotificationKind =
  | "refund-approved"
  | "refund-declined"
  | "refund-requested"
  | "seat-claimed"
  | "enrollment"
  | "discussion-question"
  | "discussion-reply";

export interface FeedNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  snippet: string | null;
  url: string;
  courseTitle: string | null;
  actorName: string | null;
  insertedAt: string;
  seen: boolean;
  read: boolean;
}

export interface Feed {
  notifications: FeedNotification[];
  unreadCount: number;
  unseenCount: number;
  error: string | null;
}

const EMPTY_FEED: Feed = {
  notifications: [],
  unreadCount: 0,
  unseenCount: 0,
  error: null,
};

interface KnockFeedItem {
  id: string;
  data: Record<string, string | null> | null;
  actors: { id: string; name?: string }[];
  inserted_at: string;
  seen_at: string | null;
  read_at: string | null;
}

/**
 * Reads the feed exactly as the browser would: public key + signed user token.
 * Archived Notifications are excluded (Knock's default).
 */
export async function getFeed(userId: number): Promise<Feed> {
  try {
    const res = await fetch(
      `${KNOCK_API}/users/${userId}/feeds/${env("KNOCK_FEED_CHANNEL_ID")}?page_size=50`,
      {
        headers: {
          Authorization: `Bearer ${env("KNOCK_PUBLIC_API_KEY")}`,
          "X-Knock-User-Token": signKnockUserToken(userId),
        },
      }
    );
    if (res.status === 404) return EMPTY_FEED; // user never identified in Knock
    if (!res.ok) {
      return { ...EMPTY_FEED, error: `Knock ${res.status}: ${await res.text()}` };
    }
    const body = (await res.json()) as {
      entries: KnockFeedItem[];
      meta: { unread_count: number; unseen_count: number };
    };
    return {
      notifications: body.entries.map((item) => ({
        id: item.id,
        kind: (item.data?.kind ?? "discussion-reply") as NotificationKind,
        title: item.data?.title ?? "(no title)",
        snippet: item.data?.snippet ?? null,
        url: item.data?.url ?? "/",
        courseTitle: item.data?.courseTitle ?? null,
        actorName: item.actors[0]?.name ?? null,
        insertedAt: item.inserted_at,
        seen: item.seen_at !== null,
        read: item.read_at !== null,
      })),
      unreadCount: body.meta.unread_count,
      unseenCount: body.meta.unseen_count,
      error: null,
    };
  } catch (e) {
    return { ...EMPTY_FEED, error: String(e) };
  }
}

export type MessageStatus = "seen" | "read" | "unread" | "archived";

/** Server-side status change with the secret key. */
export async function setMessageStatus(ids: string[], status: MessageStatus) {
  if (ids.length === 0) return;
  const res = await fetch(`${KNOCK_API}/messages/batch/${status}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("KNOCK_SECRET_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message_ids: ids }),
  });
  if (!res.ok) throw new Error(`Knock ${res.status}: ${await res.text()}`);
}

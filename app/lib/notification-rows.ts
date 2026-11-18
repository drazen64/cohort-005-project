import { formatMoney } from "~/lib/analytics";
import type { FeedNotification } from "~/lib/notification-feed";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationName,
} from "~/lib/notifications";

// ─── Notification Feed rows ───
// What each row in the Notification Feed says. Cadence writes the text from
// the Notification's trigger data, not from vendor templates (spec #31).
//
// To add or change a Notification's row, edit its entry in `ROWS` below. The
// trigger data comes from whatever the sending service put in it, and older
// Notifications may lack fields a newer service sends, so every field is
// read defensively: a missing field drops out of the text rather than
// breaking the row.

export type NotificationRow = {
  title: string;
  /** One line of context or a quote. `null` when there is nothing to show. */
  snippet: string | null;
  /** Picks the small icon on the avatar. `null` for an unknown Notification. */
  category: NotificationCategory | null;
  /** Where clicking the row goes. `null` when it has nowhere to go. */
  url: string | null;
};

type Data = FeedNotification["data"];

type RowText = { title: string; snippet: string | null };

/** Writes a row's title and snippet. `actor` is the sender's name. */
type Describe = (data: Data, actor: string) => RowText;

// Trigger data fields read here: actor (from the feed), courseTitle,
// lessonTitle, snippet, amount (cents, or a ready-made string), purchasedAt
// (ISO), reason, decisionNote, seatsLeft. `url` is read for every Notification.
const ROWS: Record<NotificationName, Describe> = {
  discussionQuestion: (data, actor) => ({
    title: joinWords(`${actor} asked a question`, on(text(data.lessonTitle))),
    snippet: quote(text(data.snippet)) ?? text(data.courseTitle),
  }),
  discussionReply: (data, actor) => ({
    title: `${actor} replied to your question`,
    snippet: quote(text(data.snippet)) ?? text(data.lessonTitle),
  }),
  enrollment: (data, actor) => ({
    title: `${actor} enrolled`,
    snippet: text(data.courseTitle),
  }),
  seatClaimed: (data, actor) => ({
    title: `${actor} claimed a Seat`,
    snippet: joinParts(text(data.courseTitle), seatsLeft(data.seatsLeft)),
  }),
  openRefundRequest: (data, actor) => ({
    title: joinWords(`${actor} asked for a`, money(data.amount), "refund"),
    snippet: joinParts(text(data.courseTitle), quote(text(data.reason))),
  }),
  refundRequestApproved: (data) => ({
    title: "Your Refund Request was approved",
    snippet: joinParts(
      text(data.courseTitle),
      purchase(data.amount, data.purchasedAt),
      quote(text(data.decisionNote))
    ),
  }),
  refundRequestDeclined: (data) => ({
    title: "Your Refund Request was declined",
    snippet: joinParts(
      text(data.courseTitle),
      purchase(data.amount, data.purchasedAt),
      quote(text(data.decisionNote)),
      "You can ask again."
    ),
  }),
  refundRequestConfirmation: (data) => ({
    title: joinWords(
      "We've received your",
      money(data.amount),
      "Refund Request"
    ),
    snippet: joinParts(
      text(data.courseTitle),
      "A Platform Admin will review it."
    ),
  }),
};

export function describeNotification(
  notification: FeedNotification
): NotificationRow {
  const name = notification.notification;
  const data = notification.data ?? {};
  const url = internalUrl(data.url);
  const describe = name ? ROWS[name] : undefined;
  if (!name || !describe) {
    return { title: "New notification", snippet: null, category: null, url };
  }
  const actor = notification.actor?.name || "Someone";
  return {
    ...describe(data, actor),
    category: NOTIFICATION_CATEGORIES[name] ?? null,
    url,
  };
}

/** A path inside Cadence (`/…`), never another site. */
function internalUrl(value: unknown): string | null {
  const url = text(value);
  return url && url.startsWith("/") && !url.startsWith("//") ? url : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function quote(value: string | null): string | null {
  return value === null ? null : `“${value}”`;
}

function on(value: string | null): string | null {
  return value === null ? null : `on ${value}`;
}

/** Cents as "$49.00"; a string is taken as already formatted. */
function money(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatMoney(value);
  }
  return text(value);
}

/** Which Purchase, e.g. "$49.00 Purchase on Nov 3, 2026". */
function purchase(amount: unknown, purchasedAt: unknown): string | null {
  const price = money(amount);
  const day = date(purchasedAt);
  if (price === null && day === null) return null;
  return joinWords(price, "Purchase", day === null ? null : `on ${day}`);
}

/** An ISO timestamp as "Nov 3, 2026", in the reader's time zone. */
function date(value: unknown): string | null {
  const iso = text(value);
  if (iso === null) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function seatsLeft(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value} ${value === 1 ? "Seat" : "Seats"} left`;
}

/** Joins the parts that are present with spaces. */
function joinWords(...parts: (string | null)[]): string {
  return parts.filter((part) => part !== null).join(" ");
}

/** Joins the parts that are present with " · ", or `null` if none are. */
function joinParts(...parts: (string | null)[]): string | null {
  const present = parts.filter((part) => part !== null);
  return present.length > 0 ? present.join(" · ") : null;
}

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  GraduationCap,
  MessageSquare,
  Receipt,
  UsersRound,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  EMPTY_FEED_STATE,
  emptyFeed,
  type FeedConnection,
  type FeedNotification,
  type FeedState,
  type NotificationFeed,
} from "~/lib/notification-feed";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "~/lib/notifications";

// ─── The bell ───
// Sits in the sidebar header. Its badge counts unseen Notifications; opening
// the popover marks them all seen. It only talks to the Notification Feed port.

/**
 * Opens the person's Notification Feed and keeps it live. A new feed (and a
 * new live connection) is opened only when the person changes, e.g. on a
 * DevUI user switch, not every time the layout loader mints a fresh token.
 */
function useNotificationFeed(connection: FeedConnection | null) {
  const [feed, setFeed] = useState<NotificationFeed>(emptyFeed);
  const [state, setState] = useState<FeedState>(EMPTY_FEED_STATE);
  const latest = useRef(connection);
  latest.current = connection;

  const key = connection
    ? `${connection.userId}:${connection.publicApiKey}:${connection.feedChannelId}`
    : null;

  useEffect(() => {
    const initial = latest.current;
    if (!initial) return;

    let disposed = false;
    let instance: NotificationFeed | undefined;
    let unsubscribe = () => {};

    // Loaded on demand so the vendor SDK never runs during server rendering.
    import("~/lib/notification-feed-knock").then(({ knockFeed }) => {
      if (disposed) return;
      instance = knockFeed(initial, refreshUserToken);
      unsubscribe = instance.subscribe(setState);
      setFeed(instance);
      setState(instance.getState());
      instance.start().catch((error) => {
        console.error("[notifications] Could not load the feed", error);
      });
    });

    return () => {
      disposed = true;
      unsubscribe();
      instance?.dispose();
      setFeed(emptyFeed());
      setState(EMPTY_FEED_STATE);
    };
  }, [key]);

  return { feed, state };
}

async function refreshUserToken(): Promise<string | undefined> {
  const response = await fetch("/api/notification-token");
  if (!response.ok) return undefined;
  const body: { userToken?: string } = await response.json();
  return body.userToken;
}

export function NotificationBell({
  connection,
}: {
  connection: FeedConnection | null;
}) {
  const { feed, state } = useNotificationFeed(connection);
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && state.unseenCount > 0) {
      feed.markAllSeen().catch((error) => {
        console.error("[notifications] Could not mark all seen", error);
      });
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        title="Notifications"
        aria-label={
          state.unseenCount > 0
            ? `Notifications (${state.unseenCount} unseen)`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {state.unseenCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {state.unseenCount > 9 ? "9+" : state.unseenCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <NotificationPopover
            feed={feed}
            state={state}
            close={() => setOpen(false)}
          />
        </>
      )}
    </>
  );
}

function NotificationPopover({
  feed,
  state,
  close,
}: {
  feed: NotificationFeed;
  state: FeedState;
  close: () => void;
}) {
  const navigate = useNavigate();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        feed.loadMore().catch((error) => {
          console.error("[notifications] Could not load more", error);
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [feed]);

  function openNotification(notification: FeedNotification) {
    const url = notification.data.url;
    // Some Notifications have nowhere to go; the popover stays open.
    if (typeof url !== "string") return;
    close();
    navigate(url);
  }

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="fixed left-56 top-2 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
        <Bell className="size-4" />
        <span className="font-semibold">Notifications</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {state.notifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            onOpen={openNotification}
          />
        ))}
        {state.notifications.length === 0 && !state.loading && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        )}
        <div
          ref={sentinel}
          className="p-3 text-center text-xs text-muted-foreground"
        >
          {state.loading
            ? "Loading…"
            : !state.hasMore &&
              state.notifications.length > 0 &&
              "That's everything."}
        </div>
      </div>
    </div>
  );
}

const categoryIcons: Record<NotificationCategory, React.ReactNode> = {
  discussionQuestions: <MessageSquare />,
  discussionReplies: <MessageSquare />,
  refundRequestUpdates: <Receipt />,
  openRefundRequests: <Receipt />,
  seatClaims: <UsersRound />,
  enrollments: <GraduationCap />,
};

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The row's title and one-line snippet, written by Cadence from trigger data. */
function describe(notification: FeedNotification): {
  title: string;
  snippet: string | null;
} {
  const actor = notification.actor?.name ?? "Someone";
  const { data } = notification;
  switch (notification.notification) {
    case "discussionReply":
      return {
        title: `${actor} replied to your question`,
        snippet: text(data.snippet) ?? text(data.lessonTitle),
      };
    default:
      return { title: "New notification", snippet: null };
  }
}

function timeAgo(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: FeedNotification;
  onOpen: (notification: FeedNotification) => void;
}) {
  const { title, snippet } = describe(notification);
  const read = notification.readAt !== null;
  const category = notification.notification
    ? NOTIFICATION_CATEGORIES[notification.notification]
    : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
    >
      <span className="relative shrink-0">
        {notification.actor ? (
          <UserAvatar
            name={notification.actor.name}
            avatarUrl={notification.actor.avatarUrl}
            className={cn("size-9", read && "opacity-60")}
          />
        ) : (
          // Sent by the system, not a person.
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground",
              read && "opacity-60"
            )}
          >
            C
          </span>
        )}
        {category && (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-popover text-muted-foreground ring-1 ring-border [&_svg]:size-2.5">
            {categoryIcons[category]}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn("block truncate text-sm", !read && "font-semibold")}
        >
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {snippet ? `${snippet} · ` : ""}
          {timeAgo(notification.insertedAt)}
        </span>
      </span>
    </button>
  );
}

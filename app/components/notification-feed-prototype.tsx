// PROTOTYPE — throwaway (wayfinder #18: "What does the Notification Feed look
// like in Cadence?"). Three variants mounted in the real app shell, switchable
// via `?variant=A|B|C`, reading the real Knock feed for the DevUI user.
//
//   A  Bell popover   — bell in the sidebar header, dropdown panel.
//                       Badge = UNSEEN count, opening the panel marks all seen.
//   B  Inbox page     — "Notifications" sidebar nav item with an UNREAD count,
//                       full page with Unread/All tabs, day groups, read toggle.
//   C  Drawer         — bell top-right of the content, dot only (no number),
//                       right-hand drawer split into "Needs action" / "Updates",
//                       rows are dismissed (archived) rather than read.
import { useEffect, useRef, useState } from "react";
import { NavLink, useFetcher, useNavigate } from "react-router";
import {
  Bell,
  BellDot,
  Check,
  CheckCheck,
  CircleDollarSign,
  CircleX,
  Inbox,
  MessageCircleQuestion,
  MessageSquareReply,
  Receipt,
  UserPlus,
  UsersRound,
  X,
  Archive,
  MailOpen,
  Mail,
} from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import type {
  Feed,
  FeedNotification,
  NotificationKind,
  MessageStatus,
} from "~/lib/knock-prototype.server";

export const NOTIFICATION_VARIANTS = [
  { key: "A", name: "Bell popover" },
  { key: "B", name: "Inbox page" },
  { key: "C", name: "Drawer" },
];

const KIND: Record<
  NotificationKind,
  { icon: React.ElementType; label: string; tone: string }
> = {
  "refund-approved": { icon: CircleDollarSign, label: "Refund", tone: "text-emerald-600" },
  "refund-declined": { icon: CircleX, label: "Refund", tone: "text-rose-600" },
  "refund-requested": { icon: Receipt, label: "Refund Request", tone: "text-amber-600" },
  "seat-claimed": { icon: UsersRound, label: "Team", tone: "text-sky-600" },
  enrollment: { icon: UserPlus, label: "Enrollment", tone: "text-violet-600" },
  "discussion-question": { icon: MessageCircleQuestion, label: "Discussion", tone: "text-indigo-600" },
  "discussion-reply": { icon: MessageSquareReply, label: "Discussion", tone: "text-indigo-600" },
};

function KindIcon({ kind, className }: { kind: NotificationKind; className?: string }) {
  const { icon: Icon, tone } = KIND[kind] ?? KIND["discussion-reply"];
  return <Icon className={cn("size-4 shrink-0", tone, className)} />;
}

function useMark() {
  const fetcher = useFetcher();
  return (status: MessageStatus, ids: string[]) => {
    if (ids.length === 0) return;
    const form = new FormData();
    form.set("status", status);
    ids.forEach((id) => form.append("id", id));
    fetcher.submit(form, { method: "post", action: "/api/prototype-notifications" });
  };
}

function useOpenNotification() {
  const mark = useMark();
  const navigate = useNavigate();
  return (n: FeedNotification) => {
    if (!n.read) mark("read", [n.id]);
    navigate(n.url);
  };
}

function FeedError({ feed }: { feed: Feed }) {
  if (!feed.error) return null;
  return (
    <div className="m-3 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700 break-all">
      {feed.error}
    </div>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  });
}

// ─── Variant A: bell popover in the sidebar header ──────────────────────────

export function VariantABell({ feed }: { feed: Feed }) {
  const [open, setOpen] = useState(false);
  const mark = useMark();
  const openNotification = useOpenNotification();
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      mark("seen", feed.notifications.filter((n) => !n.seen).map((n) => n.id));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
      >
        <Bell className="size-5" />
        {feed.unseenCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {feed.unseenCount > 9 ? "9+" : feed.unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-full top-0 z-50 ml-3 flex max-h-[75vh] w-96 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="font-semibold">Notifications</span>
            <button
              onClick={() =>
                mark("read", feed.notifications.filter((n) => !n.read).map((n) => n.id))
              }
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" /> Mark all as read
            </button>
          </div>
          <FeedError feed={feed} />
          <div className="overflow-y-auto">
            {feed.notifications.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                You're all caught up.
              </p>
            )}
            {feed.notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setOpen(false);
                  openNotification(n);
                }}
                className={cn(
                  "flex w-full gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-accent",
                  !n.read && "bg-primary/5"
                )}
              >
                <KindIcon kind={n.kind} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm", !n.read ? "font-semibold" : "text-muted-foreground")}>
                    {n.title}
                  </div>
                  {n.snippet && (
                    <div className="truncate text-xs text-muted-foreground">{n.snippet}</div>
                  )}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatRelativeTime(n.insertedAt)}
                  </div>
                </div>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Variant B: sidebar nav item + full inbox page ──────────────────────────

export function VariantBNavItem({ feed }: { feed: Feed }) {
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Inbox className="size-4" />
      <span className="flex-1">Notifications</span>
      {feed.unreadCount > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
          {feed.unreadCount}
        </span>
      )}
    </NavLink>
  );
}

function dayGroup(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (d.getTime() >= startOfToday) return "Today";
  if (d.getTime() >= startOfToday - 86_400_000) return "Yesterday";
  return "Earlier";
}

export function VariantBInboxPage({ feed }: { feed: Feed }) {
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const mark = useMark();
  const openNotification = useOpenNotification();

  // Landing on the page counts as seeing everything in it.
  useEffect(() => {
    mark("seen", feed.notifications.filter((n) => !n.seen).map((n) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = feed.notifications.filter((n) => tab === "all" || !n.read);
  const groups = ["Today", "Yesterday", "Earlier"]
    .map((g) => ({ g, items: shown.filter((n) => dayGroup(n.insertedAt) === g) }))
    .filter((x) => x.items.length > 0);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {feed.unreadCount} unread
          </p>
        </div>
        <button
          onClick={() => mark("read", feed.notifications.filter((n) => !n.read).map((n) => n.id))}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <CheckCheck className="size-4" /> Mark all as read
        </button>
      </div>

      <div className="mb-4 flex gap-1 border-b">
        {(["unread", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize",
              tab === t ? "border-primary" : "border-transparent text-muted-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <FeedError feed={feed} />
      {groups.length === 0 && (
        <p className="py-16 text-center text-muted-foreground">
          {tab === "unread" ? "No unread Notifications." : "No Notifications yet."}
        </p>
      )}

      {groups.map(({ g, items }) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {g}
          </h2>
          <div className="divide-y rounded-lg border">
            {items.map((n) => (
              <div
                key={n.id}
                className={cn("group flex items-start gap-4 p-4", !n.read && "bg-primary/5")}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <KindIcon kind={n.kind} className="size-5" />
                </div>
                <button onClick={() => openNotification(n)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{KIND[n.kind]?.label}</span>
                    {n.courseTitle && (
                      <>
                        <span>·</span>
                        <span className="truncate">{n.courseTitle}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{formatRelativeTime(n.insertedAt)}</span>
                  </div>
                  <div className={cn("mt-0.5", !n.read && "font-semibold")}>{n.title}</div>
                  {n.snippet && (
                    <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      “{n.snippet}”
                    </div>
                  )}
                </button>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    title={n.read ? "Mark as unread" : "Mark as read"}
                    onClick={() => mark(n.read ? "unread" : "read", [n.id])}
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                  >
                    {n.read ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
                  </button>
                  <button
                    title="Archive"
                    onClick={() => mark("archived", [n.id])}
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                  >
                    <Archive className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── Variant C: top-right bell + right-hand drawer, dismiss-to-clear ────────

export function VariantCDrawer({ feed }: { feed: Feed }) {
  const [open, setOpen] = useState(false);
  const mark = useMark();
  const openNotification = useOpenNotification();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) mark("seen", feed.notifications.filter((n) => !n.seen).map((n) => n.id));
  }

  const needsAction = feed.notifications.filter((n) => n.kind === "refund-requested");
  const updates = feed.notifications.filter((n) => n.kind !== "refund-requested");

  function Row({ n }: { n: FeedNotification }) {
    return (
      <div className={cn("group relative flex gap-3 rounded-lg border p-3", n.read && "opacity-60")}>
        <KindIcon kind={n.kind} className="mt-0.5" />
        <button
          onClick={() => {
            setOpen(false);
            openNotification(n);
          }}
          className="min-w-0 flex-1 text-left"
        >
          <div className="text-sm font-medium">{n.title}</div>
          {n.snippet && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.snippet}</div>
          )}
          <div className="mt-1 text-[11px] text-muted-foreground">
            {n.courseTitle ? `${n.courseTitle} · ` : ""}
            {formatRelativeTime(n.insertedAt)}
          </div>
        </button>
        <button
          title="Dismiss"
          onClick={() => mark("archived", [n.id])}
          className="self-start rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="pointer-events-none sticky top-0 z-30 flex justify-end p-3">
        <button
          onClick={toggle}
          title="Notifications"
          className="pointer-events-auto rounded-full border bg-background p-2 shadow-sm hover:bg-accent"
        >
          {feed.unseenCount > 0 ? (
            <BellDot className="size-5 text-rose-600" />
          ) : (
            <Bell className="size-5" />
          )}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setOpen(false)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-[420px] flex-col bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-lg font-semibold">Notifications</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => mark("archived", feed.notifications.map((n) => n.id))}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
                <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent">
                  <X className="size-5" />
                </button>
              </div>
            </div>
            <FeedError feed={feed} />
            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {needsAction.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Needs your action
                    <span className="rounded-full bg-amber-100 px-1.5 text-amber-800">
                      {needsAction.length}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {needsAction.map((n) => (
                      <Row key={n.id} n={n} />
                    ))}
                  </div>
                </section>
              )}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Updates
                </h3>
                {updates.length === 0 ? (
                  <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Check className="size-4" /> Nothing new.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {updates.map((n) => (
                      <Row key={n.id} n={n} />
                    ))}
                  </div>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

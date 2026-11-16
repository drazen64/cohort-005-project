# Prior art: notification data models and retention

Research for issue #4 (child of map #2, "In-app Notifications spec"). Researched 2026-11-16.

**Question.** How do established products and open-source libraries store in-app Notifications? Compare one row per recipient with an event row plus per-recipient read state. How do they handle unread counts, mark-all-read and retention? What fits a single SQLite file through Drizzle (ADR 0006) at small scale?

## Short answer

Use **one `notifications` table with one row per recipient**. Each row holds the snapshot text and link, a `type`, the recipient, `created_at` and a nullable `read_at`. Laravel, django-notifications, Discourse and Mastodon all use this shape. Noticed v2 (Rails) is the only library studied that splits the data into an event row plus per-recipient rows, and even there the read state stays on the per-recipient row.

- **Unread count:** a live `COUNT(*)` over a partial index on `(user_id) WHERE read_at IS NULL`. Discourse caps the count at 99. Cadence does not need a cached counter.
- **Mark all as read:** one `UPDATE … SET read_at = now WHERE user_id = ? AND read_at IS NULL`. Every library studied does this. GitHub adds a `last_read_at` cutoff so that rows arriving mid-click stay unread.
- **Retention:** v1 can skip it. When it is needed, copy Discourse: keep the newest N rows per user and delete the rest in a periodic job.

## Sources and what they do

### Laravel (database channel): one row per recipient, data as JSON

The migration stub that `php artisan make:notifications-table` generates is a single table:

```php
$table->uuid('id')->primary();
$table->string('type');
$table->morphs('notifiable');        // recipient_type + recipient_id, indexed
$table->text('data');                // JSON payload
$table->timestamp('read_at')->nullable();
$table->timestamps();
```

Source: [`notifications.stub`](https://github.com/laravel/framework/blob/12.x/src/Illuminate/Notifications/Console/stubs/notifications.stub).

- The docs say the table stores "the notification type as well as a JSON data structure that describes the notification". [Laravel 12 docs, Database Notifications](https://laravel.com/docs/12.x/notifications#database-notifications)
- Unread rows are the ones `where read_at is null`, exposed through `unreadNotifications`. Mark-all-read is a mass update: `$user->unreadNotifications()->update(['read_at' => now()]);`. Same page.
- Retention: the docs show only `$user->notifications()->delete()`. Laravel ships no pruning job.

### django-notifications: one row per recipient, boolean `unread`

`AbstractNotification` has `recipient` (FK to user), `unread` (bool, indexed), the generic FKs `actor` / `verb` / `target` / `action_object`, `timestamp`, a soft-delete `deleted` flag, `emailed` and `data` (JSON). A composite index `(recipient, unread)` exists "to speed up the notifications count query". `mark_all_as_read` is `qset.filter(recipient=recipient).update(unread=False)`. Source: [`notifications/base/models.py`](https://github.com/django-notifications/django-notifications/blob/master/notifications/base/models.py).

The library also stores references to actor and target rather than rendered text, so the text is built at read time. That is the opposite of Cadence's snapshot rule.

### Noticed v2 (Rails): event row plus per-recipient rows

Noticed's migration creates two tables. Source: [`create_noticed_tables.rb`](https://github.com/excid3/noticed/blob/main/db/migrate/20231215190233_create_noticed_tables.rb).

- `noticed_events` holds `type`, a polymorphic `record`, `params` (json) and timestamps. A later migration added `notifications_count`.
- `noticed_notifications` holds `type`, `event_id`, a polymorphic `recipient`, `read_at`, `seen_at` and timestamps.

How it behaves:

- **Fan-out:** `deliver` builds one attributes hash per recipient, sets `notifications_count`, and calls `notifications.insert_all!(recipients_attributes, record_timestamps: true)`. Source: [`deliverable.rb`](https://github.com/excid3/noticed/blob/main/app/models/concerns/noticed/deliverable.rb).
- **Read state:** each recipient's row carries its own read state. `unread` is `where(read_at: nil)`, and the bulk `mark_as_read` is `update_all(read_at: Time.current, updated_at: …)`. There is a separate `seen_at` for "opened the dropdown" as opposed to "read this one". Source: [`readable.rb`](https://github.com/excid3/noticed/blob/main/app/models/concerns/noticed/readable.rb).
- **Retention:** none built in. The README recommends `dependent: :destroy` on the user and on the record, so that orphaned events and notifications don't fail to deserialize. [README, Handling Deleted Records](https://github.com/excid3/noticed#handling-deleted-records)

The event row gives Noticed two things. Its JSON `params` are stored once rather than once per recipient, and it can find every notification produced by one record (`has_many :notifications, through: :noticed_events`). The cost is a join on every read, plus a second table to clean up.

### Discourse: one row per recipient, index-heavy, capped retention

Schema annotation in [`app/models/notification.rb`](https://github.com/discourse/discourse/blob/main/app/models/notification.rb):

- **Columns:** `user_id`, `notification_type` (int), `data` (string(1000), JSON), `read` (bool, default false), `high_priority`, `topic_id`, `post_number`, and timestamps.
- **Partial index for the count:** `idx_notifications_speedup_unread_count (user_id, notification_type) WHERE (NOT read)`.
- **Mark read:** `Notification.where(user_id: user.id, read: false).update_all(read: true)`, optionally filtered by type (`read_types`).
- **Unread count:** a live `COUNT(*)` with a `LIMIT` of `MAX_UNREAD_NOTIFICATIONS = 99`. The source comments that "This safeguard is in place to avoid situations where a user with enormous amounts of unread data can issue extremely expensive queries". The count also filters on `n.id > :seen_notification_id`, a high-water mark the user advances by opening the menu. Source: [`app/models/user.rb`](https://github.com/discourse/discourse/blob/main/app/models/user.rb).
- **Retention:** `Notification.purge_old!` deletes everything older than the Nth newest row per user, using `rank() OVER (PARTITION BY user_id ORDER BY id DESC)`. The cap is `SiteSetting.max_notifications_per_user`, default **10000** and hidden ([`config/site_settings.yml`](https://github.com/discourse/discourse/blob/main/config/site_settings.yml)). The job runs `every 1.week` ([`jobs/scheduled/purge_old_notifications.rb`](https://github.com/discourse/discourse/blob/main/app/jobs/scheduled/purge_old_notifications.rb)).

### Mastodon: one row per recipient, plus a read-position marker

- **Notification row:** one per receiving `account`. It points at the source through a polymorphic `activity` and has `from_account_id`, `type`, `group_key` (to collapse similar events) and `filtered`. There is no per-row read column. Source: [`app/models/notification.rb`](https://github.com/mastodon/mastodon/blob/main/app/models/notification.rb).
- **Read state:** a per-user **marker** with `notifications[last_read_id]`, the "ID of the last notification read". It carries a `version`, and a stale update returns 409. [Mastodon docs, markers](https://docs.joinmastodon.org/methods/markers/)

A marker makes mark-all-read an O(1) write. It cannot express "read this one but not the older ones", and Cadence needs exactly that, because clicking a Notification marks only that one as read.

### GitHub and Knock: hosted APIs, same semantics

- **GitHub:** `PUT /notifications` "Marks all notifications as read". It takes an optional `last_read_at`: "Anything updated since this time will not be marked as read." When the count is too large it returns **202** and finishes asynchronously. [GitHub REST, notifications](https://docs.github.com/en/rest/activity/notifications#mark-notifications-as-read)
- **Knock:** in-app messages track separate `seen`, `read`, `interacted` and `archived` statuses per recipient message. Mark-all-as-read bulk-updates them to read. [Knock, message statuses](https://docs.knock.app/send-notifications/message-statuses)

Neither documents its retention.

## Comparison

| | One row per recipient (Laravel, Django, Discourse, Mastodon) | Event row + recipient rows (Noticed) |
| --- | --- | --- |
| Rows per fan-out to N people | N | 1 + N |
| Snapshot text | copied onto each row | stored once on the event |
| Bell count and list | one table, one index | join to the event for the text |
| Mark one / mark all read | `UPDATE` on one table | same (read state lives on the recipient row) |
| "All Notifications caused by X" | needs `type` + target columns on the row | natural, via `event_id` |
| Retention | delete rows | delete rows, then orphaned events |
| Per-recipient wording ("your refund…" vs "Ana's refund…") | trivial | needs per-recipient overrides |

**Read state as a column versus a marker.** Every library studied keeps read state per row (`read_at` or `read`). Mastodon is the exception: it uses a cursor. Discourse and Noticed also keep a lighter "seen" signal beside "read". Discourse stores it as a per-user `seen_notification_id` high-water mark, Noticed as a per-row `seen_at`. That signal lets the bell badge clear when the dropdown opens without marking every item read. Cadence's v1 lifecycle (unread → read, plus mark-all) needs only `read_at`.

## Fit for Cadence (SQLite + Drizzle, small scale)

Recommended shape. It is a sketch for the spec, not final names:

```ts
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientId: integer("recipient_id").notNull().references(() => users.id),
    type: text("type").notNull().$type<NotificationType>(), // event catalogue enum
    reengagement: integer("reengagement", { mode: "boolean" }).notNull(), // or derive from type
    title: text("title").notNull(),    // snapshot
    body: text("body"),                // snapshot
    link: text("link").notNull(),      // where a click goes
    targetType: text("target_type"),   // e.g. "lesson" | "refund"; for link fallback
    targetId: integer("target_id"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    readAt: text("read_at"),
  },
  (t) => [
    index("notifications_recipient_created_idx").on(t.recipientId, t.createdAt),
    index("notifications_recipient_unread_idx").on(t.recipientId).where(sql`read_at IS NULL`),
  ]
);
```

### Why this shape fits

- **Snapshots favour one row per recipient.** The text is frozen at send time, and wording can differ by recipient: the Student and the Platform Admin see different text for the same Refund Request. Laravel and Discourse both copy the payload onto each row. At Cadence's scale, the duplicated bytes don't matter.
- **Synchronous fan-out is cheap in SQLite.** Do it as one multi-row `insert(...).values([...])` inside the same `better-sqlite3` transaction as the event that causes it. Noticed's `insert_all!` does the same. One statement can bind up to 32766 parameters on SQLite 3.32.0 and later ([SQLite limits §17](https://www.sqlite.org/limits.html)). At about 10 columns per row that is roughly 3,000 recipients per statement, so chunk above that.
- **Unread count:** `SELECT count(*) FROM notifications WHERE recipient_id = ? AND read_at IS NULL`. SQLite uses the partial index when the query's WHERE clause contains the same term as the index's WHERE clause ([SQLite partial indexes](https://www.sqlite.org/partialindex.html)), so write `read_at IS NULL` the same way in both. Drizzle 0.45's SQLite `IndexBuilder` has `.where(condition: SQL)` (`drizzle-orm/sqlite-core/indexes.d.ts`). A cached counter column on `users` is not worth the drift risk: Discourse, with far more traffic, still counts live. Copy Discourse's cap if you like (`LIMIT 100`, displayed as "99+").
- **Mark one read:** `UPDATE … SET read_at = ? WHERE id = ? AND recipient_id = ? AND read_at IS NULL`. The recipient check is the authorisation check, and the `IS NULL` check makes the update idempotent.
- **Mark all read:** `UPDATE … SET read_at = :now WHERE recipient_id = ? AND read_at IS NULL AND id <= :maxIdShown`. The `id <=` bound plays the role of GitHub's `last_read_at`: a Notification written between rendering the page and the click stays unread. Use `id` rather than a timestamp because `id` is monotonic per insert.
- **Re-engagement versus action-driven.** Store the distinction on the row, as a `type` that maps to a category or as an explicit flag. Then muting filters at **fan-out time**, so a muted user gets no row. Discourse and Knock likewise treat preferences as a send-time decision. Do not filter at read time, because that leaves the stored count and the visible list disagreeing.
- **Retention:** v1 has no delete, so nothing needs pruning for correctness. If growth ever matters, Discourse's per-user cap ports directly to SQLite, since SQLite has supported window functions since 3.25. Delete rows whose `id` is below the user's Nth-newest. Run it from a startup hook or an admin action, because Cadence has no scheduler (see the map's "time-based nudges" note). Deleting only read rows older than X days is a gentler alternative. Either way, `target_id` must never be a hard FK with cascade: the link-fallback rule needs the row to outlive its target.

### When the event table would be worth it

Choose the event table if the spec later needs any of the following:

- "collapse 5 lessons published into one Notification" (Mastodon instead solves this with a `group_key` column on the per-recipient row);
- "recall or edit a sent Notification for everyone";
- "when one Platform Admin decides a Refund Request, update the other admins' copies".

All three are listed under "Not yet specified" in map #2. The last one can also be done without an event table, with an `UPDATE … WHERE type = 'refund_requested' AND target_id = ?`.

## Not verified

- Novu's Inbox overview page does not document its storage model or retention. Novu was left out.
- GitHub and Knock don't publish their retention for in-app notifications.

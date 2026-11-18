import { eq } from "drizzle-orm";
import { UserRole, users } from "~/db/schema";
import {
  syncNotificationUser,
  type Notifications,
} from "~/lib/notifications.server";
import type { Db } from "~/db";

// ─── Users ───
// Signing up and editing a person's details. Every change Knock shows in
// other people's Notification Feeds (name, email, avatar) syncs the user
// through the Notifications port, best-effort: a failed sync is logged and
// never fails the action. Roles are never synced.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type User = typeof users.$inferSelect;

function getUser(db: Db, userId: number) {
  return db.select().from(users).where(eq(users.id, userId)).get();
}

/**
 * Creates a Student and syncs them (with their default Notification
 * preferences). An email that already has an account just returns that user,
 * so the caller can log them in.
 */
export async function signUp(
  db: Db,
  details: { name: string; email: string },
  notifications: Notifications
): Promise<User> {
  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, details.email))
    .get();
  if (existing) return existing;

  const user = db
    .insert(users)
    .values({
      name: details.name,
      email: details.email,
      role: UserRole.Student,
      avatarUrl: null,
    })
    .returning()
    .get();
  await syncNotificationUser(notifications, user);
  return user;
}

/**
 * Saves a person's own profile from `/settings`. Syncs them when their name
 * changes; the bio isn't shown in Notifications.
 */
export async function updateProfile(
  db: Db,
  userId: number,
  details: { name: string; bio?: string },
  notifications: Notifications
): Promise<User | undefined> {
  const before = getUser(db, userId);
  if (!before) return undefined;

  const user = db
    .update(users)
    .set({ name: details.name, bio: details.bio || null })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (user.name !== before.name) {
    await syncNotificationUser(notifications, user);
  }
  return user;
}

/** A Platform Admin's edit of someone's name and email in user admin. */
export async function updateUserByAdmin(
  db: Db,
  userId: number,
  details: { name: string; email: string },
  notifications: Notifications
): Promise<User | undefined> {
  if (!getUser(db, userId)) return undefined;

  const user = db
    .update(users)
    .set({ name: details.name, email: details.email })
    .where(eq(users.id, userId))
    .returning()
    .get();
  await syncNotificationUser(notifications, user);
  return user;
}

/**
 * Syncs every user, one at a time, writing default preferences for those who
 * have none yet. For the seed and the one-off backfill. Returns how many users
 * it went through.
 */
export async function syncAllUsers(
  db: Db,
  notifications: Notifications
): Promise<number> {
  const all = db.select().from(users).all();
  for (const user of all) {
    await syncNotificationUser(notifications, user);
  }
  return all.length;
}

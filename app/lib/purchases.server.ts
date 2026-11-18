import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  coupons,
  purchases,
  teamMembers,
  teams,
  TeamMemberRole,
} from "~/db/schema";
import { enrollUser } from "~/lib/enrollments.server";
import type { Notifications } from "~/lib/notifications.server";
import type { Db } from "~/db";

// ─── Purchases ───
// Buying a course: an Individual Purchase, which enrols the buyer, or a Team
// Licence, which creates Seats for others to claim. See GLOSSARY.md (Purchase,
// Team Licence).
//
// Every function takes the database first, so tests can hand in an in-memory
// one, and `now` last. Uses positional parameters (project convention).
// Functions that fire Notifications also take the Notifications port.

type Purchase = typeof purchases.$inferSelect;
type Seat = typeof coupons.$inferSelect;

/**
 * Records an Individual Purchase and enrols the buyer, which tells the
 * course's Instructor about the new Enrollment.
 */
export async function buyCourse(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  notifications: Notifications,
  now: Date
) {
  const purchase = createPurchase(
    db,
    buyerId,
    courseId,
    amountPaid,
    country,
    now
  );
  const enrollment = await enrollUser(
    db,
    buyerId,
    courseId,
    notifications,
    now
  );
  return { purchase, enrollment };
}

/**
 * Records a Team Licence and creates its Seats on the buyer's team (made on
 * their first Team Licence, with them as its Team Admin). The buyer isn't
 * enrolled, and a Team Licence isn't an Enrollment, so no Notification is
 * sent: the port is taken only so every purchase is called the same way.
 */
export async function buyTeamLicence(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  seatCount: number,
  _notifications: Notifications,
  now: Date
): Promise<{
  purchase: Purchase;
  team: typeof teams.$inferSelect;
  seats: Seat[];
}> {
  const purchase = createPurchase(
    db,
    buyerId,
    courseId,
    amountPaid,
    country,
    now
  );
  const team = getOrCreateTeamFor(db, buyerId);
  const seats = Array.from({ length: seatCount }, () =>
    db
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId,
        code: crypto.randomBytes(12).toString("base64url"),
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, team, seats };
}

function createPurchase(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  now: Date
): Purchase {
  return db
    .insert(purchases)
    .values({
      userId: buyerId,
      courseId,
      amountPaid,
      country,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();
}

function getOrCreateTeamFor(db: Db, userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();
  const existing = membership
    ? db.select().from(teams).where(eq(teams.id, membership.teamId)).get()
    : undefined;
  if (existing) return existing;

  const team = db.insert(teams).values({}).returning().get();
  db.insert(teamMembers)
    .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
    .run();
  return team;
}

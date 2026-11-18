import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";
import {
  signUp,
  syncAllUsers,
  updateProfile,
  updateUserByAdmin,
} from "./users.server";
import { fakeNotifications } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: ReturnType<typeof fakeNotifications>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotifications();
});

function findUser(id: number) {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}

describe("signUp", () => {
  it("creates a Student and syncs them with their default preferences", async () => {
    const user = await signUp(
      db,
      { name: "Grace Hopper", email: "grace@example.com" },
      notifications
    );

    expect(findUser(user.id)).toMatchObject({
      name: "Grace Hopper",
      email: "grace@example.com",
      role: schema.UserRole.Student,
    });
    expect(notifications.identified).toEqual([
      {
        id: user.id,
        name: "Grace Hopper",
        email: "grace@example.com",
        avatarUrl: null,
      },
    ]);
    expect(notifications.preferenceWrites.map((w) => w.userId)).toEqual([
      user.id,
    ]);
  });

  it("logs in an existing user without creating or syncing anyone", async () => {
    const user = await signUp(
      db,
      { name: "Someone Else", email: base.user.email },
      notifications
    );

    expect(user.id).toBe(base.user.id);
    expect(db.select().from(schema.users).all()).toHaveLength(2);
    expect(notifications.identified).toEqual([]);
  });

  it("still signs the user up when the sync fails", async () => {
    const failing = fakeNotifications({ failWith: new Error("Knock is down") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const user = await signUp(
      db,
      { name: "Grace Hopper", email: "grace@example.com" },
      failing
    );

    expect(findUser(user.id)?.name).toBe("Grace Hopper");
    vi.restoreAllMocks();
  });
});

describe("updateProfile", () => {
  it("syncs the user when their name changes", async () => {
    await updateProfile(
      db,
      base.user.id,
      { name: "Renamed User", bio: "Hi" },
      notifications
    );

    expect(findUser(base.user.id)).toMatchObject({
      name: "Renamed User",
      bio: "Hi",
    });
    expect(notifications.identified).toEqual([
      {
        id: base.user.id,
        name: "Renamed User",
        email: base.user.email,
        avatarUrl: base.user.avatarUrl,
      },
    ]);
  });

  it("doesn't sync when only the bio changes", async () => {
    await updateProfile(
      db,
      base.user.id,
      { name: base.user.name, bio: "New bio" },
      notifications
    );

    expect(findUser(base.user.id)?.bio).toBe("New bio");
    expect(notifications.identified).toEqual([]);
  });

  it("still saves the profile when the sync fails", async () => {
    const failing = fakeNotifications({ failWith: new Error("Knock is down") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateProfile(
      db,
      base.user.id,
      { name: "Renamed User", bio: undefined },
      failing
    );

    expect(findUser(base.user.id)?.name).toBe("Renamed User");
    vi.restoreAllMocks();
  });
});

describe("updateUserByAdmin", () => {
  it("syncs the edited user's new name and email", async () => {
    await updateUserByAdmin(
      db,
      base.user.id,
      { name: "Edited", email: "edited@example.com" },
      notifications
    );

    expect(findUser(base.user.id)).toMatchObject({
      name: "Edited",
      email: "edited@example.com",
    });
    expect(notifications.identified).toEqual([
      {
        id: base.user.id,
        name: "Edited",
        email: "edited@example.com",
        avatarUrl: base.user.avatarUrl,
      },
    ]);
  });

  it("leaves a synced user's existing preferences alone", async () => {
    const mine = { enrollments: { feed: true } };
    notifications.preferences.set(base.user.id, mine);

    await updateUserByAdmin(
      db,
      base.user.id,
      { name: "Edited", email: "edited@example.com" },
      notifications
    );

    expect(notifications.preferenceWrites).toEqual([]);
    expect(notifications.preferences.get(base.user.id)).toEqual(mine);
  });

  it("still saves the edit when the sync fails", async () => {
    const failing = fakeNotifications({ failWith: new Error("Knock is down") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateUserByAdmin(
      db,
      base.user.id,
      { name: "Edited", email: "edited@example.com" },
      failing
    );

    expect(findUser(base.user.id)?.name).toBe("Edited");
    vi.restoreAllMocks();
  });
});

describe("syncAllUsers", () => {
  it("syncs every user, writing defaults only for those without a set", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: true },
    });

    await syncAllUsers(db, notifications);

    expect(notifications.identified.map((u) => u.id).sort()).toEqual(
      [base.user.id, base.instructor.id].sort()
    );
    expect(notifications.preferenceWrites.map((w) => w.userId)).toEqual([
      base.user.id,
    ]);
  });
});

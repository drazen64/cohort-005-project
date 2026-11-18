import { describe, it, expect, vi } from "vitest";
import { mergePreference } from "./notifications";
import {
  fakeNotifications,
  syncNotificationUser,
} from "./notifications.server";

const ADA = {
  id: 7,
  name: "Ada Lovelace",
  email: "ada@example.com",
  avatarUrl: "https://example.com/ada.png",
};

describe("syncNotificationUser", () => {
  it("syncs the user's name, email and avatar", async () => {
    const notifications = fakeNotifications();

    await syncNotificationUser(notifications, ADA);

    expect(notifications.identified).toEqual([ADA]);
  });

  it("writes the default preferences on a first sync: Enrollments off, the rest on, Feed only", async () => {
    const notifications = fakeNotifications();

    await syncNotificationUser(notifications, ADA);

    expect(notifications.preferenceWrites).toEqual([
      {
        userId: 7,
        preferences: {
          refundRequestUpdates: { feed: true },
          openRefundRequests: { feed: true },
          seatClaims: { feed: true },
          enrollments: { feed: false },
          discussionQuestions: { feed: true },
          discussionReplies: { feed: true },
        },
      },
    ]);
  });

  it("leaves an existing preference set alone on a later sync", async () => {
    const notifications = fakeNotifications();
    const mine = { enrollments: { feed: true }, discussionReplies: { feed: false } };
    notifications.preferences.set(7, mine);

    await syncNotificationUser(notifications, { ...ADA, name: "Ada King" });

    expect(notifications.identified).toEqual([{ ...ADA, name: "Ada King" }]);
    expect(notifications.preferenceWrites).toEqual([]);
    expect(notifications.preferences.get(7)).toEqual(mine);
  });

  it("logs a failed sync instead of throwing", async () => {
    const notifications = fakeNotifications({ failWith: new Error("Knock is down") });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncNotificationUser(notifications, ADA)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

describe("mergePreference", () => {
  it("flips one category on the Feed and leaves the others as they are", () => {
    const current = {
      enrollments: { feed: true },
      discussionReplies: { feed: false },
      seatClaims: { feed: true },
    };

    expect(mergePreference(current, "discussionReplies", "feed", true)).toEqual({
      enrollments: { feed: true },
      discussionReplies: { feed: true },
      seatClaims: { feed: true },
    });
  });

  it("starts from the defaults when the person has no preference set yet", () => {
    expect(mergePreference(null, "enrollments", "feed", true)).toEqual({
      refundRequestUpdates: { feed: true },
      openRefundRequests: { feed: true },
      seatClaims: { feed: true },
      enrollments: { feed: true },
      discussionQuestions: { feed: true },
      discussionReplies: { feed: true },
    });
  });
});

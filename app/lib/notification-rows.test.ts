import { describe, expect, it } from "vitest";
import type { FeedNotification } from "./notification-feed";
import { describeNotification } from "./notification-rows";

function feedNotification(
  overrides: Partial<FeedNotification> = {}
): FeedNotification {
  return {
    id: "msg_1",
    notification: "discussionReply",
    insertedAt: "2026-11-19T10:00:00Z",
    seenAt: null,
    readAt: null,
    actor: { name: "Ada Lovelace", avatarUrl: null },
    data: {},
    ...overrides,
  };
}

describe("describeNotification", () => {
  it("writes a Discussion Reply row that links to the comment", () => {
    const row = describeNotification(
      feedNotification({
        notification: "discussionReply",
        data: {
          commentId: 7,
          lessonTitle: "Closures",
          snippet: "Try returning a function",
          url: "/courses/js/lessons/3#comment-7",
        },
      })
    );

    expect(row).toEqual({
      title: "Ada Lovelace replied to your question",
      snippet: "“Try returning a function”",
      category: "discussionReplies",
      url: "/courses/js/lessons/3#comment-7",
    });
  });

  it.each([
    {
      notification: "discussionQuestion",
      data: { lessonTitle: "Closures", snippet: "Why does this work?" },
      title: "Ada Lovelace asked a question on Closures",
      snippet: "“Why does this work?”",
      category: "discussionQuestions",
    },
    {
      notification: "enrollment",
      data: { courseTitle: "JavaScript Basics" },
      title: "Ada Lovelace enrolled",
      snippet: "JavaScript Basics",
      category: "enrollments",
    },
    {
      notification: "seatClaimed",
      data: { courseTitle: "JavaScript Basics", seatsLeft: 3 },
      title: "Ada Lovelace claimed a Seat",
      snippet: "JavaScript Basics · 3 Seats left",
      category: "seatClaims",
    },
    {
      notification: "seatClaimed",
      data: { courseTitle: "JavaScript Basics", seatsLeft: 1 },
      title: "Ada Lovelace claimed a Seat",
      snippet: "JavaScript Basics · 1 Seat left",
      category: "seatClaims",
    },
    {
      notification: "openRefundRequest",
      data: {
        courseTitle: "JavaScript Basics",
        amount: 4900,
        reason: "Not what I expected",
      },
      title: "Ada Lovelace asked for a $49.00 refund",
      snippet: "JavaScript Basics · “Not what I expected”",
      category: "openRefundRequests",
    },
    {
      notification: "refundRequestApproved",
      data: { courseTitle: "JavaScript Basics", decisionNote: "Sorry!" },
      title: "Your Refund Request was approved",
      snippet: "JavaScript Basics · “Sorry!”",
      category: "refundRequestUpdates",
    },
    {
      notification: "refundRequestDeclined",
      data: { courseTitle: "JavaScript Basics", decisionNote: "Too late" },
      title: "Your Refund Request was declined",
      snippet: "“Too late” You can ask again.",
      category: "refundRequestUpdates",
    },
    {
      notification: "refundRequestConfirmation",
      data: { courseTitle: "JavaScript Basics", amount: 4900 },
      title: "We've received your $49.00 Refund Request",
      snippet: "JavaScript Basics · A Platform Admin will review it.",
      category: "refundRequestUpdates",
    },
  ] as const)(
    "writes a $notification row from its trigger data",
    ({ notification, data, title, snippet, category }) => {
      const row = describeNotification(
        feedNotification({ notification, data })
      );

      expect(row).toEqual({ title, snippet, category, url: null });
    }
  );

  it.each([
    "discussionQuestion",
    "enrollment",
    "seatClaimed",
    "openRefundRequest",
    "refundRequestApproved",
    "refundRequestDeclined",
    "refundRequestConfirmation",
  ] as const)("writes a %s row with no trigger data", (notification) => {
    const row = describeNotification(
      feedNotification({ notification, actor: null, data: {} })
    );

    expect(row.title).not.toMatch(/undefined|null|NaN/);
    expect(row.snippet ?? "").not.toMatch(/undefined|null|NaN/);
  });

  it("falls back to a plain row for a Notification Cadence doesn't know", () => {
    const row = describeNotification(
      feedNotification({ notification: null, data: { url: "/somewhere" } })
    );

    expect(row).toEqual({
      title: "New notification",
      snippet: null,
      category: null,
      url: "/somewhere",
    });
  });

  it("drops fields the trigger data lacks instead of printing them", () => {
    const row = describeNotification(
      feedNotification({
        notification: "discussionReply",
        actor: null,
        data: { snippet: 42, url: null },
      })
    );

    expect(row).toEqual({
      title: "Someone replied to your question",
      snippet: null,
      category: "discussionReplies",
      url: null,
    });
  });

  it("only follows links inside Cadence", () => {
    const row = describeNotification(
      feedNotification({ data: { url: "https://evil.example/phish" } })
    );

    expect(row.url).toBeNull();
  });
});

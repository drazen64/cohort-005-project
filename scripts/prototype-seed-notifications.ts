// PROTOTYPE — throwaway (wayfinder #18). Sends sample Notifications from the
// v1 catalogue through the real Knock Development environment so the Notification
// Feed prototype has something to show. Archives each persona's existing feed
// first, so it's safe to rerun.
//
//   npm run prototype:seed-notifications
//
// Needs a committed Knock workflow with key `prototype-feed` that has a single
// in-app feed step (the template body can be anything, e.g. `{{ data.title }}`).
import {
  getFeed,
  setMessageStatus,
} from "../app/lib/knock-prototype.server";

process.loadEnvFile(".env");

const WORKFLOW = "prototype-feed";
const people = {
  alex: { id: "1", name: "Alex Rivera" }, // Platform Admin
  sarah: { id: "2", name: "Sarah Chen" }, // Instructor (TypeScript, Tailwind)
  emma: { id: "5", name: "Emma Wilson" }, // Student
  james: { id: "6", name: "James Park" }, // Student
  olivia: { id: "7", name: "Olivia Martinez" }, // Student
  bossy: { id: "10", name: "Bossy McBossface" }, // Team Admin
  ava: { id: "11", name: "Ava Nakamura" }, // Student
};
type Person = (typeof people)[keyof typeof people];

const TS = { title: "Introduction to TypeScript", slug: "introduction-to-typescript", id: 1 };
const TW = { title: "Design Systems with Tailwind", slug: "design-systems-with-tailwind", id: 3 };

// Oldest first. `read: true` marks it read afterwards, to show mixed states.
const samples: {
  to: Person;
  actor: Person;
  read?: boolean;
  data: { kind: string; title: string; snippet?: string; url: string; courseTitle?: string };
}[] = [
  // Platform Admin: new Open Refund Requests
  { to: people.alex, actor: people.james, read: true, data: { kind: "refund-requested", title: "James Park requested a $49.00 refund", snippet: "The course wasn't what I expected from the description.", url: "/admin/refunds", courseTitle: TW.title } },
  { to: people.alex, actor: people.emma, data: { kind: "refund-requested", title: "Emma Wilson requested a $79.00 refund", snippet: "I bought it twice by accident, once on my work card.", url: "/admin/refunds", courseTitle: TS.title } },
  { to: people.alex, actor: people.olivia, data: { kind: "discussion-reply", title: "Olivia Martinez replied to your question", snippet: "You can use `satisfies` there, it keeps the literal types.", url: `/courses/${TS.slug}/lessons/4`, courseTitle: TS.title } },

  // Instructor: Discussion Questions, an opted-in Enrollment
  { to: people.sarah, actor: people.ava, read: true, data: { kind: "enrollment", title: "Ava Nakamura enrolled in your course", url: `/instructor/${TS.id}/students`, courseTitle: TS.title } },
  { to: people.sarah, actor: people.james, read: true, data: { kind: "discussion-question", title: "James Park asked a question on “Installing and Configuring TypeScript”", snippet: "Should strict be on from day one, or is it better to turn it on once the codebase compiles?", url: `/courses/${TS.slug}/lessons/2`, courseTitle: TS.title } },
  { to: people.sarah, actor: people.emma, data: { kind: "discussion-question", title: "Emma Wilson asked a question on “Primitive Types”", snippet: "Why does `typeof null` return \"object\"? Is this something TypeScript fixes or just something we live with? I tried narrowing on it and the compiler still let a null through in one branch, which surprised me a lot.", url: `/courses/${TS.slug}/lessons/4`, courseTitle: TS.title } },
  { to: people.sarah, actor: people.olivia, data: { kind: "enrollment", title: "Olivia Martinez enrolled in your course", url: `/instructor/${TW.id}/students`, courseTitle: TW.title } },

  // Student: Refund decisions, a Discussion Reply
  { to: people.emma, actor: people.alex, read: true, data: { kind: "refund-declined", title: "Your refund request was declined", snippet: "You've completed 80% of the course. You're welcome to ask again if something's wrong.", url: `/courses/${TW.slug}`, courseTitle: TW.title } },
  { to: people.emma, actor: people.sarah, data: { kind: "discussion-reply", title: "Sarah Chen replied to your question on “Primitive Types”", snippet: "Great question! It's a historical JavaScript bug, and TypeScript models it faithfully. Narrow with `=== null` instead.", url: `/courses/${TS.slug}/lessons/4`, courseTitle: TS.title } },
  { to: people.emma, actor: people.alex, data: { kind: "refund-approved", title: "Your refund request was approved", snippet: "Refunded the duplicate purchase. Sorry about that!", url: `/courses/${TS.slug}`, courseTitle: TS.title } },

  // Team Admin: Claimed Seats, a Team Licence refund
  { to: people.bossy, actor: people.ava, read: true, data: { kind: "seat-claimed", title: "Ava Nakamura claimed a Seat", snippet: "4 of 10 Seats left", url: "/team", courseTitle: TS.title } },
  { to: people.bossy, actor: people.james, data: { kind: "seat-claimed", title: "James Park claimed a Seat", snippet: "3 of 10 Seats left", url: "/team", courseTitle: TS.title } },
  { to: people.bossy, actor: people.alex, data: { kind: "refund-approved", title: "Your refund request for the Team Licence was approved", url: `/courses/${TW.slug}`, courseTitle: TW.title } },
];

async function knock(path: string, body: unknown) {
  const res = await fetch(`https://api.knock.app/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KNOCK_SECRET_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const recipients = [people.alex, people.sarah, people.emma, people.bossy];

for (const r of recipients) {
  const feed = await getFeed(Number(r.id));
  await setMessageStatus(feed.notifications.map((n) => n.id), "archived");
}

for (const s of samples) {
  await knock(`/workflows/${WORKFLOW}/trigger`, {
    recipients: [s.to],
    actor: s.actor,
    data: s.data,
  });
  await new Promise((r) => setTimeout(r, 1100)); // distinct timestamps
}

console.log("Triggered", samples.length, "Notifications. Waiting for delivery…");
await new Promise((r) => setTimeout(r, 4000));

for (const r of recipients) {
  const feed = await getFeed(Number(r.id));
  const toRead = feed.notifications.filter((n) =>
    samples.some((s) => s.read && s.to === r && s.data.title === n.title)
  );
  await setMessageStatus(toRead.map((n) => n.id), "seen");
  await setMessageStatus(toRead.map((n) => n.id), "read");
  console.log(`${r.name}: ${feed.notifications.length} in feed, ${toRead.length} marked read`);
}

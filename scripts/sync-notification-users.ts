// One-off backfill: syncs every existing user to the Notifications vendor
// (Knock) with their name, email and avatar, and writes the default preference
// set (Enrollments off, everything else on) for anyone who has none yet. An
// existing set is never overwritten, so it is safe to run again.
//
// Run with `npm run notifications:backfill`. Needs KNOCK_SECRET_API_KEY in the
// environment or in `.env`; without it, it logs and skips every user.

import { db } from "../app/db";
import { defaultNotifications } from "../app/lib/notifications.server";
import { syncAllUsers } from "../app/lib/users.server";

const synced = await syncAllUsers(db, defaultNotifications());
console.log(`Synced ${synced} users. Failures, if any, are logged above.`);

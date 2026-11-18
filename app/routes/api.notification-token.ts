import { data } from "react-router";
import type { Route } from "./+types/api.notification-token";
import { requireUserId } from "~/lib/access.server";
import { defaultNotifications } from "~/lib/notifications.server";

// A fresh signed user token for the session user's Notification Feed. The
// browser calls this shortly before its current token expires.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const connection = await defaultNotifications().connectFeed(userId);
  if (!connection) {
    throw data("Notifications are not configured", { status: 404 });
  }
  return Response.json({ userToken: connection.userToken });
}

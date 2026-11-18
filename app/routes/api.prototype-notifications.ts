// PROTOTYPE — throwaway (wayfinder #18). Marks Knock feed messages
// seen/read/unread/archived. Doesn't check the ids belong to the current user.
import type { Route } from "./+types/api.prototype-notifications";
import { getCurrentUserId } from "~/lib/session";
import {
  setMessageStatus,
  type MessageStatus,
} from "~/lib/knock-prototype.server";

const STATUSES: MessageStatus[] = ["seen", "read", "unread", "archived"];

export async function action({ request }: Route.ActionArgs) {
  if (!(await getCurrentUserId(request))) {
    throw new Response("Select a user from the DevUI panel", { status: 401 });
  }
  const form = await request.formData();
  const status = String(form.get("status")) as MessageStatus;
  if (!STATUSES.includes(status)) throw new Response("bad status", { status: 400 });
  const ids = form.getAll("id").map(String);
  await setMessageStatus(ids, status);
  return { ok: true };
}

import { useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/settings";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Switch } from "~/components/ui/switch";
import { UserRole, RefundStatus, users } from "~/db/schema";
import { AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { formatPrice } from "~/lib/utils";
import { listRefundRequestsForBuyer } from "~/lib/refunds.server";
import { defaultNotifications } from "~/lib/notifications.server";
import { updateProfile } from "~/lib/users.server";
import {
  listPreferenceSwitches,
  setPreference,
  type PreferenceSwitch,
} from "~/lib/notification-preferences.server";
import {
  NOTIFICATION_CATEGORY_NAMES,
  type NotificationCategory,
} from "~/lib/notifications";

const settingsSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("profile"),
    name: z.string().trim().min(1, "Name cannot be empty."),
    bio: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("notification-preference"),
    category: z.enum(NOTIFICATION_CATEGORY_NAMES),
    enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
  }),
]);

const NOTIFICATION_PREFERENCE_SAVE_FAILED =
  "Couldn't save your Notification preference. Please try again.";

export function meta() {
  return [
    { title: "Settings — Cadence" },
    { name: "description", content: "Edit your profile details" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to edit your details.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const refundRequests = listRefundRequestsForBuyer(db, currentUserId);

  // `null` when the preferences can't be read, so the page still loads.
  let notificationPreferences: PreferenceSwitch[] | null = null;
  try {
    notificationPreferences = await listPreferenceSwitches(
      db,
      currentUserId,
      defaultNotifications()
    );
  } catch (error) {
    console.error(
      `[notifications] Failed to read preferences for user ${currentUserId}`,
      error
    );
  }

  return {
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      bio: currentUser.bio,
      role: currentUser.role,
    },
    refundRequests,
    notificationPreferences,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, settingsSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  if (parsed.data.intent === "notification-preference") {
    try {
      await setPreference(
        currentUserId,
        parsed.data.category,
        parsed.data.enabled,
        defaultNotifications()
      );
    } catch (error) {
      console.error(
        `[notifications] Failed to save preference ${parsed.data.category} for user ${currentUserId}`,
        error
      );
      throw data(NOTIFICATION_PREFERENCE_SAVE_FAILED, { status: 502 });
    }
    return { saved: true };
  }

  const user = await updateProfile(
    db,
    currentUserId,
    parsed.data,
    defaultNotifications()
  );
  if (!user) {
    throw data("User not found.", { status: 404 });
  }
  return { success: true };
}

/**
 * A preference switch saves through its own fetcher, and a fetcher's thrown
 * response would replace the whole page with the ErrorBoundary. The failed
 * save is caught here instead and handed to that switch, which puts itself
 * back and shows a toast. Every other failure still reaches the
 * ErrorBoundary.
 */
export async function clientAction({ serverAction }: Route.ClientActionArgs) {
  try {
    return await serverAction();
  } catch (error) {
    if (
      isRouteErrorResponse(error) &&
      error.status === 502 &&
      error.data === NOTIFICATION_PREFERENCE_SAVE_FAILED
    ) {
      return { error: NOTIFICATION_PREFERENCE_SAVE_FAILED };
    }
    throw error;
  }
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { user, refundRequests, notificationPreferences } = loaderData;
  const openCount = refundRequests.filter(
    (refundRequest) => refundRequest.status === RefundStatus.Open
  ).length;
  const fetcher = useFetcher();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Profile updated successfully.");
    }
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      const firstError = Object.values(fetcher.data.errors)[0] as string | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Settings</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Update your profile details
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Profile</h2>
        </CardHeader>
        <CardContent>
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="profile" />
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                ref={nameInputRef}
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                disabled
                className="text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed.
              </p>
            </div>
            {user.role === UserRole.Instructor && (
              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  defaultValue={user.bio ?? ""}
                  placeholder="Tell students about yourself..."
                />
                <p className="text-xs text-muted-foreground">
                  Your bio is shown on your course pages.
                </p>
              </div>
            )}
            <Button
              type="submit"
              disabled={fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? "Saving..." : "Save Changes"}
            </Button>
          </fetcher.Form>
        </CardContent>
      </Card>

      <NotificationsCard preferences={notificationPreferences} />

      {refundRequests.length > 0 && (
        <Card className="mt-8 max-w-md">
          <CardHeader>
            <h2 className="text-lg font-semibold">Refund Requests</h2>
            {openCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {openCount === 1
                  ? "One refund request is waiting on us."
                  : `${openCount} refund requests are waiting on us.`}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {refundRequests.map((refundRequest) => (
              <div key={refundRequest.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/courses/${refundRequest.courseSlug}`}
                    className="font-medium hover:underline"
                  >
                    {refundRequest.courseTitle}
                  </Link>
                  <RefundStatusBadge status={refundRequest.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(refundRequest.amountPaid)} · raised{" "}
                  {new Date(refundRequest.requestedAt).toLocaleDateString()}
                  {refundRequest.resolvedAt && (
                    <>
                      {" "}
                      · decided{" "}
                      {new Date(refundRequest.resolvedAt).toLocaleDateString()}
                    </>
                  )}
                </p>
                <p className="mt-2 text-sm">{refundRequest.reason}</p>
                {refundRequest.decisionNote && (
                  <p className="mt-2 rounded-md bg-muted p-2 text-sm">
                    <span className="font-medium">Our note: </span>
                    {refundRequest.decisionNote}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const NOTIFICATION_PREFERENCE_COPY: Record<
  NotificationCategory,
  { label: string; description: string }
> = {
  refundRequestUpdates: {
    label: "Refund Request updates",
    description:
      "When we receive, approve or decline a Refund Request you raised.",
  },
  openRefundRequests: {
    label: "Open Refund Requests",
    description: "When a buyer raises a Refund Request that needs a decision.",
  },
  seatClaims: {
    label: "Seat claims",
    description: "When someone claims a Seat on one of your Team Licences.",
  },
  enrollments: {
    label: "Enrollments",
    description: "When a Student enrols on one of your courses.",
  },
  discussionQuestions: {
    label: "Discussion Questions",
    description: "When someone asks a question on one of your lessons.",
  },
  discussionReplies: {
    label: "Discussion Replies",
    description: "When someone replies to a question you asked.",
  },
};

function NotificationsCard({
  preferences,
}: {
  preferences: PreferenceSwitch[] | null;
}) {
  return (
    <Card className="mt-8 max-w-md">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose what shows up in your Notification Feed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {preferences === null ? (
          <p className="text-sm text-muted-foreground">
            Your Notification preferences can't be loaded right now. Please try
            again later.
          </p>
        ) : (
          preferences.map((preference) => (
            <NotificationPreferenceSwitch
              key={preference.category}
              preference={preference}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Saves as soon as it's flipped. While the save is in flight the switch shows
 * the new value; if it fails, the action leaves the preference as it was and
 * throws, `clientAction` hands the failure back here, and the switch falls
 * back to the loader's value while a toast explains.
 */
function NotificationPreferenceSwitch({
  preference,
}: {
  preference: PreferenceSwitch;
}) {
  const fetcher = useFetcher<{ error?: string; saved?: boolean }>();
  const id = `notification-preference-${preference.category}`;
  const copy = NOTIFICATION_PREFERENCE_COPY[preference.category];

  const pending = fetcher.formData?.get("enabled");
  const checked =
    pending === undefined || pending === null
      ? preference.enabled
      : pending === "true";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{copy.label}</Label>
        <p className="text-xs text-muted-foreground">{copy.description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(enabled) =>
          fetcher.submit(
            {
              intent: "notification-preference",
              category: preference.category,
              enabled: String(enabled),
            },
            { method: "post" }
          )
        }
      />
    </div>
  );
}

const REFUND_STATUS_BADGES: Record<
  RefundStatus,
  { label: string; className: string }
> = {
  [RefundStatus.Open]: {
    label: "Open",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  [RefundStatus.Approved]: {
    label: "Approved",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  [RefundStatus.Declined]: {
    label: "Declined",
    className: "bg-muted text-muted-foreground",
  },
};

function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const badge = REFUND_STATUS_BADGES[status];
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 404) {
      title = "User not found";
      message =
        typeof error.data === "string" ? error.data : "User not found.";
    } else {
      title = `Error ${error.status}`;
      message =
        typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

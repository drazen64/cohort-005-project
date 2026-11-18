// PROTOTYPE — throwaway (wayfinder #18). Variant B's full-page inbox.
// Reads the feed the layout loader already fetched.
import { useRouteLoaderData } from "react-router";
import type { loader as layoutLoader } from "./layout.app";
import { VariantBInboxPage } from "~/components/notification-feed-prototype";

export default function NotificationsPrototypePage() {
  const data = useRouteLoaderData<typeof layoutLoader>("routes/layout.app");
  if (!data?.currentUser) {
    return <p className="p-8">Select a user from the DevUI panel.</p>;
  }
  return <VariantBInboxPage feed={data.feed} />;
}

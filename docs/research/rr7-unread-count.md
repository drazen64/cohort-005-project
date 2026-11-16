# Unread notification count in a layout loader (React Router framework mode)

Researched 2026-11-16 against the installed `react-router@8.3.0` (source in `node_modules/react-router/dist/development`, cross-checked with the `react-router@8.3.0` tag on GitHub) and the reactrouter.com docs (latest is 8.5.1; v7.18.5 docs compared where relevant).

Source shorthands used below:

- `router.ts` = https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts
- `single-fetch.tsx` = https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx

## Question

In framework mode, what is the recommended way to show an unread notification count from a layout route's loader (`app/routes/layout.app.tsx`, a pathless layout with a heavy loader) so it updates after mutations like mark-as-read, without needless refetching on every navigation? Cover `shouldRevalidate`, fetchers with optimistic mark-as-read, and pitfalls. Notifications only arrive on page load or navigation (no push).

## Short answer

- With SSR on (`ssr: true`, as in this app), **every active loader reruns on every client navigation and after every successful submission** (`<Form>`, `fetcher.submit`). This includes the pathless layout loader, even when moving between sibling children with no param change. Failed submissions (4xx/5xx) skip revalidation. This is the same in v7 and v8. So a count in `layout.app.tsx`'s loader is already fresh after mark-as-read and on navigation. The cost is that the whole heavy loader also reruns every time.
- `shouldRevalidate` opts **one route's** loader out. It does not change parents or siblings. Return `defaultShouldRevalidate` as the fallback, never a blanket `false`.
- To avoid rerunning the heavy loader just for the count, give the count its own cheap loader. That can be a small pathless route nested directly inside `layout.app`, read with `useRouteLoaderData`. Then let `layout.app` skip revalidation for the notification actions only. With single fetch this costs no extra HTTP request: the router sends one `.data` request with a `_routes` filter.
- For mark-as-read, use `useFetcher` / `fetcher.Form` posting to a resource-route action. Lower the badge optimistically by reading in-flight submissions with `useFetchers()` in the component that renders the badge.

## Findings

### 1. Default revalidation rules in framework mode (SSR)

1. The docs say: "In framework mode with SSR, route loaders are automatically revalidated after all navigations and form submissions (this is different from Data Mode)." [route-module#shouldRevalidate](https://reactrouter.com/start/framework/route-module#shouldrevalidate). The v7 docs have identical wording, with no future flag involved: [v7.18.5 route-module#shouldRevalidate](https://reactrouter.com/7.18.5/start/framework/route-module#shouldrevalidate).
2. Framework + SSR: "active loaders are revalidated on navigations and successful submissions (Link, Form, fetcher.submit)", and "Failed submissions returning a 4xx/5xx status do not trigger revalidations by default." [optimize-revalidation](https://reactrouter.com/how-to/optimize-revalidation)
3. SPA mode / Data Mode differ. There, GET navigations revalidate only when the route's dynamic params change, search params change, or the navigation goes to the exact same URL. [optimize-revalidation](https://reactrouter.com/how-to/optimize-revalidation)
4. **Verified in source: does a parent loader rerun between sibling children whose params did not change?**
   - The core router computes a Data-Mode-style default. That default is true for a forced revalidation (submission, `useRevalidator`), the same URL, a search change, or `isNewRouteInstance`. `isNewRouteInstance` compares `match.pathname`, and for a pathless layout that never changes ([`router.ts` L5445-L5470](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L5445-L5470), [L5701](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L5701)). In Data Mode, then, the answer would be **no**.
   - Framework mode, however, installs the single-fetch `dataStrategy`. For each match it calls `m.shouldCallHandler(defaultShouldRevalidate)`, with `defaultShouldRevalidate = actionStatus == null || actionStatus < 400`. That **overrides** the router's computed default with `true` for every navigation ([`single-fetch.tsx` L373-L377](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx#L373-L377)).
   - `shouldCallHandler` then passes that value into the route's `shouldRevalidate`, or returns it directly if the route has none ([`router.ts` L5717](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L5717)).
   - **Result for this app: yes, `layout.app`'s loader reruns on every client navigation**, including `/courses` to `/dashboard`.
5. After a fetcher action, the router calls `interruptActiveLoads()`, which sets `isRevalidationRequired = true`. All matched loaders then revalidate ([`router.ts` L3492](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L3492)). The exception is an action status `>= 400` (`shouldSkipRevalidation`, [`router.ts` L5389](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L5389)).
6. A plain `fetch()` to a resource route bypasses the router and revalidates nothing. Calling the same action through `<Form>` or `useFetcher` "still revalidates matched UI loaders." [resource-routes](https://reactrouter.com/how-to/resource-routes), [optimize-revalidation](https://reactrouter.com/how-to/optimize-revalidation). (This app's `youtube-player.tsx` posts to `/api/video-tracking` with plain `fetch()`. The sidebar's `recentCourses` progress therefore refreshes today only because the layout reruns on navigation.)

### 2. `shouldRevalidate`

1. Defining it "allows you to opt out of revalidation for **this route's** loader. It does not skip parent or sibling loaders. After `fetcher.submit()`, `root` still revalidates unless it also opts out." [route-module#shouldRevalidate](https://reactrouter.com/start/framework/route-module#shouldrevalidate)
2. Matched routes are handled independently: "A child that skips revalidation does not skip any ancestor routes." [optimize-revalidation](https://reactrouter.com/how-to/optimize-revalidation)
3. Args (`ShouldRevalidateFunctionArgs`):
   - `currentUrl`, `currentParams`, `nextUrl`, `nextParams`
   - the submission fields spread flat: `formMethod`, `formAction`, `formEncType`, `formData`, `text`, `json`
   - `actionResult`, `actionStatus`, `defaultShouldRevalidate`

   ([`router.ts` getMatchesToLoad L5331+](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L5331); type docs in [`utils.ts`](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/utils.ts)). `formMethod`/`formAction` are `undefined` on plain navigations, which is how you tell a navigation from a submission.
4. The docs warn: "Always returning `false` can leave this route's UI out of sync with the server. Prefer inspecting the arguments and falling back to `defaultShouldRevalidate`." [route-module#shouldRevalidate](https://reactrouter.com/start/framework/route-module#shouldrevalidate)
5. A non-boolean return falls back to `defaultShouldRevalidate` ([`router.ts` L5717](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L5717)).
6. **Subtlety (source):** in framework SSR mode, the `defaultShouldRevalidate` your function receives is the single-fetch value. That is "true unless the action returned 4xx/5xx" (or a call-site override), not "params changed" ([`single-fetch.tsx` L373](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx#L373)). If you want "only when the URL actually changed", compare `currentUrl`/`nextUrl` yourself.
7. You can also opt out per submission at the call site: `defaultShouldRevalidate={false}` on `<Form>`, `<Link>`, `<fetcher.Form>`, or as an option to `fetcher.submit`, `useSubmit`, `useNavigate`, `useSearchParams`. Routes without `shouldRevalidate` use that value directly. Routes that export one receive it as `defaultShouldRevalidate` and still decide. [optimize-revalidation](https://reactrouter.com/how-to/optimize-revalidation), [how-to/fetchers](https://reactrouter.com/how-to/fetchers)

### 3. Single fetch interaction

1. On a navigation, every route that should load goes into **one** `.data` request. If at least one revalidating route with a server loader opted out (via `shouldRevalidate` or by having a `clientLoader`), the client adds a `_routes=<ids>` param so that only the needed server loaders run ([`single-fetch.tsx` L343-L355](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx#L343-L355), [L446-L451](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx#L446-L451), [L592](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx#L592)).
2. So adding a small count route costs no extra round trip, and opting the heavy layout out really does skip its server work.
3. A route **with a `clientLoader`** opts out of the shared request. It fetches its own server data with a separate `?_routes` request ([`single-fetch.tsx` L386-L392](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx#L386-L392)).
4. `shouldRevalidate` only affects client-side navigations and revalidations. On a document request the server runs all matched loaders anyway.

### 4. Fetchers for mark-as-read and optimistic UI

1. Submitting a fetcher calls the action and "revalidate[s] the route data automatically." `fetcher.submit` accepts `defaultShouldRevalidate`. [how-to/fetchers](https://reactrouter.com/how-to/fetchers)
2. Optimistic UI uses `fetcher.formData` to render the expected state before the server responds. `fetcher.state` (`"idle" | "submitting" | "loading"`) drives pending UI. [pending-ui](https://reactrouter.com/start/framework/pending-ui), [how-to/fetchers](https://reactrouter.com/how-to/fetchers)
3. `useFetchers()` "Returns an array of all in-flight `Fetcher`s. This is useful for components throughout the app that didn't create the fetchers but want to use their submissions to participate in optimistic UI." Each fetcher has `key`, `state`, `formData`, `formAction`, `formMethod`, `data`. [useFetchers](https://reactrouter.com/api/hooks/useFetchers)
4. A fetcher stays in-flight (`state: "loading"`) while the post-action revalidation runs. The router keeps the submitting fetcher in a loading state until the revalidated loader data lands ([`router.ts` handleFetcherAction L2912, L3013-L3016](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L3013-L3016), "done" fetcher and revalidated `loaderData` committed in one `updateState()`). So subtracting in-flight mark-read submissions from the loader count does not flicker: the fetcher leaves `useFetchers()` in the same commit as the fresh count.
5. The `key` option shares one fetcher's state across components: `useFetcher({ key: "my-key" })` elsewhere returns "the same fetcher, sharing the state across the app." [useFetcher](https://reactrouter.com/api/hooks/useFetcher)
6. `fetcher.load` data "only revalidates by default after action submissions and explicit `useRevalidator` calls, not on search-param or param-driven navigations." [optimize-revalidation](https://reactrouter.com/how-to/optimize-revalidation). Source: fetcher revalidation defaults to `isRevalidationRequired` ([`router.ts` L5599](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts#L5599)).
7. Resource routes have no default export. GET goes to the `loader`; POST/PUT/PATCH/DELETE go to the `action`. When called from fetchers, return `data()`. A `data()` with a 4xx/5xx status "counts as a successful execution" for error handling. Per findings 1.2 and 1.5, it still **skips revalidation**. [resource-routes](https://reactrouter.com/how-to/resource-routes)
8. `useRouteLoaderData(routeId)` returns any matched route's loader data. In framework mode, IDs are the file path relative to `app/` without the extension, for example `"routes/layout.notifications"`. [useRouteLoaderData](https://reactrouter.com/api/hooks/useRouteLoaderData). The source reads `state.loaderData[routeId]` directly, so a parent can read a matched child's data ([`hooks.tsx` L1640](https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/hooks.tsx#L1640)).

### 5. `clientLoader` caching

The docs show a cache pattern:

1. The server `loader` runs on document load.
2. `clientLoader.hydrate = true` primes the cache.
3. Later navigations read from the cache.
4. `clientAction` invalidates the cache.

The `loader` and `clientLoader` must return the same data on first load to avoid hydration errors. [client-data](https://reactrouter.com/how-to/client-data)

It is a poor fit here. Each layout `clientLoader` that misses the cache triggers a separate request (finding 3.3). The cache is only invalidated by actions that go through that route's `clientAction`, so mark-read actions posted to a resource route would not invalidate it. A notification count is also exactly the data you want fresh on navigation.

## Options compared

| Option | Count fresh on nav | Fresh after mark-read | Heavy loader cost |
| --- | --- | --- | --- |
| A. Count in `layout.app` loader, no `shouldRevalidate` (default) | yes | yes | reruns on every nav and every submission (status quo) |
| B. A + `layout.app` opts out on plain navigations | **no** (stale until a submission or reload) | yes | low, but stale count, users list, and progress |
| C. Count in its own nested pathless route; `layout.app` skips only notification actions | yes (same single request) | yes | unchanged on nav; skipped on mark-read |
| D. Resource route + `useFetcher().load` in the layout | only if you re-`load` on every location change (extra request) | yes (fetchers revalidate after actions) | unchanged |

A is fine if the heavy loader is acceptable today. C is the targeted improvement. D adds a second HTTP request per navigation and an effect, for no benefit over C.

## Recommended pattern (option C)

```ts
// app/routes.ts: wrap the app children in a tiny pathless count route
layout("routes/layout.app.tsx", [
  layout("routes/layout.notifications.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    // ...all existing children unchanged...
  ]),
]),
route("api/notifications/read", "routes/api.notifications.read.ts"),
```

```tsx
// app/routes/layout.notifications.tsx: cheap loader; default revalidation (every nav + every action)
import { Outlet } from "react-router";
import type { Route } from "./+types/layout.notifications";
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  return { unreadCount: userId ? countUnread(userId) : 0 };
}
export default function NotificationsLayout() {
  return <Outlet />;
}
```

```ts
// app/routes/api.notifications.read.ts: resource route (no default export)
import { data } from "react-router";
export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) return data({ ok: false }, { status: 401 }); // 4xx: no revalidation
  const form = await request.formData();
  const id = form.get("notificationId"); // or intent=all
  markRead(userId, id ? Number(id) : "all");
  return data({ ok: true });
}
```

```ts
// app/routes/layout.app.tsx: keep the heavy loader from rerunning for notification writes
import type { ShouldRevalidateFunctionArgs } from "react-router";
export function shouldRevalidate({ formAction, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction?.startsWith("/api/notifications/")) return false;
  return defaultShouldRevalidate; // navigations and other actions keep today's behavior
}
```

```tsx
// Badge, e.g. inside Sidebar (rendered by layout.app)
import { useFetcher, useFetchers, useRouteLoaderData } from "react-router";
export function UnreadBadge() {
  const data = useRouteLoaderData("routes/layout.notifications") as { unreadCount: number } | undefined;
  const pendingReads = useFetchers().filter(
    (f) => f.formAction === "/api/notifications/read" && f.formData != null,
  ).length; // for "mark all", treat as count -> 0
  const count = Math.max(0, (data?.unreadCount ?? 0) - pendingReads);
  return count > 0 ? <span>{count}</span> : null;
}

// Mark-as-read button anywhere
function MarkRead({ id }: { id: number }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" action="/api/notifications/read">
      <button name="notificationId" value={id}>Mark read</button>
    </fetcher.Form>
  );
}
```

Why it works:

- The count route has no `shouldRevalidate`, so it reruns on every navigation (picking up new notifications) and after every successful action, all inside the one single-fetch request.
- `layout.app` opts out only for notification writes. The server then gets `_routes=` without it, and its heavy loader is skipped for those submissions.
- The optimistic subtraction disappears in the same commit that delivers the revalidated count.

If you later also want to stop `layout.app` rerunning on plain navigations, you must first move `/api/video-tracking` off plain `fetch()` (or accept stale sidebar progress). Its staleness currently depends on navigation revalidation.

## Pitfalls

1. **Assuming Data Mode rules.** In SSR framework mode, pathless layouts **do** rerun on every navigation. The "only when params change" rule applies to Data/SPA Mode only. The `defaultShouldRevalidate` arg is effectively "true unless the action failed", so compare URLs yourself if you need finer rules.
2. **Blanket `return false`.** It freezes the loader until a document reload, including the current user after a DevUI switch-user submit. Always fall back to `defaultShouldRevalidate`.
3. **Opt-outs are per route.** Opting out a child does not stop `root` or `layout.app` from rerunning. Opt out each route, or use call-site `defaultShouldRevalidate={false}`.
4. **Call-site `defaultShouldRevalidate={false}` on the mark-read form** would also stop the count route revalidating, unless it exports its own `shouldRevalidate`. Route-level targeting (above) is safer.
5. **Failed actions (4xx/5xx) skip revalidation.** The optimistic decrement vanishes when the fetcher settles, so the badge reverts to the server count, which is correct. Show the error from `fetcher.data`. A thrown error goes to the nearest ErrorBoundary.
6. **Plain `fetch()` never revalidates.** Use `useFetcher`/`<Form>` for mark-as-read.
7. **`fetcher.load` data does not refresh on navigation.** That makes option D the wrong place for "new notifications arrive on navigation".
8. **`clientLoader` on a route** breaks it out of the single request (an extra HTTP call), and the cache needs manual invalidation from every action that changes it.
9. **Optimistic counting must match the action's semantics.** Only subtract for notifications that are currently unread, de-duplicate per id, and treat "mark all" as 0. Otherwise double-clicks over-decrement. Clamp at 0.
10. **Version note.** Behavior and docs are the same for v7.18.5 and v8.x on all points above. The v8 docs add the explicit parent/sibling and call-site `defaultShouldRevalidate` guidance. This app is on 8.3.0; the live docs are 8.5.1.

## Sources

- https://reactrouter.com/start/framework/route-module#shouldrevalidate
- https://reactrouter.com/7.18.5/start/framework/route-module#shouldrevalidate
- https://reactrouter.com/how-to/optimize-revalidation
- https://reactrouter.com/how-to/fetchers
- https://reactrouter.com/api/hooks/useFetcher
- https://reactrouter.com/api/hooks/useFetchers
- https://reactrouter.com/api/hooks/useRouteLoaderData
- https://reactrouter.com/start/framework/pending-ui
- https://reactrouter.com/how-to/client-data
- https://reactrouter.com/how-to/resource-routes
- https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/router/router.ts
- https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/dom/ssr/single-fetch.tsx
- https://github.com/remix-run/react-router/blob/react-router@8.3.0/packages/react-router/lib/hooks.tsx

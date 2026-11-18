# Knock as the notification vendor

Cadence delivers Notifications through Knock, a hosted vendor. Knock was the only candidate that met every requirement on its free tier: 10K messages a month, mandatory signed (RS256) user tokens for the Notification Feed, vendor-stored preferences per category × channel, and a headless feed API we can build our own UI on.

Knock sits behind Cadence-owned interfaces, in Cadence's language. On the server, the Notifications port (`app/lib/notifications.server.ts`, shaped like the `MailTransport` mail port) has a Knock adapter, an in-memory fake for tests and a no-op adapter that logs when `KNOCK_SECRET_API_KEY` is missing. In the browser, the Notification Feed port (`app/lib/notification-feed.ts`) has a Knock adapter built on `@knocklabs/client`; the browser still talks to Knock directly with the public key and a signed user token. Only the adapters import Knock or know its workflow, category and channel keys (`app/lib/knock-keys.ts`); everything else uses Cadence's names. Swapping vendors means writing new adapters.

_Amended for spec #31: this replaces the original "one thin server module, but no vendor-abstraction layer". Domain services that fire Notifications take the port as a parameter so they can be tested against the fake, and the browser needed a feed interface of its own._

## Considered Options

- **MagicBell / SuprSend**: these support web push natively. We passed on them because web push is only an optional extra channel for Cadence (email is the default). MagicBell's free tier is 1K deliveries a month, and SuprSend's category preferences need a $250/mo plan.
- **Courier**: the runner-up. It has no pricing cliff ($0.005 per send) and scoped JWTs, but its preferences work by topic rather than category. Courier is the fallback if Knock's cost ever bites.
- **Novu Cloud**: its feed auth is a static HMAC with no expiry, and its preferences have no categories.

## Consequences

- Web push, if we ship it, goes through Firebase Cloud Messaging: a Firebase project, the FCM SDK and a service worker.
- Above 10K messages a month, Knock jumps to $250/mo. Every delivery on every channel counts as a message.

import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// ─── Server environment ───
// Vite only puts `VITE_` values on `process.env`, so server-only secrets in
// `.env` (e.g. the Knock keys) aren't there under `react-router dev`. This
// reads `.env` as a fallback, without writing it into `process.env`, and only
// when called, so importing this module has no side effects.

let dotenv: Record<string, string | undefined> | undefined;

function readDotenv() {
  if (dotenv === undefined) {
    dotenv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
  }
  return dotenv;
}

/** `process.env` over `.env`: a real environment variable always wins. */
export function readServerEnv(): Record<string, string | undefined> {
  return { ...readDotenv(), ...process.env };
}

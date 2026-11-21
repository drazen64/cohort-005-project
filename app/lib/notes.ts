// Client-safe Note rules, shared by the Lesson page's form and the service.

export const MAX_NOTE_LENGTH = 2000;

export const NOTE_TOO_LONG_MESSAGE = `A note can be at most ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters.`;

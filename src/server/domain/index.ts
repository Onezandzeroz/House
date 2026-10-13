/**
 * Domain barrel — re-exports every domain module. The rest of the app
 * imports from `@/server/domain` (or `@/server` for the full server
 * surface). Keep this file in alphabetical order for ease of scanning.
 */

export * from "./modes";
export * from "./intent";
export * from "./mandate";
export * from "./ethics";
export * from "./book";
export * from "./policy";
export * from "./decision-log";
export * from "./errors";

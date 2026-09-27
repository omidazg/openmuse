/**
 * Anonymous usage counts of «مسیرهای من» (POST /api/agent/events). The server keeps only daily
 * totals per event and item, never who sent them. Fire-and-forget: never throws, never waits,
 * never retries.
 */
import { useCallback } from "react";
import type { PathId } from "../../../packages/domain/src/paths";
import type { MuseApi } from "./api";
import { useWorkspace } from "./workspace";

/** Keep in sync with INSIGHT_EVENTS in apps/server/src/insights.ts. */
export type InsightEvent =
  | "path_selected"
  | "path_removed"
  | "starter_used"
  | "shortcut_used"
  | "deadline_action"
  | "invite_opened"
  | "invite_dismissed"
  | "persona_suggestion_used";

/** The id sent with invite_opened / invite_dismissed. */
export const INVITE_ID = "paths";

/** Counts one use; failures (offline, rate limit, old catalog) are ignored. */
export function track(api: MuseApi | undefined, event: InsightEvent, id: string): void {
  if (!api || !id) return;
  try {
    void api.request("/api/agent/events", { event, id }).catch(() => undefined);
  } catch {}
}

/** Counts paths that were switched on and off by one save. */
export function trackPathChange(
  api: MuseApi | undefined,
  before: readonly PathId[],
  after: readonly PathId[],
): void {
  for (const id of after) if (!before.includes(id)) track(api, "path_selected", id);
  for (const id of before) if (!after.includes(id)) track(api, "path_removed", id);
}

/** `track` bound to the signed-in workspace's API. */
export function useTrack() {
  const { api } = useWorkspace();
  return useCallback((event: InsightEvent, id: string) => track(api, event, id), [api]);
}

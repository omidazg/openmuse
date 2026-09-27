/**
 * «مسیرهای من»: the person's chosen work paths, follow-up answers and reminder settings.
 *
 * Stored per owner (kind "agent-settings", id "profile") and always passed through
 * sanitizeProfile, so unknown paths, questions and options never reach the prompt or the app.
 */
import { z } from "zod";
import {
  EMPTY_PROFILE,
  PATH_IDS,
  PATH_MAX,
  sanitizeProfile,
  type UserProfile,
} from "../../../packages/domain/src/paths.ts";
import type { Store } from "./db.ts";

const SETTINGS_KIND = "agent-settings";
const PROFILE_ID = "profile";
/** Loose bounds; sanitizeProfile keeps only known question and option ids. */
const DETAIL_KEYS_MAX = 30;
const DETAIL_ANSWERS_MAX = 10;
const DETAIL_ID_MAX = 64;

const detailId = z
  .string()
  .min(1, { error: "شناسهٔ پاسخ نباید خالی باشد." })
  .max(DETAIL_ID_MAX, { error: "شناسهٔ پاسخ بیش از حد طولانی است." });

export const profilePatchSchema = z
  .object({
    paths: z
      .array(z.enum(PATH_IDS, { error: "این مسیر شناخته‌شده نیست. فهرست مسیرها را تازه کنید." }))
      .max(PATH_MAX, { error: "حداکثر سه مسیر قابل انتخاب است." }),
    details: z
      .record(
        detailId,
        z.array(detailId).max(DETAIL_ANSWERS_MAX, { error: "تعداد پاسخ‌ها بیش از حد است." }),
      )
      .refine((value) => Object.keys(value).length <= DETAIL_KEYS_MAX, {
        error: "تعداد پرسش‌ها بیش از حد است.",
      }),
    reminders: z.boolean({ error: "یادآوری مهلت‌ها باید روشن یا خاموش باشد." }),
    inviteDismissed: z.boolean({ error: "وضعیت کارت دعوت نامعتبر است." }),
  })
  .partial()
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export async function readProfile(db: Store, owner: string): Promise<UserProfile> {
  const saved = await db.get<Partial<UserProfile>>(owner, SETTINGS_KIND, PROFILE_ID);
  return saved ? sanitizeProfile(saved) : sanitizeProfile(EMPTY_PROFILE);
}

/**
 * Merges the patch into the saved profile. Sending `paths` (even an empty list, «فعلاً رد شود»)
 * records the choice time so the invitation is not shown again.
 */
export async function saveProfile(
  db: Store,
  owner: string,
  patch: ProfilePatch,
): Promise<UserProfile> {
  const now = new Date().toISOString();
  const next = sanitizeProfile({
    ...(await readProfile(db, owner)),
    ...patch,
    ...(patch.paths ? { chosenAt: now } : {}),
    updatedAt: now,
  });
  await db.put(owner, SETTINGS_KIND, { id: PROFILE_ID, ...next });
  return next;
}

import { z } from "zod";
import { LIMITS } from "../config.ts";

const noticeSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/)
    .max(LIMITS.maxNoticeIdChars),
});

export const restrictiveNotices = new Set([
  "METADATA_RESTRICTED",
  "RETENTION_PROHIBITED",
  "DISPLAY_PROHIBITED",
  "METADATA_RETENTION_PROHIBITED",
  "METADATA_DISPLAY_PROHIBITED",
]);

export function noticeCodes(...lists: unknown[]): string[] {
  const codes = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const notice = noticeSchema.safeParse(item);
      if (notice.success) codes.add(notice.data.code);
    }
  }
  return [...codes];
}

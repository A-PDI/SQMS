import { z } from "zod";
import { RISK_LEVEL, SOURCING_PATHWAY } from "./enums";

const workflowKey = z.string().regex(/^[a-z0-9-]{3,80}$/);
const days = z.number().int().min(0).max(3650);

/** Administrator-editable system settings with their validation schemas. */
export const SETTING_SCHEMAS = {
  branding: z.strictObject({
    companyName: z.string().min(1).max(120),
    productName: z.string().min(1).max(160),
    shortName: z.string().min(1).max(20),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    logoFileId: z.uuid().nullable(),
  }),
  "files.maxUploadMb": z.number().int().min(1).max(2048),
  "workflow.preventSelfApproval": z.boolean(),
  "qualification.workflowMatrix": z.record(z.enum(SOURCING_PATHWAY), z.record(z.enum(RISK_LEVEL), workflowKey)),
  "scar.defaultResponseDays": z.number().int().min(1).max(365),
  "scar.escalationDays": z.array(days).min(1).max(5),
  "certifications.expiryAlertDays": z.array(days).min(1).max(5),
  "tasks.reminderLeadHours": z.number().int().min(1).max(720),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, key);
}

/** Validates a setting value. Returns the parsed value or a list of problems. */
export function validateSetting(key: SettingKey, value: unknown): { ok: true; value: unknown } | { ok: false; issues: string[] } {
  const result = SETTING_SCHEMAS[key].safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.map((i) => `${i.path.join(".") || key}: ${i.message}`) };
}

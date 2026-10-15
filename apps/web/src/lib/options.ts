import { humanize } from "@sqms/shared";
import type { Option } from "@/components/ui/input";

export const toOptions = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: humanize(v) }));
export const COUNTRY_FIELD = { pattern: { regex: /^[A-Za-z]{2}$/, message: "Use the two-letter ISO country code (e.g. US, DE, MX)" }, maxLength: 2, hint: "ISO 3166 two-letter code" };
export const countryName = (code: string | null | undefined) => {
  if (!code) return "-";
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

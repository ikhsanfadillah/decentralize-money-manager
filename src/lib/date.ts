import dayjs from "dayjs";
import "dayjs/locale/id";
import relativeTime from "dayjs/plugin/relativeTime";
import customParseFormat from "dayjs/plugin/customParseFormat";
import isToday from "dayjs/plugin/isToday";
import isYesterday from "dayjs/plugin/isYesterday";

// Configure dayjs globally with Indonesian locale and plugins
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.extend(isToday);
dayjs.extend(isYesterday);
dayjs.locale("id");

export { dayjs };

/**
 * Format timestamp / ISO date to relative time in Indonesian.
 * Examples: "Baru saja", "5 menit yang lalu", "3 jam yang lalu", "2 hari yang lalu"
 */
export function formatRelativeTime(
  dateInput: string | Date | null | undefined,
  fallback = "Baru saja"
): string {
  if (!dateInput) return fallback;

  const d = dayjs(dateInput);
  if (!d.isValid()) return String(dateInput);

  const diffSeconds = Math.abs(dayjs().diff(d, "second"));
  if (diffSeconds < 45) {
    return "Baru saja";
  }

  return d.fromNow();
}

/**
 * Format future expiry timestamp (e.g. P2P invite expiration).
 * Examples:
 * - "dalam 10 menit (14:10)"
 * - "Kedaluwarsa (5 menit yang lalu)"
 */
export function formatExpiryTime(
  dateInput: string | Date | null | undefined
): string {
  if (!dateInput) return "-";

  const d = dayjs(dateInput);
  if (!d.isValid()) return String(dateInput);

  const now = dayjs();
  if (d.isBefore(now)) {
    return `Kedaluwarsa (${d.fromNow()})`;
  }

  const remaining = d.toNow(true);
  const timeFormatted = d.format("HH:mm");
  return `dalam ${remaining} (${timeFormatted})`;
}

/**
 * Format transaction date (YYYY-MM-DD or ISO) into clean, human-readable Indonesian format.
 * Examples:
 * - Today: "Hari ini (30 Okt 2026)" or "Hari ini"
 * - Yesterday: "Kemarin (29 Okt 2026)" or "Kemarin"
 * - Other: "28 Okt 2026" or "Selasa, 28 Okt 2026"
 */
export function formatDateReadable(
  dateInput: string | Date | null | undefined,
  options: { withDayName?: boolean; relativePrefix?: boolean } = {}
): string {
  if (!dateInput) return "-";

  const d = dayjs(dateInput);
  if (!d.isValid()) return String(dateInput);

  const { withDayName = false, relativePrefix = true } = options;

  if (relativePrefix) {
    if (d.isToday()) {
      return `Hari ini, ${d.format("D MMM YYYY")}`;
    }
    if (d.isYesterday()) {
      return `Kemarin, ${d.format("D MMM YYYY")}`;
    }
  }

  if (withDayName) {
    return d.format("dddd, D MMMM YYYY");
  }

  return d.format("D MMM YYYY");
}

/**
 * Format full date and time.
 * Example: "30 Okt 2026, 14:15"
 */
export function formatDateTime(
  dateInput: string | Date | null | undefined
): string {
  if (!dateInput) return "-";

  const d = dayjs(dateInput);
  if (!d.isValid()) return String(dateInput);

  return d.format("D MMM YYYY, HH:mm");
}

/**
 * Format date in standard short form (e.g. "30 Okt 2026").
 */
export function formatDateShort(
  dateInput: string | Date | null | undefined
): string {
  if (!dateInput) return "-";

  const d = dayjs(dateInput);
  if (!d.isValid()) return String(dateInput);

  return d.format("D MMM YYYY");
}


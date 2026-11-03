import { describe, expect, it } from "vitest";
import {
  dayjs,
  formatDateReadable,
  formatDateShort,
  formatDateTime,
  formatExpiryTime,
  formatRelativeTime,
} from "../date";

describe("date utility functions", () => {
  it("formats relative time correctly in Indonesian", () => {
    const justNow = dayjs().toISOString();
    expect(formatRelativeTime(justNow)).toBe("Baru saja");

    const tenMinsAgo = dayjs().subtract(10, "minute").toISOString();
    expect(formatRelativeTime(tenMinsAgo)).toBe("10 menit yang lalu");

    const twoHoursAgo = dayjs().subtract(2, "hour").toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("2 jam yang lalu");

    expect(formatRelativeTime(null)).toBe("Baru saja");
    expect(formatRelativeTime(undefined, "Belum pernah")).toBe("Belum pernah");
  });

  it("formats expiry time correctly", () => {
    const future10Min = dayjs().add(10, "minute").toISOString();
    const expiryStr = formatExpiryTime(future10Min);
    expect(expiryStr).toContain("dalam");
    expect(expiryStr).toContain("10 menit");

    const past10Min = dayjs().subtract(10, "minute").toISOString();
    expect(formatExpiryTime(past10Min)).toContain("Kedaluwarsa");
  });

  it("formats readable dates with relative prefixes for today and yesterday", () => {
    const today = dayjs().format("YYYY-MM-DD");
    expect(formatDateReadable(today)).toContain("Hari ini");

    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    expect(formatDateReadable(yesterday)).toContain("Kemarin");

    const pastDate = "2025-05-15";
    expect(formatDateReadable(pastDate)).toBe("15 Mei 2025");
  });

  it("formats standard short date and date time", () => {
    const sample = "2026-10-30T14:30:00Z";
    expect(formatDateShort(sample)).toContain("2026");
    expect(formatDateTime(sample)).toContain(":");
  });
});


function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Return YYYY-MM-DD using the browser's local calendar, never UTC. */
export function getLocalCalendarDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Describe the same browser-local timezone used by formatLocalScheduledAt. */
export function getLocalTimezoneLabel(date = new Date()): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Waktu lokal perangkat";
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainderMinutes = absoluteOffset % 60;
  const offset = `UTC${offsetSign}${pad2(offsetHours)}:${pad2(offsetRemainderMinutes)}`;

  let shortName = "";
  try {
    shortName =
      new Intl.DateTimeFormat("id-ID", { timeZoneName: "short" })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value || "";
  } catch {
    // The IANA timezone and numeric offset remain sufficient.
  }

  return `${timezone}${shortName ? ` (${shortName}, ${offset})` : ` (${offset})`}`;
}

/**
 * Interpret date/time inputs as browser-local wall time and serialize the same
 * wall time with the browser's UTC offset for that specific instant.
 */
export function formatLocalScheduledAt(dateValue: string, timeValue: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue ?? "").trim());
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeValue ?? "").trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  const localDate = new Date(year, month - 1, day, hour, minute, second, 0);

  // Reject invalid or DST-skipped local wall times instead of silently rolling
  // them into another date/time.
  if (
    Number.isNaN(localDate.getTime()) ||
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day ||
    localDate.getHours() !== hour ||
    localDate.getMinutes() !== minute ||
    localDate.getSeconds() !== second
  ) {
    return null;
  }

  const offsetMinutes = -localDate.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainderMinutes = absoluteOffset % 60;

  return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${timeMatch[1]}:${timeMatch[2]}:${pad2(second)}` +
    `${offsetSign}${pad2(offsetHours)}:${pad2(offsetRemainderMinutes)}`;
}

/**
 * Format a stored offset-aware schedule without converting its original wall
 * time to another timezone. This keeps the confirmation/detail contract honest
 * even when the viewer's browser is currently in a different timezone.
 */
export function formatStoredScheduledAt(value?: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(
    String(value ?? "").trim(),
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, rawOffset] = match;
  const calendarDate = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(calendarDate.getTime())) return null;
  const dateLabel = calendarDate.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const timezoneLabel = rawOffset === "Z" ? "UTC+00:00" : `UTC${rawOffset}`;
  return `${dateLabel}, ${hour}.${minute} — ${timezoneLabel}`;
}

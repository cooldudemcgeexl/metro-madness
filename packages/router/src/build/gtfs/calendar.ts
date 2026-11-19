// Which services run on a given date, from calendar.txt (weekly patterns over a date range) and
// calendar_dates.txt (added or removed single dates).

import type { GtfsFeed } from "./feed.ts";

const WEEKDAY_COLUMNS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const SERVICE_ADDED = "1";

/** Service ids active on `date` (YYYYMMDD). */
export function activeServiceIds(feed: GtfsFeed, date: string): Set<string> {
  const weekday = WEEKDAY_COLUMNS[parseDate(date).getDay()];
  const active = new Set(
    feed.calendar
      .filter(
        (service) =>
          service.start_date <= date && service.end_date >= date && service[weekday] === "1",
      )
      .map((service) => service.service_id),
  );
  for (const exception of feed.calendarDates) {
    if (exception.date !== date) continue;
    if (exception.exception_type === SERVICE_ADDED) active.add(exception.service_id);
    else active.delete(exception.service_id);
  }
  return active;
}

/** First and last service dates covered by the feed's calendar, YYYYMMDD. */
export function servicePeriod(feed: GtfsFeed): { start: string; end: string } {
  const starts = feed.calendar.map((service) => service.start_date);
  const ends = feed.calendar.map((service) => service.end_date);
  const exceptionDates = feed.calendarDates.map((exception) => exception.date);
  const allStarts = (starts.length > 0 ? starts : exceptionDates).sort();
  const allEnds = (ends.length > 0 ? ends : exceptionDates).sort();
  return { start: allStarts[0], end: allEnds.at(-1)! };
}

function parseDate(date: string): Date {
  return new Date(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)));
}

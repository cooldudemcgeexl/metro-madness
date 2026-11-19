// A GTFS feed as raw tables. The library never touches the file system: callers supply a function
// that returns a file's text, so feeds can come from a directory, a zip archive or memory.

import { parseCsv, type CsvRecord } from "./csv.ts";

export interface GtfsFeed {
  stops: CsvRecord[];
  routes: CsvRecord[];
  trips: CsvRecord[];
  stopTimes: CsvRecord[];
  /** Optional in GTFS; empty when absent. */
  shapes: CsvRecord[];
  /** At least one of calendar and calendarDates must be present. */
  calendar: CsvRecord[];
  calendarDates: CsvRecord[];
}

/** Returns the text of a feed file such as "stops.txt", or undefined if the feed doesn't have it. */
export type ReadFeedFile = (fileName: string) => string | undefined;

export function readGtfsFeed(readFile: ReadFeedFile): GtfsFeed {
  const required = (fileName: string) => {
    const text = readFile(fileName);
    if (text === undefined) throw new Error(`GTFS feed is missing ${fileName}`);
    return parseCsv(text);
  };
  const optional = (fileName: string) => {
    const text = readFile(fileName);
    return text === undefined ? [] : parseCsv(text);
  };

  const feed: GtfsFeed = {
    stops: required("stops.txt"),
    routes: required("routes.txt"),
    trips: required("trips.txt"),
    stopTimes: required("stop_times.txt"),
    shapes: optional("shapes.txt"),
    calendar: optional("calendar.txt"),
    calendarDates: optional("calendar_dates.txt"),
  };
  if (feed.calendar.length === 0 && feed.calendarDates.length === 0) {
    throw new Error("GTFS feed has neither calendar.txt nor calendar_dates.txt");
  }
  return feed;
}

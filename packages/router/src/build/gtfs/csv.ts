// Minimal RFC 4180 CSV reader for GTFS files: quoted fields, doubled quotes ("") inside quotes,
// commas and newlines inside quotes, CRLF or LF line endings and a leading byte-order mark.
// Unquoted values are trimmed; blank lines are skipped.

export type CsvRecord = Record<string, string>;

const QUOTE = '"';
const COMMA = ",";
const NEWLINE = "\n";
const CARRIAGE_RETURN = "\r";
const BYTE_ORDER_MARK = "﻿";

/** Parse CSV text with a header row into one record per data row, keyed by column name. */
export function parseCsv(text: string): CsvRecord[] {
  const rows = parseRows(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);
  if (rows.length === 0) return [];
  const header = rows[0].map((name) => name.trim());
  return rows.slice(1).map((values) => {
    const record: CsvRecord = {};
    header.forEach((column, index) => (record[column] = values[index] ?? ""));
    return record;
  });
}

/** Split CSV text into rows of field values. */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldWasQuoted = false;
  let insideQuotes = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    const blank = row.length === 1 && row[0] === "";
    if (!blank) rows.push(row);
    row = [];
  };

  for (let position = 0; position < text.length; position++) {
    const character = text[position];
    if (insideQuotes) {
      if (character !== QUOTE) field += character;
      else if (text[position + 1] === QUOTE) {
        field += QUOTE;
        position++;
      } else insideQuotes = false;
    } else if (character === QUOTE) {
      insideQuotes = true;
      fieldWasQuoted = true;
    } else if (character === COMMA) endField();
    else if (character === NEWLINE) endRow();
    else if (character !== CARRIAGE_RETURN) field += character;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

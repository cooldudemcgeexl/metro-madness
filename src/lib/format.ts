// Time and text formatting. All times are minutes after midnight.

/** 5:07 AM */
export function fmt(m: number): string {
  if (!Number.isFinite(m)) return "—";
  m = Math.round(m);
  let h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}

/** 5:07a */
export function fmtS(m: number): string {
  m = Math.round(m);
  let h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const ap = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, "0")}${ap}`;
}

/** 2h 05m */
export function dur(m: number): string {
  if (!Number.isFinite(m)) return "—";
  m = Math.round(m);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bTc\b/g, "TC")
    .replace(/\bI-(\d+)/g, "I-$1")
    .replace(/\bMetrolink\b/g, "MetroLink")
    .replace(/\bUmsl\b/g, "UMSL")
    .replace(/\bJjk\b/g, "JJK")
    .replace(/(\d)(St|Nd|Rd|Th)\b/g, (_m, d: string, x: string) => d + x.toLowerCase());
}

/** "20261102" -> "11/02" */
export const mmdd = (yyyymmdd: string) => `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6)}`;

export function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

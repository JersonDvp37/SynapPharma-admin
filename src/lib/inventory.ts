export type Validity = { state: "expired" | "soon" | "current" | "unknown"; label: string; date: string; days: number | null };
export const EXPIRY_WARNING_DAYS = 60;
const TIME_ZONE = "Africa/Maputo";
const DAY_MS = 86400000;

function dayNumber(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value.getTime() / DAY_MS : null;
}

function currentDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return dayNumber(part("year"), part("month"), part("day"))!;
}

function expiryDay(value: unknown) {
  const text = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(text);
  if (iso) return dayNumber(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const local = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  return local ? dayNumber(Number(local[3]), Number(local[2]), Number(local[1])) : null;
}

export function validityOf(value: unknown, now = new Date()): Validity {
  const day = expiryDay(value);
  if (day === null) return { state: "unknown", label: "Validade não definida", date: "—", days: null };
  const date = new Intl.DateTimeFormat("pt-MZ", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(day * DAY_MS));
  const days = day - currentDay(now);
  if (days < 0) return { state: "expired", label: "Expirado", date, days };
  if (days === 0) return { state: "soon", label: "Validade hoje", date, days };
  if (days <= EXPIRY_WARNING_DAYS) return { state: "soon", label: "Expira em breve", date, days };
  return { state: "current", label: "Em dia", date, days };
}

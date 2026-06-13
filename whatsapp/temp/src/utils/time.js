export function isAfterCutoff(date, cutoffHour, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: timezone
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  return hour >= cutoffHour;
}

export function nowIso() {
  return new Date().toISOString();
}

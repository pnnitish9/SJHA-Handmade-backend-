// e.g. SJHA-240915-83217 (date + random 5 digits — human-readable and collision-safe enough for this scale)
export function generateOrderNumber() {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomPart = Math.floor(10000 + Math.random() * 90000);
  return `SJHA-${datePart}-${randomPart}`;
}

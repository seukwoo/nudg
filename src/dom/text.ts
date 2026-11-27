// A custom property shown as a number (count-ups: a score, a place, a total). An element bound to a target that
// carries data-nudg-text="<name>" gets `target.custom.<name>` as its text on every frame: rounded to a whole number,
// in the number format of the element's language (its closest lang attribute, else the browser's). The app renders
// the final number; while the player runs, the element's text is nudg's.

const formats = new Map<string, Intl.NumberFormat>();

/** The text for a value: a whole number in `lang`'s format ("1,234" in en and ko, "1.234" in de). */
export function numberText(value: number, lang?: string): string {
  const key = lang ?? "";
  let f = formats.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(lang || undefined, { maximumFractionDigits: 0 });
    } catch {
      f = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    }
    formats.set(key, f);
  }
  // -0 and a rounding to zero read as 0
  return f.format(Math.round(value) || 0);
}

/** Writes the custom property the element names in data-nudg-text, when it changed. */
export function drawText(el: Element, target: string, values: Record<string, unknown>): void {
  const name = (el as HTMLElement).dataset?.nudgText;
  if (!name) return;
  const v = values[`${target}.custom.${name}`];
  if (typeof v !== "number" || !Number.isFinite(v)) return;
  const text = numberText(v, (el.closest("[lang]") as HTMLElement | null)?.lang);
  if (el.textContent !== text) el.textContent = text;
}

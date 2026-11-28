/**
 * Masks text that looks like personal data before it may leave the device, and puts it back
 * locally in the answer. The cloud writes the track around tokens such as [[DATE_1]]; the
 * finished line, on this computer, says the real date again.
 *
 * Detected: dates, numbers of 7 or more digits (phones, accounts, IDs), e-mail addresses, and
 * capitalised names right after a label such as "Patient:" or "Name:". Not detected: names
 * without a label, addresses, and anything a pattern cannot see. That residual risk is stated
 * in the app.
 */
export type SensitiveKind = "NAME" | "DATE" | "NUMBER" | "EMAIL";

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const DATE = /\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2})\b/g;
// Seven or more digits, optionally split by spaces, dots, dashes or brackets; not part of a decimal.
const NUMBER = /(?<![\w.,])\+?\d(?:[ ().-]*\d){6,}(?![\w]|[.,]\d)/g;
const LABEL = /\b(?:patient|name|full name|nombre|paciente|client|cliente|customer|student|alumno|employee|empleado|account holder|titular)\b\s*:?\s*/gi;
const CAPITALISED = /^\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){0,2}/u;
const TOKEN = /\[\[(NAME|DATE|NUMBER|EMAIL)_(\d+)\]\]/g;

export class SensitiveMasker {
  private readonly values: string[] = [];
  private readonly kinds: SensitiveKind[] = [];

  /** How many distinct values were masked so far. */
  get count(): number {
    return this.values.length;
  }

  private token(kind: SensitiveKind, value: string): string {
    let i = this.values.indexOf(value);
    if (i < 0) {
      this.values.push(value);
      this.kinds.push(kind);
      i = this.values.length - 1;
    }
    return `[[${this.kinds[i]}_${i + 1}]]`;
  }

  mask(text: string | undefined): string {
    if (!text) return text ?? "";
    let out = text.replace(EMAIL, (m) => this.token("EMAIL", m));
    out = out.replace(DATE, (m) => this.token("DATE", m));
    out = out.replace(NUMBER, (m) => this.token("NUMBER", m));
    // Names after a label: keep the label, mask up to three capitalised words that follow it.
    let result = "";
    let last = 0;
    for (const m of out.matchAll(LABEL)) {
      const start = (m.index ?? 0) + m[0].length;
      const name = CAPITALISED.exec(out.slice(start));
      if (!name || name[0].startsWith("[[")) continue;
      result += out.slice(last, start) + this.token("NAME", name[0]);
      last = start + name[0].length;
    }
    return result + out.slice(last);
  }

  /** Puts the masked values back; a token the model did not keep simply stays out of the line. */
  restore(text: string): string {
    return text.replace(TOKEN, (whole, _kind: string, n: string) => this.values[Number(n) - 1] ?? whole);
  }
}

/** Added to a prompt whose text was masked, so the model keeps the tokens instead of guessing. */
export const MASK_NOTE =
  "Some personal data was replaced by tokens such as [[NAME_1]] or [[DATE_1]]. Copy each token exactly where it belongs and never guess what it hides.";

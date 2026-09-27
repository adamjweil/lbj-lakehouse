/** Format inches as architectural feet-inches, e.g. 150.5 -> 12'-6 1/2". */
export function formatFtIn(inches: number, precision = 0.5): string {
  const sign = inches < 0 ? '-' : '';
  let total = Math.round(Math.abs(inches) / precision) * precision;
  let ft = Math.floor(total / 12);
  let rem = total - ft * 12;
  if (rem >= 12 - 1e-9) {
    ft += 1;
    rem = 0;
  }
  const whole = Math.floor(rem + 1e-9);
  const frac = rem - whole;
  let fracStr = '';
  if (frac > 1e-6) {
    const denom = Math.round(1 / precision);
    let num = Math.round(frac * denom);
    let den = denom;
    while (num % 2 === 0 && den % 2 === 0) {
      num /= 2;
      den /= 2;
    }
    fracStr = ` ${num}/${den}`;
  }
  return `${sign}${ft}'-${whole}${fracStr}"`;
}

/** Inches only, e.g. 30 -> 30", 24.5 -> 24 1/2". */
export function formatIn(inches: number): string {
  const whole = Math.floor(inches + 1e-9);
  const frac = inches - whole;
  if (frac < 1e-6) return `${whole}"`;
  const num = Math.round(frac * 8);
  const g = gcd(num, 8);
  return `${whole} ${num / g}/${8 / g}"`;
}

/** Inches as a lumber-yard fraction to the nearest 1/16", e.g. 0.4375 -> 7/16", 92.625 -> 92-5/8". */
export function formatFrac(inches: number, denom = 16): string {
  const total = Math.round(Math.abs(inches) * denom);
  const whole = Math.floor(total / denom);
  let num = total - whole * denom;
  let den = denom;
  while (num && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const sign = inches < 0 && total ? '-' : '';
  if (!num) return `${sign}${whole}"`;
  return whole ? `${sign}${whole}-${num}/${den}"` : `${sign}${num}/${den}"`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Size callout used on schedules: 3068 style is too cryptic, so 3'-0" x 6'-8". */
export function formatSize(w: number, h: number): string {
  return `${formatFtIn(w)} x ${formatFtIn(h)}`;
}

const numRe = String.raw`(\d+(?:\.\d+)?)`;
const fracRe = String.raw`(?:(\d+)\s*\/\s*(\d+))`;

function parseInchPart(s: string): number | null {
  s = s.trim().replace(/"$/, '').replace(/in$/i, '').trim();
  if (s === '') return 0;
  let m = s.match(new RegExp(`^${numRe}\\s+${fracRe}$`));
  if (m) return parseFloat(m[1]) + parseInt(m[2]) / parseInt(m[3]);
  m = s.match(new RegExp(`^${fracRe}$`));
  if (m) return parseInt(m[1]) / parseInt(m[2]);
  m = s.match(new RegExp(`^${numRe}$`));
  if (m) return parseFloat(m[1]);
  return null;
}

/**
 * Parse a length typed by a person into inches.
 * Accepts: 150, 150", 12', 12.5', 12'6", 12'-6", 12' 6 1/2", 6 1/2", 12ft 6in.
 */
export function parseLength(input: string): number | null {
  let s = input.trim().toLowerCase().replace(/ft/g, "'").replace(/′/g, "'").replace(/″/g, '"');
  if (s === '') return null;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1).trim();
  }
  let result: number | null;
  const q = s.indexOf("'");
  if (q >= 0) {
    const ft = parseFloat(s.slice(0, q));
    if (Number.isNaN(ft)) return null;
    const rest = s.slice(q + 1).trim().replace(/^-/, '').trim();
    const inch = parseInchPart(rest);
    if (inch === null) return null;
    result = ft * 12 + inch;
  } else {
    result = parseInchPart(s);
  }
  if (result === null || !Number.isFinite(result)) return null;
  return neg ? -result : result;
}

export const sqft = (sqIn: number) => sqIn / 144;

export function formatSqft(sqIn: number): string {
  return `${Math.round(sqft(sqIn)).toLocaleString('en-US')} SF`;
}

export function formatPitch(pitch: number): string {
  return `${+pitch.toFixed(2)}:12`;
}

/** Lower-cases a leading capitalized word so a spec phrase can continue a sentence; abbreviations (LVL, R-38) are kept. */
export function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

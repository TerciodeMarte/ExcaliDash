// Fractional z-order keys for Excalidraw's `index` field.
//
// Port of rocicorp/fractional-indexing 3.2.0 (CC0), the library Excalidraw
// uses; the package is ESM-only, so it cannot be required from this CommonJS
// backend. Keep in sync with it: Excalidraw re-keys (and version-bumps) any
// element whose index it considers invalid.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
const SMALLEST_INTEGER = "A" + ZERO.repeat(26);

const midpoint = (a: string, b: string | null): string => {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) {
    throw new Error("trailing zero");
  }
  if (b) {
    let n = 0;
    while ((a[n] || ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))];
  }
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
};

const getIntegerLength = (head: string): number => {
  if (head >= "a" && head <= "z") {
    return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  }
  if (head >= "A" && head <= "Z") {
    return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  }
  throw new Error(`invalid order key head: ${head}`);
};

const validateInteger = (int: string) => {
  if (int.length !== getIntegerLength(int[0])) {
    throw new Error(`invalid integer part of order key: ${int}`);
  }
};

const getIntegerPart = (key: string): string => {
  const integerPartLength = getIntegerLength(key[0]);
  if (integerPartLength > key.length) {
    throw new Error(`invalid order key: ${key}`);
  }
  return key.slice(0, integerPartLength);
};

const validateOrderKey = (key: string) => {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const i = getIntegerPart(key);
  if (key.slice(i.length).slice(-1) === ZERO) {
    throw new Error(`invalid order key: ${key}`);
  }
};

const incrementInteger = (x: string): string | null => {
  validateInteger(x);
  const [head, ...digs] = x.split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) {
      digs[i] = ZERO;
    } else {
      digs[i] = DIGITS[d];
      carry = false;
    }
  }
  if (!carry) return head + digs.join("");
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > "a") digs.push(ZERO);
  else digs.pop();
  return h + digs.join("");
};

const decrementInteger = (x: string): string | null => {
  validateInteger(x);
  const [head, ...digs] = x.split("");
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) {
      digs[i] = DIGITS.slice(-1);
    } else {
      digs[i] = DIGITS[d];
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join("");
  if (head === "a") return "Z" + DIGITS.slice(-1);
  if (head === "A") return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < "Z") digs.push(DIGITS.slice(-1));
  else digs.pop();
  return h + digs.join("");
};

export const generateKeyBetween = (
  a: string | null,
  b: string | null,
): string => {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a === null) {
    if (b === null) return "a" + ZERO;
    const ib = getIntegerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error("cannot decrement any more");
    return res;
  }
  if (b === null) {
    const ia = getIntegerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ia = getIntegerPart(a);
  const fa = a.slice(ia.length);
  const ib = getIntegerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error("cannot increment any more");
  if (i < b) return i;
  return ia + midpoint(fa, null);
};

export const generateNKeysBetween = (
  a: string | null,
  b: string | null,
  n: number,
): string[] => {
  if (n === 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(c, b);
      result.push(c);
    }
    return result;
  }
  if (a === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(a, c);
      result.push(c);
    }
    result.reverse();
    return result;
  }
  const mid = Math.floor(n / 2);
  const c = generateKeyBetween(a, b);
  return [
    ...generateNKeysBetween(a, c, mid),
    c,
    ...generateNKeysBetween(c, b, n - mid - 1),
  ];
};

const isValidKey = (key: unknown): key is string => {
  if (typeof key !== "string" || key.length === 0) return false;
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
};

/**
 * Gives every element without a usable index one that keeps the array's
 * z-order strictly increasing, leaving already-ordered indices untouched.
 * Without this Excalidraw assigns the indices itself and bumps the element's
 * version, which ties with (and can silently beat) the next MCP edit.
 */
export const syncFractionalIndices = (
  elements: Array<Record<string, unknown>>,
): void => {
  const kept: boolean[] = [];
  let last: string | null = null;
  for (const el of elements) {
    const ok = isValidKey(el.index) && (last === null || el.index > last);
    kept.push(ok);
    if (ok) last = el.index as string;
  }
  let lower: string | null = null;
  for (let i = 0; i < elements.length;) {
    if (kept[i]) {
      lower = elements[i].index as string;
      i++;
      continue;
    }
    let end = i;
    while (end < elements.length && !kept[end]) end++;
    const upper =
      end < elements.length ? (elements[end].index as string) : null;
    const keys = generateNKeysBetween(lower, upper, end - i);
    for (let k = i; k < end; k++) elements[k].index = keys[k - i];
    lower = keys[keys.length - 1];
    i = end;
  }
};

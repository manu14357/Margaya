// Fractional order keys.
//
// A key is an "integer part" followed by an optional "fraction part", written
// with the 62 symbols 0-9, A-Z, a-z (which are in ascending ASCII order, so a
// plain string comparison sorts keys). The first symbol of the integer part is
// a letter that fixes how many digits follow it: `a` is one digit, `b` two, and
// so on up to `z`; `Z` is one digit, `Y` two, down to `A`. Every `A`..`Z`
// integer sorts below every `a`..`z` one, which lets keys grow downwards as well
// as upwards. Appending at either end only increments or decrements the integer
// part, so keys stay short however many elements are added at the top; only
// inserts between two neighbours grow the fraction.
//
// The fraction never ends in "0": a trailing zero would make two different
// strings mean the same position and leave no room below the shorter one.

import { type ElementOptions, updateElement } from "./create.js";
import type { BoardElement } from "./elements.js";

const SYMBOLS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RADIX = SYMBOLS.length;
const ZERO = SYMBOLS[0];
const TOP = SYMBOLS[RADIX - 1];
/** Upper bound for stored keys; real keys stay far shorter. */
export const MAX_ORDER_LENGTH = 256;

const symbolValue = (symbol: string | undefined): number =>
  symbol === undefined ? -1 : SYMBOLS.indexOf(symbol);

/** Length of the integer part (head letter included) for a head letter. */
function integerLength(head: string | undefined): number | null {
  if (head === undefined || head.length !== 1) return null;
  const code = head.charCodeAt(0);
  if (code >= 97 && code <= 122) return code - 97 + 2;
  if (code >= 65 && code <= 90) return 90 - code + 2;
  return null;
}

/** True when `key` is a well-formed order key. */
export function isValidOrder(key: unknown): key is string {
  if (typeof key !== "string" || key.length < 2) return false;
  if (key.length > MAX_ORDER_LENGTH) return false;
  const intLength = integerLength(key[0]);
  if (intLength === null || key.length < intLength) return false;
  for (const symbol of key) {
    if (symbolValue(symbol) < 0) return false;
  }
  return !key.endsWith(ZERO) || key.length === intLength;
}

function splitKey(key: string): [integer: string, fraction: string] {
  const intLength = integerLength(key[0]) ?? 2;
  return [key.slice(0, intLength), key.slice(intLength)];
}

function stepInteger(integer: string, step: 1 | -1): string | null {
  const head = integer[0];
  const digits = integer.slice(1).split("");
  const wrapTo = step === 1 ? ZERO : TOP;
  for (let i = digits.length - 1; i >= 0; i--) {
    const next = symbolValue(digits[i]) + step;
    if (next >= 0 && next < RADIX) {
      digits[i] = SYMBOLS[next];
      return head + digits.join("");
    }
    digits[i] = wrapTo;
  }
  // Every digit wrapped: move to the neighbouring head letter.
  const width = digits.length;
  if (step === 1) {
    if (head === "z") return null;
    if (head === "Z") return `a${ZERO}`;
    const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
    return nextHead + ZERO.repeat(head < "Z" ? width - 1 : width + 1);
  }
  if (head === "A") return null;
  if (head === "a") return `Z${TOP}`;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  return previousHead + TOP.repeat(head > "Z" ? width - 1 : width + 1);
}

/**
 * A fraction strictly between `low` and `high` (`null` = 1). Both inputs are
 * fractions without trailing zeros and `low < high`.
 */
function fractionBetween(low: string, high: string | null): string {
  if (high !== null) {
    let shared = 0;
    while ((low[shared] ?? ZERO) === high[shared]) shared++;
    if (shared > 0) {
      return (
        high.slice(0, shared) +
        fractionBetween(low.slice(shared), high.slice(shared))
      );
    }
  }
  const lowDigit = low.length > 0 ? symbolValue(low[0]) : 0;
  const highDigit = high === null ? RADIX : symbolValue(high[0]);
  if (highDigit - lowDigit > 1) {
    return SYMBOLS[Math.floor((lowDigit + highDigit) / 2)];
  }
  // Neighbouring digits: either the high digit alone is already below `high`,
  // or keep the low digit and look further right.
  if (high !== null && high.length > 1) return high[0];
  return SYMBOLS[lowDigit] + fractionBetween(low.slice(1), null);
}

/**
 * A key that sorts strictly between `before` and `after`. Pass `null` for an
 * open end. Throws when a key is malformed or `before >= after`.
 */
export function orderBetween(
  before: string | null,
  after: string | null,
): string {
  if (before !== null && !isValidOrder(before)) {
    throw new RangeError(`Invalid order key: ${before}`);
  }
  if (after !== null && !isValidOrder(after)) {
    throw new RangeError(`Invalid order key: ${after}`);
  }
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`Order keys out of sequence: ${before} >= ${after}`);
  }
  if (before === null && after === null) return `a${ZERO}`;
  if (before === null) {
    const [integer, fraction] = splitKey(after as string);
    if (fraction.length > 0) return integer;
    const lower = stepInteger(integer, -1);
    if (lower === null) throw new RangeError("Order keys exhausted");
    return lower;
  }
  const [integer, fraction] = splitKey(before);
  if (after === null) {
    return stepInteger(integer, 1) ?? integer + fractionBetween(fraction, null);
  }
  const [afterInteger, afterFraction] = splitKey(after);
  if (integer === afterInteger) {
    return integer + fractionBetween(fraction, afterFraction);
  }
  const next = stepInteger(integer, 1);
  if (next !== null && next < after) return next;
  return integer + fractionBetween(fraction, null);
}

/** `count` ascending keys strictly between `before` and `after`. */
export function ordersBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (count <= 0) return [];
  if (count === 1) return [orderBetween(before, after)];
  if (after === null) {
    const keys: string[] = [];
    let previous = before;
    for (let i = 0; i < count; i++) {
      previous = orderBetween(previous, null);
      keys.push(previous);
    }
    return keys;
  }
  if (before === null) {
    const keys: string[] = [];
    let next: string | null = after;
    for (let i = 0; i < count; i++) {
      next = orderBetween(null, next);
      keys.push(next);
    }
    return keys.reverse();
  }
  // Split the gap in halves so keys stay short.
  const half = Math.floor(count / 2);
  const middle = orderBetween(before, after);
  return [
    ...ordersBetween(before, middle, half),
    middle,
    ...ordersBetween(middle, after, count - half - 1),
  ];
}

export function compareOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type Ordered = { order: string; id: string };

function compareElements(a: Ordered, b: Ordered): number {
  return compareOrder(a.order, b.order) || compareOrder(a.id, b.id);
}

/** A sorted copy, bottom first. Equal keys fall back to the id. */
export function sortByOrder<T extends Ordered>(elements: readonly T[]): T[] {
  return [...elements].sort(compareElements);
}

/** The highest order key in the list, or null when it is empty. */
export function topOrder(elements: readonly Ordered[]): string | null {
  let top: string | null = null;
  for (const element of elements) {
    if (top === null || element.order > top) top = element.order;
  }
  return top;
}

/**
 * Fixes duplicate and malformed keys (two clients inserting at the same spot
 * produce identical keys) while keeping today's visual order. Returns only
 * the elements that needed a new key, with their version bumped.
 */
export function repairOrders(
  elements: readonly BoardElement[],
  options?: ElementOptions,
): BoardElement[] {
  const sorted = sortByOrder(elements);
  const changed: BoardElement[] = [];
  let previous: string | null = null;
  const fits = (key: string) =>
    isValidOrder(key) && (previous === null || key > previous);
  let index = 0;
  while (index < sorted.length) {
    if (fits(sorted[index].order)) {
      previous = sorted[index].order;
      index++;
      continue;
    }
    let end = index;
    while (end < sorted.length && !fits(sorted[end].order)) end++;
    const upper = end < sorted.length ? sorted[end].order : null;
    const keys = ordersBetween(previous, upper, end - index);
    for (let k = 0; k < keys.length; k++) {
      changed.push(
        updateElement(sorted[index + k], { order: keys[k] }, options),
      );
    }
    previous = keys[keys.length - 1];
    index = end;
  }
  return changed;
}

type Arrange = (
  stack: BoardElement[],
  selected: (element: BoardElement) => boolean,
) => BoardElement[];

function arrange(
  all: readonly BoardElement[],
  ids: Iterable<string>,
  move: Arrange,
  options?: ElementOptions,
): BoardElement[] {
  const wanted = new Set(ids);
  const stack = sortByOrder(all.filter((element) => !element.deleted));
  const selected = (element: BoardElement) => wanted.has(element.id);
  if (!stack.some(selected)) return [];
  const next = move(stack, selected);

  // Unselected elements keep their keys, so those keys must already be valid
  // and strictly ascending; otherwise give the whole stack fresh keys.
  let lastFixed: string | null = null;
  for (const element of next) {
    if (selected(element)) continue;
    if (
      !isValidOrder(element.order) ||
      (lastFixed !== null && element.order <= lastFixed)
    ) {
      return rekeyAll(next, options);
    }
    lastFixed = element.order;
  }

  const changed: BoardElement[] = [];
  let index = 0;
  while (index < next.length) {
    if (!selected(next[index])) {
      index++;
      continue;
    }
    let end = index;
    while (end < next.length && selected(next[end])) end++;
    const lower = lastFixedKey(next, index, selected);
    const upper = nextFixedKey(next, end, selected);
    const run = next.slice(index, end);
    const alreadyFits = run.every(
      (element, i) =>
        isValidOrder(element.order) &&
        (i === 0
          ? lower === null || element.order > lower
          : element.order > run[i - 1].order) &&
        (upper === null || element.order < upper),
    );
    if (!alreadyFits) {
      const keys = ordersBetween(lower, upper, run.length);
      run.forEach((element, i) => {
        changed.push(updateElement(element, { order: keys[i] }, options));
      });
    }
    index = end;
  }
  return changed;
}

function lastFixedKey(
  stack: BoardElement[],
  before: number,
  selected: (element: BoardElement) => boolean,
): string | null {
  for (let i = before - 1; i >= 0; i--) {
    if (!selected(stack[i])) return stack[i].order;
  }
  return null;
}

function nextFixedKey(
  stack: BoardElement[],
  from: number,
  selected: (element: BoardElement) => boolean,
): string | null {
  for (let i = from; i < stack.length; i++) {
    if (!selected(stack[i])) return stack[i].order;
  }
  return null;
}

function rekeyAll(
  stack: BoardElement[],
  options?: ElementOptions,
): BoardElement[] {
  const keys = ordersBetween(null, null, stack.length);
  const changed: BoardElement[] = [];
  stack.forEach((element, i) => {
    if (element.order !== keys[i]) {
      changed.push(updateElement(element, { order: keys[i] }, options));
    }
  });
  return changed;
}

/** Moves each selected block one step up, past the next unselected element. */
export function bringForward(
  all: readonly BoardElement[],
  ids: Iterable<string>,
  options?: ElementOptions,
): BoardElement[] {
  return arrange(
    all,
    ids,
    (stack, selected) => {
      const next = [...stack];
      let i = next.length - 2;
      while (i >= 0) {
        if (selected(next[i]) && !selected(next[i + 1])) {
          let start = i;
          while (start > 0 && selected(next[start - 1])) start--;
          const [passed] = next.splice(i + 1, 1);
          next.splice(start, 0, passed);
          i = start - 1;
        } else {
          i--;
        }
      }
      return next;
    },
    options,
  );
}

/** Moves each selected block one step down, past the next unselected element. */
export function sendBackward(
  all: readonly BoardElement[],
  ids: Iterable<string>,
  options?: ElementOptions,
): BoardElement[] {
  return arrange(
    all,
    ids,
    (stack, selected) => {
      const next = [...stack];
      let i = 1;
      while (i < next.length) {
        if (selected(next[i]) && !selected(next[i - 1])) {
          let end = i;
          while (end < next.length - 1 && selected(next[end + 1])) end++;
          const [passed] = next.splice(i - 1, 1);
          next.splice(end, 0, passed);
          i = end + 1;
        } else {
          i++;
        }
      }
      return next;
    },
    options,
  );
}

export function bringToFront(
  all: readonly BoardElement[],
  ids: Iterable<string>,
  options?: ElementOptions,
): BoardElement[] {
  return arrange(
    all,
    ids,
    (stack, selected) => [
      ...stack.filter((element) => !selected(element)),
      ...stack.filter(selected),
    ],
    options,
  );
}

export function sendToBack(
  all: readonly BoardElement[],
  ids: Iterable<string>,
  options?: ElementOptions,
): BoardElement[] {
  return arrange(
    all,
    ids,
    (stack, selected) => [
      ...stack.filter(selected),
      ...stack.filter((element) => !selected(element)),
    ],
    options,
  );
}

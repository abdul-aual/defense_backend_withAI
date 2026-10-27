/**
 * Rentwise chatbot — intent routing and conversation-slot handling.
 *
 * Everything in this file is PURE (no database, no network, no clock).
 * `planTurn()` looks at the LATEST user message, decides its intent, merges
 * only the relevant earlier details (city, dates, passengers...) from the
 * conversation state, and returns an action for ragService.ts to execute.
 *
 * The conversation state is owned by the browser (React memory) and sent with
 * each request. The server keeps nothing, so a page reload starts fresh.
 */

import { answerFaq, isEnglishMessage, NON_ENGLISH_MESSAGE } from "./chatFaq.js";

/* =========================================================
   TYPES
   ========================================================= */

export const CITIES = ["Dhaka", "Rangpur", "Chattogram"] as const;
export type City = (typeof CITIES)[number];

export const VEHICLE_TYPES = ["car", "SUV", "HiAce"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export type AcType = "AC" | "Non-AC";
export type PriceDirection = "ASC" | "DESC";
export type PriceMode = "extreme" | "budget" | "list";

export type IntentName =
  | "empty"
  | "non_english"
  | "greeting"
  | "thanks"
  | "goodbye"
  | "restart"
  | "project_info"
  | "faq"
  | "booking_info"
  | "price_comparison"
  | "rental_request"
  | "availability_search"
  | "select_vehicle"
  | "slot_followup"
  | "knowledge";

export interface TripSlots {
  city?: City | undefined;
  vehicleType?: VehicleType | undefined;
  acType?: AcType | undefined;
  passengers?: number | undefined;
  budget?: number | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  durationDays?: number | undefined;
  focusVehicleId?: number | undefined;
}

export type Awaiting = "cityAndDates" | "city" | "dates" | "returnDate";
export type Phase = "collecting" | "results";

export interface PriceQuery {
  direction: PriceDirection;
  mode: PriceMode;
}

export interface ConversationState {
  slots: TripSlots;
  awaiting?: Awaiting | undefined;
  phase?: Phase | undefined;
  lastIntent?: IntentName | undefined;
  priceQuery?: PriceQuery | undefined;
  lastResultIds?: number[] | undefined;
}

export interface VehicleFilters {
  city?: City | undefined;
  vehicleType?: VehicleType | undefined;
  acType?: AcType | undefined;
  minSeats?: number | undefined;
  maxPrice?: number | undefined;
  ids?: number[] | undefined;
}

export interface DateRange {
  start: string;
  end: string;
}

export type Action =
  | { type: "say"; text: string }
  | {
      type: "price";
      direction: PriceDirection;
      mode: PriceMode;
      filters: VehicleFilters;
      dates?: DateRange | undefined;
    }
  | {
      type: "search";
      filters: VehicleFilters;
      dates: DateRange;
      passengers?: number | undefined;
    }
  | {
      type: "select";
      vehicleId: number;
      dates?: DateRange | undefined;
      city?: City | undefined;
      passengers?: number | undefined;
    }
  | { type: "knowledge" };

export interface TurnPlan {
  intent: IntentName;
  state: ConversationState;
  action: Action;
}

export const emptyState = (): ConversationState => ({ slots: {} });

/* =========================================================
   STATE SANITISING (the browser is not trusted)
   ========================================================= */

const INTENTS: readonly IntentName[] = [
  "empty", "non_english", "greeting", "thanks", "goodbye", "restart",
  "project_info", "faq", "booking_info", "price_comparison",
  "rental_request", "availability_search", "select_vehicle",
  "slot_followup", "knowledge",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isValidYmd = (value: unknown): value is string =>
  typeof value === "string" && makeDate(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)),
    Number(value.slice(8, 10)),
  ) === value;

function cleanInt(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

export function sanitizeState(raw: unknown): ConversationState {
  if (!isRecord(raw)) return emptyState();

  const rawSlots = isRecord(raw.slots) ? raw.slots : {};
  const slots: TripSlots = {};

  const city = CITIES.find((item) => item === rawSlots.city);
  if (city) slots.city = city;

  const vehicleType = VEHICLE_TYPES.find((item) => item === rawSlots.vehicleType);
  if (vehicleType) slots.vehicleType = vehicleType;

  if (rawSlots.acType === "AC" || rawSlots.acType === "Non-AC") {
    slots.acType = rawSlots.acType;
  }

  const passengers = cleanInt(rawSlots.passengers, 1, 100);
  if (passengers !== undefined) slots.passengers = passengers;

  const budget = cleanInt(rawSlots.budget, 1, 10_000_000);
  if (budget !== undefined) slots.budget = budget;

  if (isValidYmd(rawSlots.startDate)) slots.startDate = rawSlots.startDate;
  if (isValidYmd(rawSlots.endDate)) slots.endDate = rawSlots.endDate;

  const durationDays = cleanInt(rawSlots.durationDays, 1, 365);
  if (durationDays !== undefined) slots.durationDays = durationDays;

  const focusVehicleId = cleanInt(rawSlots.focusVehicleId, 1, 2_147_483_647);
  if (focusVehicleId !== undefined) slots.focusVehicleId = focusVehicleId;

  const state: ConversationState = { slots };

  const awaiting = (["cityAndDates", "city", "dates", "returnDate"] as const)
    .find((item) => item === raw.awaiting);
  if (awaiting) state.awaiting = awaiting;

  if (raw.phase === "collecting" || raw.phase === "results") {
    state.phase = raw.phase;
  }

  const lastIntent = INTENTS.find((item) => item === raw.lastIntent);
  if (lastIntent) state.lastIntent = lastIntent;

  if (isRecord(raw.priceQuery)) {
    const { direction, mode } = raw.priceQuery;
    if (
      (direction === "ASC" || direction === "DESC") &&
      (mode === "extreme" || mode === "budget" || mode === "list")
    ) {
      state.priceQuery = { direction, mode };
    }
  }

  if (Array.isArray(raw.lastResultIds)) {
    const ids = raw.lastResultIds
      .map((id) => cleanInt(id, 1, 2_147_483_647))
      .filter((id): id is number => id !== undefined)
      .slice(0, 12);
    if (ids.length > 0) state.lastResultIds = ids;
  }

  return state;
}

/* =========================================================
   DATE HELPERS
   ========================================================= */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTH_RE =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function monthNumber(name: string): number {
  const index = MONTH_SHORT.findIndex(
    (short) => short.toLowerCase() === name.slice(0, 3).toLowerCase(),
  );
  return index + 1;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Returns YYYY-MM-DD, or null when the calendar date does not exist. */
export function makeDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function toUtc(date: string): Date {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
}

export function addDays(date: string, days: number): string {
  const result = toUtc(date);
  result.setUTCDate(result.getUTCDate() + days);
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Inclusive rental days, matching the booking controller. */
export const rentalDays = (start: string, end: string): number => diffDays(start, end) + 1;

export function formatHuman(date: string): string {
  const day = toUtc(date);
  const weekday = (WEEKDAYS[day.getUTCDay()] ?? "").slice(0, 3);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${day.getUTCDate()} ${MONTH_SHORT[day.getUTCMonth()] ?? ""} ${day.getUTCFullYear()}`;
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatHuman(start) : `${formatHuman(start)} to ${formatHuman(end)}`;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30,
};
const NUMBER_WORDS = Object.keys(WORD_NUMBERS).join("|");

function toNumber(token: string): number | undefined {
  const value = token.toLowerCase();
  if (/^\d+$/.test(value)) return Number(value);
  return WORD_NUMBERS[value];
}

/** Next occurrence of a weekday strictly after today (1 to 7 days ahead). */
function nextWeekday(today: string, weekday: number): string {
  const todayIndex = toUtc(today).getUTCDay();
  let ahead = (weekday - todayIndex + 7) % 7;
  if (ahead === 0) ahead = 7;
  return addDays(today, ahead);
}

/** A month/day without a year means the next time that date occurs. */
function resolveMonthDay(month: number, day: number, year: number | undefined, today: string): string | null {
  if (year !== undefined) return makeDate(year, month, day);
  const thisYear = Number(today.slice(0, 4));
  const candidate = makeDate(thisYear, month, day);
  if (candidate && candidate >= today) return candidate;
  return makeDate(thisYear + 1, month, day);
}

export interface ParsedDates {
  dates: string[];
  durationDays?: number | undefined;
  issue?: string | undefined;
}

/**
 * Finds dates in ONE message. Supports ISO dates, "November 2", "2 Nov",
 * "Nov 2-5", "2 to 5 November", today/tomorrow/day after tomorrow,
 * weekdays, "in 3 days", "for three days" and "the next two days".
 * Ambiguous or invalid input produces an `issue` instead of a guess.
 */
export function parseDates(input: string, today: string): ParsedDates {
  let work = input.toLowerCase();
  const found: { index: number; date: string }[] = [];
  let durationDays: number | undefined;
  let nextDays: number | undefined;
  let issue: string | undefined;

  const collect = (pattern: RegExp, handle: (match: RegExpMatchArray) => boolean | void): void => {
    const matches = [...work.matchAll(pattern)];
    for (const match of matches) {
      if (handle(match) === false) continue;
      const start = match.index ?? 0;
      work = work.slice(0, start) + " ".repeat(match[0].length) + work.slice(start + match[0].length);
    }
  };

  const push = (match: RegExpMatchArray, date: string | null, label: string): boolean => {
    if (!date) {
      issue ??= `“${label.trim()}” isn't a valid calendar date. Please check it and send it again.`;
      return true;
    }
    found.push({ index: match.index ?? 0, date });
    return true;
  };

  // "and the next two days" / "next 3 days"
  collect(new RegExp(`\\b(?:and\\s+)?(?:the\\s+)?next\\s+(\\d{1,3}|${NUMBER_WORDS})\\s+days?\\b`, "g"), (match) => {
    const count = toNumber(match[1] ?? "");
    if (count === undefined) return false;
    nextDays = count;
    return true;
  });

  // "for three days", "for a week", "5-day"
  collect(new RegExp(`\\bfor\\s+(?:the\\s+)?(\\d{1,3}|${NUMBER_WORDS})[\\s-]*(days?|weeks?)\\b`, "g"), (match) => {
    const count = toNumber(match[1] ?? "");
    if (count === undefined) return false;
    durationDays = (match[2] ?? "").startsWith("week") ? count * 7 : count;
    return true;
  });
  collect(/\b(\d{1,3})[\s-]days?\b/g, (match) => {
    const count = toNumber(match[1] ?? "");
    if (count === undefined) return false;
    durationDays ??= count;
    return true;
  });

  // ISO dates
  collect(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) =>
    push(match, makeDate(Number(match[1]), Number(match[2]), Number(match[3])), match[0]),
  );

  // "Nov 2-5" / "November 2 to 5"
  collect(
    new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|until|till|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g"),
    (match) => {
      const month = monthNumber(match[1] ?? "");
      const first = resolveMonthDay(month, Number(match[2]), undefined, today);
      const last = resolveMonthDay(month, Number(match[3]), undefined, today);
      push(match, first, match[0]);
      push({ ...match, index: (match.index ?? 0) + 1 } as RegExpMatchArray, last, match[0]);
      return true;
    },
  );

  // "2 to 5 November"
  collect(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|until|till|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b`, "g"),
    (match) => {
      const month = monthNumber(match[3] ?? "");
      const first = resolveMonthDay(month, Number(match[1]), undefined, today);
      const last = resolveMonthDay(month, Number(match[2]), undefined, today);
      push(match, first, match[0]);
      push({ ...match, index: (match.index ?? 0) + 1 } as RegExpMatchArray, last, match[0]);
      return true;
    },
  );

  // "November 2" / "Nov 2nd, 2026"
  collect(
    new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`, "g"),
    (match) =>
      push(
        match,
        resolveMonthDay(monthNumber(match[1] ?? ""), Number(match[2]), match[3] ? Number(match[3]) : undefined, today),
        match[0],
      ),
  );

  // "2 November" / "2nd of Nov 2026"
  collect(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?(?:\\s*,?\\s*(\\d{4}))?`, "g"),
    (match) =>
      push(
        match,
        resolveMonthDay(monthNumber(match[2] ?? ""), Number(match[1]), match[3] ? Number(match[3]) : undefined, today),
        match[0],
      ),
  );

  // Relative words
  collect(/\bday after tomorrow\b/g, (match) => push(match, addDays(today, 2), match[0]));
  collect(/\btomorrow\b/g, (match) => push(match, addDays(today, 1), match[0]));
  collect(/\b(?:today|tonight)\b/g, (match) => push(match, today, match[0]));
  collect(new RegExp(`\\bin\\s+(\\d{1,2}|${NUMBER_WORDS})\\s+days?\\b`, "g"), (match) => {
    const count = toNumber(match[1] ?? "");
    if (count === undefined) return false;
    return push(match, addDays(today, count), match[0]);
  });

  // Weekdays. Abbreviations need a keyword ("on fri") to avoid false hits.
  collect(
    /\b(?:(this|next|coming|upcoming|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/g,
    (match) => {
      const name = match[2] ?? "";
      const isFull = name.length > 4 && name.endsWith("day");
      if (!isFull && !match[1]) return false;
      const weekday = WEEKDAYS.findIndex((day) => day.startsWith(name.slice(0, 3)));
      if (weekday < 0) return false;
      return push(match, nextWeekday(today, weekday), match[0]);
    },
  );

  // Vague or ambiguous expressions are only a problem when nothing else matched.
  if (found.length === 0 && !issue) {
    if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(input)) {
      issue =
        "I can't tell whether that date is day/month or month/day. Please write it like 2 November or 2026-11-02.";
    } else if (/\b(?:next|this)\s+(?:week|weekend|month)\b|\bthe weekend\b|\bsometime\b/i.test(input)) {
      issue = "Which exact date do you need the vehicle? For example, 2 November.";
    }
  }

  found.sort((a, b) => a.index - b.index);
  let dates = found.map((item) => item.date);

  if (!issue && dates.some((date) => date < today)) {
    issue = "One of those dates is in the past. Please give me dates from today onward.";
    dates = [];
  }

  const anchor = dates[0];
  if (nextDays !== undefined && anchor) {
    dates = [anchor, addDays(anchor, nextDays)];
  } else if (nextDays !== undefined) {
    durationDays ??= nextDays;
  }

  return { dates: dates.slice(0, 2), durationDays, issue };
}

/* =========================================================
   SLOT EXTRACTION (current message only)
   ========================================================= */

const CITY_PATTERN = /\b(dhaka|rangpur|chattogram|chittagong|ctg)\b/i;

export function extractBudget(text: string): number | undefined {
  const lower = text.toLowerCase();
  const amount = "(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k)?";
  const currency = "(?:৳|tk\\.?|taka|bdt)";
  const notUnit = "(?!\\s*(?:people|persons|passengers|adults|seats?|days?|hours?|kg|km|members|pax))";

  const patterns = [
    new RegExp(
      `\\b(?:under|below|less than|within|up to|upto|maximum|max(?:imum)?(?:\\s+(?:budget|price|rent))?|budget(?:\\s+(?:is|of))?|cheaper than|not more than|no more than|at most)\\s*(?:of\\s*)?(${currency})?\\s*${amount}\\s*${currency}?${notUnit}`,
    ),
    new RegExp(`${amount}\\s*${currency}?\\s*(?:or less|or below|or cheaper|and below|and under)\\b`),
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (!match) continue;

    const hasCurrency = pattern === patterns[0] ? Boolean(match[1]) : /৳|tk|taka|bdt/.test(match[0]);
    const numberText = pattern === patterns[0] ? match[2] : match[1];
    const kilo = pattern === patterns[0] ? match[3] : match[2];
    if (!numberText) continue;

    let value = Number(numberText.replace(/,/g, ""));
    if (kilo) value *= 1000;
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!hasCurrency && value < 500) continue; // "under 5" is not a price
    return Math.round(value);
  }

  return undefined;
}

export function extractPassengers(text: string): number | undefined {
  const lower = text.toLowerCase();
  const unit = "(?:people|persons?|passengers?|adults|pax|travell?ers|members|guests|seats?)";

  const match =
    lower.match(new RegExp(`\\b(\\d{1,3}|${NUMBER_WORDS})\\s*(?:of us\\s*)?${unit}\\b`)) ??
    lower.match(/\b(?:family|group|party|team) of (\d{1,3}|[a-z]+)\b/) ??
    lower.match(/\bwe(?:'re| are) (\d{1,3}|[a-z]+)\b/);

  const value = match ? toNumber(match[1] ?? "") : undefined;
  return value !== undefined && value >= 1 && value <= 60 ? value : undefined;
}

export function extractCity(text: string): City | undefined {
  const match = text.match(CITY_PATTERN)?.[1]?.toLowerCase();
  if (!match) return undefined;
  if (match === "dhaka") return "Dhaka";
  if (match === "rangpur") return "Rangpur";
  return "Chattogram";
}

/**
 * "SUV" and "HiAce" are explicit types. The plain word "car" is treated as
 * generic ("a car") and does NOT filter, because the database also calls one
 * category "car" (sedans and similar). Say "sedan" or "regular car" for that.
 */
export function extractVehicleType(text: string): VehicleType | undefined {
  const lower = text.toLowerCase();
  if (/\bsuvs?\b/.test(lower)) return "SUV";
  if (/\bhi[\s-]?ace\b|\bvans?\b|\bmicro[\s-]?bus(?:es)?\b|\bmini[\s-]?bus(?:es)?\b/.test(lower)) return "HiAce";
  if (/\bsedans?\b|\bsaloon\b|\bregular cars?\b|\bstandard cars?\b|\bnormal cars?\b|\bprivate cars?\b|\bonly cars?\b/.test(lower)) {
    return "car";
  }
  return undefined;
}

export function extractAcType(text: string): AcType | undefined {
  const lower = text.toLowerCase();
  if (/\bnon[\s-]?ac\b|\bwithout (?:an? )?ac\b|\bno ac\b/.test(lower)) return "Non-AC";
  if (/\bac\b|\bair[\s-]?condition(?:ed|ing)?\b/.test(lower)) return "AC";
  return undefined;
}

interface Extraction {
  slots: TripSlots;
  issue?: string | undefined;
  hasSignal: boolean;
  hasDates: boolean;
}

/** Merges what the CURRENT message says into the earlier slots. */
export function extractSlots(text: string, previous: TripSlots, phase: Phase | undefined, today: string): Extraction {
  const slots: TripSlots = { ...previous };
  let hasSignal = false;

  const city = extractCity(text);
  if (city) { slots.city = city; hasSignal = true; }

  const vehicleType = extractVehicleType(text);
  if (vehicleType) { slots.vehicleType = vehicleType; hasSignal = true; }

  const acType = extractAcType(text);
  if (acType) { slots.acType = acType; hasSignal = true; }

  const passengers = extractPassengers(text);
  if (passengers !== undefined) { slots.passengers = passengers; hasSignal = true; }

  const budget = extractBudget(text);
  if (budget !== undefined) { slots.budget = budget; hasSignal = true; }

  const parsed = parseDates(text, today);
  const dates = parsed.dates;
  const hasDates = dates.length > 0 || parsed.durationDays !== undefined;

  if (parsed.issue) {
    return { slots, issue: parsed.issue, hasSignal: true, hasDates: false };
  }

  if (dates.length === 2) {
    const [first, second] = dates as [string, string];
    if (second < first) {
      return {
        slots,
        issue: "The return date is before the pickup date. Please send them again in order.",
        hasSignal: true,
        hasDates: false,
      };
    }
    slots.startDate = first;
    slots.endDate = second;
    slots.durationDays = undefined;
    hasSignal = true;
  } else if (dates.length === 1) {
    const only = dates[0] as string;
    const lowerText = text.toLowerCase();
    const looksLikeReturn = /\b(?:until|till|return(?:ing)?|back|by|to|drop(?:ping)?)\b/.test(lowerText);

    if (slots.startDate && !slots.endDate && only >= slots.startDate && (looksLikeReturn || phase !== "results")) {
      slots.endDate = only;
    } else if (phase === "results" && slots.startDate && slots.endDate) {
      // "What about Nov 10?" keeps the same trip length.
      const length = diffDays(slots.startDate, slots.endDate);
      slots.startDate = only;
      slots.endDate = addDays(only, length);
    } else {
      slots.startDate = only;
      slots.endDate = undefined;
    }
    hasSignal = true;
  }

  if (parsed.durationDays !== undefined) {
    slots.durationDays = parsed.durationDays;
    hasSignal = true;
  }

  if (slots.startDate && !slots.endDate && slots.durationDays !== undefined) {
    slots.endDate = addDays(slots.startDate, slots.durationDays - 1);
    slots.durationDays = undefined;
  }

  return { slots, hasSignal, hasDates };
}

/* =========================================================
   INTENT DETECTION (current message only)
   ========================================================= */

const VEHICLE_NOUN =
  "(?:cars?|vehicles?|suvs?|hi[\\s-]?ace|vans?|micro[\\s-]?bus(?:es)?|mini[\\s-]?bus(?:es)?|rides?|sedans?|taxis?|transport)";

const hasVehicleNoun = (lower: string): boolean => new RegExp(`\\b${VEHICLE_NOUN}\\b`).test(lower);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function detectPriceIntent(lower: string, budget: number | undefined): PriceQuery | null {
  const descending =
    /\b(?:most expensive|priciest|costliest|highest[\s-]?(?:priced?|rent|rate|cost|daily rent|daily price))\b/.test(lower);
  const ascending =
    /\b(?:cheap(?:est|er)?|least expensive|lowest[\s-]?(?:priced?|rent|rate|cost|daily rent|daily price)|most affordable|affordable|inexpensive|low[\s-]?cost|economical|budget[\s-]friendly)\b/.test(lower);

  if (descending) return { direction: "DESC", mode: "extreme" };
  if (ascending) return { direction: "ASC", mode: "extreme" };
  if (budget !== undefined) return { direction: "ASC", mode: "budget" };

  const wantsToRent = /\b(?:hire|hiring|rent|renting|book|booking|reserve|lease|charter)\b/.test(lower);
  const asksPrice =
    /\b(?:how much|price list|prices?|rates?|daily (?:rent|rate|price)|rent per day|cost)\b/.test(lower) &&
    hasVehicleNoun(lower);
  if (asksPrice && !wantsToRent) return { direction: "ASC", mode: "list" };

  return null;
}

function isRentalRequest(lower: string): boolean {
  const rentalVerb = /\b(?:hire|hiring|rent|renting|rental|book|booking|reserve|lease|charter)\b/.test(lower);
  const firstPerson = /\b(?:i|we|me|us)\b/.test(lower);
  const need = new RegExp(
    `\\b(?:need|want|looking for|look for|searching for|require|wish|would like|like to have|interested in|get|find|arrange)\\b.{0,40}\\b${VEHICLE_NOUN}\\b`,
  ).test(lower);

  return (rentalVerb && (hasVehicleNoun(lower) || firstPerson)) || need;
}

function isAvailabilityRequest(lower: string): boolean {
  if (/\b(?:available|availability|vacant|free)\b/.test(lower) && (hasVehicleNoun(lower) || CITY_PATTERN.test(lower))) {
    return true;
  }
  if (new RegExp(`\\b(?:show|find|list|search|display|see|any|do you have|have you got)\\b.{0,30}\\b${VEHICLE_NOUN}\\b`).test(lower)) {
    return true;
  }
  if (new RegExp(`\\b(?:what|which)\\s+${VEHICLE_NOUN}\\b.{0,25}\\b(?:do you have|have you got|are there|is there|are available|do you offer in)\\b`).test(lower)) {
    return true;
  }
  return /\b(?:recommend|suggest|suggestion|recommendation|suitable|best)\b/.test(lower) &&
    (hasVehicleNoun(lower) || extractPassengers(lower) !== undefined);
}

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3,
  fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6, last: -1,
};

/** "the second one", "book the 3rd car", "option 2". */
export function detectOrdinal(lower: string): number | undefined {
  if (/\b(?:first|second|third|fourth|fifth|sixth|last|1st|2nd|3rd|4th|5th|6th)\b\s+(?:of|week|day|time)\b/.test(lower)) {
    return undefined;
  }

  const word = lower.match(
    /\b(first|second|third|fourth|fifth|sixth|last|1st|2nd|3rd|4th|5th|6th)\b(?:\s+(?:one|car|vehicle|suv|option|choice|hiace|result))?/,
  )?.[1];
  const hasPickWord =
    /\b(?:book|take|choose|select|pick|want|like|go with|rent|one|option|choice|result)\b/.test(lower) ||
    hasVehicleNoun(lower);
  if (word && hasPickWord) return ORDINALS[word];

  const numbered = lower.match(/\b(?:number|no\.?|option|choice|#)\s*(\d)\b/);
  if (numbered) return Number(numbered[1]);

  return undefined;
}

/* =========================================================
   "SLOT-ONLY" MESSAGES ("in Dhaka", "for five people", "Nov 2 to Nov 5")
   ========================================================= */

const FILLER_WORDS = new Set([
  "from", "to", "on", "in", "at", "for", "the", "a", "an", "and", "please",
  "until", "till", "by", "of", "is", "are", "we", "i", "need", "it", "with",
  "next", "this", "day", "days", "people", "persons", "passengers", "pickup",
  "return", "date", "dates", "starting", "start", "ending", "end", "ok",
  "okay", "yes", "yeah", "sure", "then", "also", "just", "only", "prefer",
  "want", "would", "like", "city", "back", "me", "us", "my", "our", "it's",
  "its", "that", "thanks", "thank", "you", "pick", "up", "drop", "off",
]);

function isSlotOnlyMessage(lower: string, maxLeftover: number): boolean {
  const stripped = lower
    .replace(new RegExp(CITY_PATTERN.source, "gi"), " ")
    .replace(/\bsuvs?\b|\bhi[\s-]?ace\b|\bvans?\b|\bmicro[\s-]?bus(?:es)?\b|\bmini[\s-]?bus(?:es)?\b|\bsedans?\b|\bnon[\s-]?ac\b|\bac\b|\bair[\s-]?condition(?:ed|ing)?\b|\bcars?\b/g, " ")
    .replace(new RegExp(`\\b${MONTH_RE}\\b`, "g"), " ")
    .replace(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|today|tonight|day after tomorrow)\b/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/[0-9৳,.\-–—:/#]+(?:st|nd|rd|th|k)?/g, " ")
    .replace(new RegExp(`\\b(?:${NUMBER_WORDS})\\b`, "g"), " ")
    .replace(/\b(?:tk|taka|bdt|under|below|within|budget|max|maximum|than|less|up)\b/g, " ");

  const leftover = stripped
    .split(/[^a-z']+/)
    .filter((word) => word.length > 0 && !FILLER_WORDS.has(word));

  return leftover.length <= maxLeftover;
}

/* =========================================================
   QUESTIONS THE ASSISTANT ASKS FOR MISSING INFORMATION
   ========================================================= */

function describeSlots(slots: TripSlots): string {
  const parts: string[] = [];

  if (slots.vehicleType || slots.acType) {
    const noun =
      slots.vehicleType === "SUV" ? "SUV"
        : slots.vehicleType === "HiAce" ? "HiAce"
          : slots.vehicleType === "car" ? "car (sedan type)"
            : "vehicle";
    const phrase = `${slots.acType ? `${slots.acType} ` : ""}${noun}`;
    parts.push(`${/^(?:AC|SUV)\b/.test(phrase) ? "an" : "a"} ${phrase}`);
  }

  if (slots.city) parts.push(`in ${slots.city}`);
  if (slots.passengers) parts.push(`for ${slots.passengers} passenger${slots.passengers === 1 ? "" : "s"}`);
  if (slots.budget) parts.push(`up to ৳${slots.budget.toLocaleString("en-BD")}/day`);
  if (slots.startDate && slots.endDate) parts.push(formatRange(slots.startDate, slots.endDate));
  else if (slots.startDate) parts.push(`pickup ${formatHuman(slots.startDate)}`);
  else if (slots.durationDays) parts.push(`${slots.durationDays} day${slots.durationDays === 1 ? "" : "s"}`);

  return parts.join(", ");
}

const CITY_LIST = "Dhaka, Rangpur or Chattogram";

function toFilters(slots: TripSlots): VehicleFilters {
  return {
    city: slots.city,
    vehicleType: slots.vehicleType,
    acType: slots.acType,
    minSeats: slots.passengers,
    maxPrice: slots.budget,
    ids: slots.focusVehicleId ? [slots.focusVehicleId] : undefined,
  };
}

/* =========================================================
   THE PLANNER
   ========================================================= */

const FLOW_INTENTS: readonly IntentName[] = [
  "rental_request", "availability_search", "select_vehicle", "slot_followup",
];

function say(intent: IntentName, state: ConversationState, text: string, remember = false): TurnPlan {
  return {
    intent,
    state: remember ? { ...state, lastIntent: intent } : state,
    action: { type: "say", text },
  };
}

function askForMissing(
  intent: IntentName,
  prev: ConversationState,
  slots: TripSlots,
  opening: string,
): TurnPlan {
  const known = describeSlots(slots);
  const lead = opening || (known ? `Got it: ${known}.` : "");
  const space = lead ? `${lead} ` : "";

  let awaiting: Awaiting;
  let question: string;

  // A vehicle the user already chose implies its city.
  const hasCity = Boolean(slots.city || slots.focusVehicleId);

  if (!hasCity && !slots.startDate) {
    awaiting = "cityAndDates";
    question = slots.durationDays
      ? `Which city do you need it in (${CITY_LIST}) and what is your pickup date? I'll count ${slots.durationDays} day${slots.durationDays === 1 ? "" : "s"} from then.`
      : `Which city do you need it in (${CITY_LIST}), and what are your pickup and return dates?`;
  } else if (!hasCity) {
    awaiting = "city";
    question = slots.endDate
      ? `Which city do you need it in (${CITY_LIST})?`
      : `Which city do you need it in (${CITY_LIST}), and when will you return?`;
  } else if (!slots.startDate) {
    awaiting = "dates";
    question = slots.durationDays
      ? `What is your pickup date? I'll count ${slots.durationDays} day${slots.durationDays === 1 ? "" : "s"} from then.`
      : "What are your pickup and return dates?";
  } else {
    awaiting = "returnDate";
    question = "When will you return? A same-day return is fine.";
  }

  return {
    intent,
    state: { ...prev, slots, awaiting, phase: "collecting", lastIntent: intent },
    action: { type: "say", text: `${space}${question}` },
  };
}

export function planTurn(message: string, previous: ConversationState, today: string): TurnPlan {
  const text = message.trim();
  const prev: ConversationState = { ...previous, slots: { ...previous.slots } };

  if (!text) {
    return say("empty", prev, "Please type a message and I'll help.");
  }

  if (!isEnglishMessage(text)) {
    return say("non_english", prev, NON_ENGLISH_MESSAGE);
  }

  const lower = normalise(text);

  /* ---- small talk ---- */

  if (/^(?:hi+|hello+|hey+|good (?:morning|afternoon|evening)|greetings|salam|assalamu alaikum|assalamualaikum)(?: there| rentwise)?[.!?\s]*$/.test(lower)) {
    return say("greeting", prev, "Hello! I can help you find a vehicle, compare prices, check availability or explain how booking works. What do you need?");
  }
  if (/^(?:thanks|thank you(?: so much)?|thx|ok thanks|great thanks)[.!?\s]*$/.test(lower)) {
    return say("thanks", prev, "You're welcome! Tell me if you want to search for another vehicle.");
  }
  if (/^(?:bye|goodbye|see you(?: later)?)[.!?\s]*$/.test(lower)) {
    return say("goodbye", prev, "Goodbye! Thanks for choosing Rentwise.");
  }
  if (/^(?:ok(?:ay)?|yes|yeah|yep|sure|alright|great|cool|got it|fine)[.!?\s]*$/.test(lower)) {
    return say("thanks", prev, "Great! Tell me the city and dates you need a vehicle for, or ask me anything about Rentwise.");
  }
  if (/^(?:start over|start again|reset|new search|clear(?: everything| all)?|forget (?:it|that)|never ?mind|cancel (?:that|this) search)[.!?\s]*$/.test(lower)) {
    return say("restart", emptyState(), "No problem, I've cleared your search. What would you like to look for?");
  }

  /* ---- fixed answers: project information, FAQ, how booking works ---- */

  const faq = answerFaq(lower);
  if (faq) {
    return say(faq.intent, prev, faq.text);
  }

  /* ---- choosing one of the vehicles just shown ---- */

  const mentionedDates = parseDates(lower, today).dates.length > 0;
  const ordinal = mentionedDates ? undefined : detectOrdinal(lower);
  const lastIds = prev.lastResultIds ?? [];
  const pointsAtOne = /\b(?:book|take|choose|select|pick|go with|rent|reserve)\s+(?:this|that|it)\b|\b(?:this|that) one\b/.test(lower);
  const pickThis = lastIds.length === 1 && pointsAtOne;

  if (ordinal !== undefined || pointsAtOne) {
    if (lastIds.length > 1 && ordinal === undefined) {
      return say("select_vehicle", prev, "Which one would you like? You can say “the first one”, “the second one” and so on, or tap Book This on a card.");
    }
    if (lastIds.length === 0) {
      return say(
        "select_vehicle",
        prev,
        "I don't have a vehicle list for you to choose from yet. Tell me the city and your dates and I'll find options.",
      );
    }

    const position = pickThis ? 0 : ordinal === -1 ? lastIds.length - 1 : (ordinal ?? 1) - 1;
    const vehicleId = lastIds[position];

    if (vehicleId === undefined) {
      return say(
        "select_vehicle",
        prev,
        `I only showed ${lastIds.length} vehicle${lastIds.length === 1 ? "" : "s"}. Which one would you like?`,
      );
    }

    const slots: TripSlots = { ...prev.slots, focusVehicleId: vehicleId };
    const dates =
      slots.startDate && slots.endDate ? { start: slots.startDate, end: slots.endDate } : undefined;

    return {
      intent: "select_vehicle",
      state: {
        ...prev,
        slots,
        awaiting: dates ? undefined : "dates",
        phase: dates ? "results" : "collecting",
        lastIntent: "select_vehicle",
      },
      action: { type: "select", vehicleId, dates, city: slots.city, passengers: slots.passengers },
    };
  }

  /* ---- what does the CURRENT message ask for? ---- */

  const budgetInMessage = extractBudget(lower);
  const price = detectPriceIntent(lower, budgetInMessage);
  const rental = isRentalRequest(lower);
  const availability = isAvailabilityRequest(lower);
  const explicitSearch = rental || availability;

  const activeFlow =
    prev.awaiting !== undefined ||
    prev.phase !== undefined ||
    (prev.lastIntent !== undefined && FLOW_INTENTS.includes(prev.lastIntent));

  /* ---- price comparison ---- */

  if (price) {
    // Price questions are exploratory: they reuse the city (and, inside an
    // active rental search, the other trip details) but never an old price filter.
    const inRentalSearch =
      prev.lastIntent !== undefined && FLOW_INTENTS.includes(prev.lastIntent);

    // Naming a vehicle word ("cheapest car") starts a fresh type choice;
    // an earlier SUV preference should not silently filter it.
    const base: TripSlots = inRentalSearch
      ? {
          ...prev.slots,
          budget: undefined,
          focusVehicleId: undefined,
          vehicleType: hasVehicleNoun(lower) ? undefined : prev.slots.vehicleType,
        }
      : { city: prev.slots.city };

    const extraction = extractSlots(lower, base, undefined, today);
    if (extraction.issue) {
      return say("price_comparison", prev, extraction.issue);
    }

    const slots = extraction.slots;
    const dates =
      slots.startDate && slots.endDate ? { start: slots.startDate, end: slots.endDate } : undefined;

    return {
      intent: "price_comparison",
      state: {
        ...prev,
        slots,
        awaiting: undefined,
        phase: dates ? "results" : prev.phase,
        lastIntent: "price_comparison",
        priceQuery: price,
      },
      action: { type: "price", direction: price.direction, mode: price.mode, filters: toFilters(slots), dates },
    };
  }

  /* ---- starting (or restarting) a rental search ---- */

  if (explicitSearch) {
    let base: TripSlots = prev.slots;

    if (prev.lastIntent === "price_comparison") {
      base = { city: prev.slots.city, passengers: prev.slots.passengers };
    } else if (prev.phase === "results") {
      // A finished search: keep city and passengers, ask for new dates.
      base = { city: prev.slots.city, passengers: prev.slots.passengers };
    } else {
      base = { ...prev.slots, focusVehicleId: undefined };
    }

    const extraction = extractSlots(lower, base, undefined, today);
    const intent: IntentName = rental ? "rental_request" : "availability_search";

    if (extraction.issue) {
      return {
        intent,
        state: { ...prev, slots: extraction.slots, awaiting: prev.awaiting ?? "dates", phase: "collecting", lastIntent: intent },
        action: { type: "say", text: extraction.issue },
      };
    }

    return continueSearch(intent, prev, extraction.slots, true, extraction.hasSignal);
  }

  /* ---- a follow-up that only supplies details ---- */

  const extraction = extractSlots(lower, prev.slots, prev.phase, today);

  if (extraction.hasSignal) {
    const slotOnly = isSlotOnlyMessage(lower, activeFlow ? 2 : 0);

    if (slotOnly) {
      if (extraction.issue) {
        return {
          intent: "slot_followup",
          state: { ...prev, awaiting: prev.awaiting ?? "dates", lastIntent: prev.lastIntent ?? "slot_followup" },
          action: { type: "say", text: extraction.issue },
        };
      }

      // Refining a price comparison (e.g. "in Dhaka") unless dates were given.
      if (prev.lastIntent === "price_comparison" && prev.priceQuery && !extraction.hasDates) {
        const slots = extraction.slots;
        const dates =
          slots.startDate && slots.endDate ? { start: slots.startDate, end: slots.endDate } : undefined;
        return {
          intent: "price_comparison",
          state: { ...prev, slots, lastIntent: "price_comparison" },
          action: {
            type: "price",
            direction: prev.priceQuery.direction,
            mode: prev.priceQuery.mode,
            filters: toFilters(slots),
            dates,
          },
        };
      }

      return continueSearch("slot_followup", prev, extraction.slots, false, true);
    }
  }

  /* ---- everything else is a knowledge question ---- */

  return {
    intent: "knowledge",
    state: prev,
    action: { type: "knowledge" },
  };
}

/** Decides between asking for missing details and running the search. */
function continueSearch(
  intent: IntentName,
  prev: ConversationState,
  slots: TripSlots,
  isNewRequest: boolean,
  hasSignal: boolean,
): TurnPlan {
  // The slot-only follow-up may continue a search that already has results
  // (e.g. "in Chattogram" after "no vehicles in Dhaka").
  const complete = Boolean(
    (slots.city || slots.focusVehicleId) && slots.startDate && slots.endDate,
  );

  if (!complete) {
    const opening =
      isNewRequest && !hasSignal ? "Happy to help you find a vehicle." : "";
    return askForMissing(intent, prev, slots, opening);
  }

  const start = slots.startDate as string;
  const end = slots.endDate as string;

  return {
    intent,
    state: { ...prev, slots, awaiting: undefined, phase: "results", lastIntent: intent },
    action: {
      type: "search",
      filters: toFilters(slots),
      dates: { start, end },
      passengers: slots.passengers,
    },
  };
}

/**
 * Rentwise chatbot — routing and conversation tests.
 *
 * Run from the backend folder (no database or API key needed):
 *
 *   npx tsx src/scripts/testChatbot.ts
 *
 * The real routing code (chatIntent.ts + ragService.ts) runs against a small
 * in-memory vehicle/booking table that follows the same availability rules as
 * the SQL: maintenance vehicles and vehicles with an overlapping "Booked"
 * booking are excluded.
 */

import assert from "node:assert/strict";

import {
  getRentwiseChatResponse,
  type ChatDeps,
  type RentwiseChatResponse,
  type RentwiseVehicle,
  type VehicleRepo,
} from "../services/ragService.js";
import { CITIES, type ConversationState, type VehicleFilters } from "../services/chatIntent.js";

/* ---------- fake data ---------- */

const make = (
  id: number,
  vehicle_name: string,
  type: string,
  city: string,
  ac_type: string,
  total_seats: number,
  daily_rent_price: number,
  availability_status = "available",
): RentwiseVehicle => ({
  id,
  vehicle_name,
  type,
  registration_number: `REG-${id}`,
  ac_type,
  total_seats,
  fuel_type: "Petrol",
  suitcase_capacity: 2,
  daily_rent_price,
  city,
  availability_status,
  image: `uploads/vehicles/v${id}.png`,
  created_at: "2026-09-01",
});

const VEHICLES: RentwiseVehicle[] = [
  make(1, "Toyota Axio", "car", "Dhaka", "AC", 4, 3500),
  make(2, "Toyota Premio", "car", "Dhaka", "AC", 4, 4500),
  make(3, "Toyota HiAce GL", "HiAce", "Dhaka", "AC", 12, 8000),
  make(4, "Toyota Fortuner", "SUV", "Dhaka", "AC", 7, 9000),
  make(5, "Mitsubishi Pajero", "SUV", "Dhaka", "AC", 7, 10000),
  make(6, "Nissan X-Trail", "SUV", "Chattogram", "AC", 5, 7000),
  make(7, "Toyota Allion", "car", "Chattogram", "Non-AC", 4, 3000),
  make(8, "Toyota HiAce Super", "HiAce", "Rangpur", "Non-AC", 14, 7500),
  make(9, "Cheap Car In Workshop", "car", "Dhaka", "AC", 4, 2000, "maintenance"),
];

const BOOKINGS = [
  { vehicle_id: 4, start: "2026-11-02", end: "2026-11-05" },
  { vehicle_id: 4, start: "2026-12-01", end: "2026-12-05" },
  { vehicle_id: 5, start: "2026-12-01", end: "2026-12-05" },
  { vehicle_id: 8, start: "2026-11-10", end: "2026-11-12" },
];

function matches(vehicle: RentwiseVehicle, filters: VehicleFilters): boolean {
  if (filters.city && vehicle.city !== filters.city) return false;
  if (filters.vehicleType && vehicle.type !== filters.vehicleType) return false;
  if (filters.acType && vehicle.ac_type !== filters.acType) return false;
  if (filters.minSeats && vehicle.total_seats < filters.minSeats) return false;
  if (filters.maxPrice && Number(vehicle.daily_rent_price) > filters.maxPrice) return false;
  if (filters.ids && !filters.ids.includes(vehicle.id)) return false;
  return true;
}

const byPrice = (order: "ASC" | "DESC") => (a: RentwiseVehicle, b: RentwiseVehicle) =>
  (Number(a.daily_rent_price) - Number(b.daily_rent_price)) * (order === "DESC" ? -1 : 1) ||
  a.total_seats - b.total_seats;

const isFree = (vehicle: RentwiseVehicle, start: string, end: string): boolean =>
  vehicle.availability_status !== "maintenance" &&
  !BOOKINGS.some((b) => b.vehicle_id === vehicle.id && b.start <= end && b.end >= start);

const repo: VehicleRepo = {
  async searchAvailable(filters, start, end, order = "ASC") {
    return VEHICLES.filter((v) => isFree(v, start, end) && matches(v, filters)).sort(byPrice(order));
  },
  async listByPrice(filters, order) {
    return VEHICLES.filter((v) => v.availability_status !== "maintenance" && matches(v, filters)).sort(byPrice(order));
  },
  async getByIds(ids) {
    return VEHICLES.filter((v) => ids.includes(v.id));
  },
  async availableCountByCity(start, end) {
    const counts: Partial<Record<(typeof CITIES)[number], number>> = {};
    for (const city of CITIES) {
      const total = VEHICLES.filter((v) => v.city === city && isFree(v, start, end)).length;
      if (total > 0) counts[city] = total;
    }
    return counts;
  },
  async knowledge() {
    return [
      { title: "Supported Cities", category: "vehicle", content: "Rentwise supports Dhaka, Rangpur and Chattogram." },
    ];
  },
};

// Today is Tuesday, 27 October 2026 (Asia/Dhaka).
const deps: ChatDeps = {
  repo,
  today: () => "2026-10-27",
  askLlm: async () => {
    throw new Error("LLM is not available in tests");
  },
};

/* ---------- a tiny browser: keeps state in memory, like the React component ---------- */

class FakeBrowser {
  state: ConversationState | undefined;

  async say(message: string): Promise<RentwiseChatResponse> {
    const reply = await getRentwiseChatResponse(message, this.state, deps);
    this.state = reply.conversationState;
    return reply;
  }
}

/* ---------- test runner ---------- */

const tests: { name: string; run: () => Promise<void> }[] = [];
const test = (name: string, run: () => Promise<void>): void => {
  tests.push({ name, run });
};

const ids = (reply: RentwiseChatResponse): number[] => reply.vehicles.map((v) => v.id);
const noCards = (reply: RentwiseChatResponse): void => assert.deepEqual(reply.vehicles, [], `unexpected cards: ${ids(reply)}`);

/* ===== A. general rental request ===== */

for (const message of [
  "I want to hire a car",
  "I need a vehicle",
  "I want to rent a car",
  "Can you help me rent a vehicle?",
]) {
  test(`rental request, no cheapest answer: "${message}"`, async () => {
    const reply = await new FakeBrowser().say(message);
    assert.equal(reply.intent, "rental_request");
    noCards(reply);
    assert.doesNotMatch(reply.answer, /cheapest|lowest-priced|most expensive/i);
    assert.match(reply.answer, /city/i);
    assert.match(reply.answer, /dates/i);
    assert.equal(reply.conversationState.awaiting, "cityAndDates");
  });
}

/* ===== B. price comparison ===== */

test("cheapest car: live price-sorted, maintenance vehicle excluded", async () => {
  const reply = await new FakeBrowser().say("What is the cheapest car?");
  assert.equal(reply.intent, "price_comparison");
  assert.equal(reply.vehicles[0]?.vehicle_name, "Toyota Allion");
  assert.equal(Number(reply.vehicles[0]?.daily_rent_price), 3000);
  assert.ok(!ids(reply).includes(9), "maintenance vehicle must not appear");
  assert.match(reply.answer, /cheapest/);
  assert.match(reply.answer, /৳3,000\/day/);
  assert.match(reply.answer, /prices only/i);
  assert.equal(reply.bookingContext, undefined);
  assert.equal(reply.resultsMode, "price");
});

test("cheapest SUV filters by SUV", async () => {
  const reply = await new FakeBrowser().say("Which SUV is cheapest?");
  assert.equal(reply.intent, "price_comparison");
  assert.ok(reply.vehicles.every((v) => v.type === "SUV"));
  assert.equal(reply.vehicles[0]?.vehicle_name, "Nissan X-Trail");
  assert.match(reply.answer, /cheapest SUV/);
});

test("lowest-priced SUVs", async () => {
  const reply = await new FakeBrowser().say("Show me the lowest-priced SUVs.");
  assert.equal(reply.intent, "price_comparison");
  assert.deepEqual(ids(reply), [6, 4, 5]);
});

test("highest daily rent", async () => {
  const reply = await new FakeBrowser().say("Which vehicle has the highest daily rent?");
  assert.equal(reply.intent, "price_comparison");
  assert.equal(reply.vehicles[0]?.vehicle_name, "Mitsubishi Pajero");
  assert.match(reply.answer, /most expensive/);
});

test("budget filter: cars under ৳5,000 per day", async () => {
  const reply = await new FakeBrowser().say("Show cars under ৳5,000 per day");
  assert.equal(reply.intent, "price_comparison");
  assert.deepEqual(ids(reply), [7, 1, 2]);
  assert.ok(reply.vehicles.every((v) => Number(v.daily_rent_price) <= 5000));
});

test("budget with nothing under it is explained honestly", async () => {
  const reply = await new FakeBrowser().say("Show cars under ৳1,000 per day");
  assert.equal(reply.intent, "price_comparison");
  assert.match(reply.answer, /No vehicles match that budget/);
  assert.match(reply.answer, /lowest price/i);
});

test("'under 5 people' is not a budget", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka under 5 people");
  assert.equal(reply.intent, "rental_request");
  assert.equal(reply.conversationState.slots.budget, undefined);
});

/* ===== C. general Rentwise questions ===== */

for (const [message, intent] of [
  ["What is Rentwise?", "project_info"],
  ["Tell me about Rentwise", "project_info"],
  ["What services do you offer?", "project_info"],
  ["How does Rentwise work?", "project_info"],
] as const) {
  test(`project question without cards: "${message}"`, async () => {
    const reply = await new FakeBrowser().say(message);
    assert.equal(reply.intent, intent);
    noCards(reply);
    assert.doesNotMatch(reply.answer, /cheapest|lowest-priced/i);
  });
}

/* ===== D. availability ===== */

test("available cars in Dhaka: remembers Dhaka, asks for dates, no availability claim", async () => {
  const reply = await new FakeBrowser().say("Show available cars in Dhaka");
  assert.equal(reply.intent, "availability_search");
  noCards(reply);
  assert.equal(reply.conversationState.slots.city, "Dhaka");
  assert.equal(reply.conversationState.awaiting, "dates");
  assert.match(reply.answer, /pickup and return dates/i);
  assert.doesNotMatch(reply.answer, /\bis available|are available/i);
});

test("SUV next Friday resolves to an explicit date and asks only for the return date", async () => {
  const reply = await new FakeBrowser().say("I need an SUV next Friday");
  assert.equal(reply.conversationState.slots.vehicleType, "SUV");
  assert.equal(reply.conversationState.slots.startDate, "2026-10-30");
  assert.match(reply.answer, /Fri, 30 Oct 2026/);
  assert.match(reply.answer, /city/i);
});

test("'available for three days' asks for city and pickup, remembers the length", async () => {
  const reply = await new FakeBrowser().say("Which vehicles are available for three days?");
  assert.equal(reply.conversationState.slots.durationDays, 3);
  assert.equal(reply.conversationState.awaiting, "cityAndDates");
  noCards(reply);
});

test("duration is applied once the pickup date arrives", async () => {
  const chat = new FakeBrowser();
  await chat.say("Which vehicles are available for three days?");
  await chat.say("Dhaka");
  const reply = await chat.say("tomorrow");
  assert.equal(reply.conversationState.slots.startDate, "2026-10-28");
  assert.equal(reply.conversationState.slots.endDate, "2026-10-30");
  assert.equal(reply.bookingContext?.endDate, "2026-10-30");
  assert.ok(reply.vehicles.length > 0);
});

/* ===== F. follow-ups ===== */

test("city, then dates as a follow-up: live results are date-checked", async () => {
  const chat = new FakeBrowser();
  const first = await chat.say("I need a car in Dhaka");
  noCards(first);
  assert.equal(first.conversationState.slots.city, "Dhaka");
  assert.equal(first.conversationState.awaiting, "dates");

  const second = await chat.say("From November 2 to November 5");
  assert.equal(second.intent, "slot_followup");
  // Fortuner (id 4) is booked 2-5 Nov, maintenance car (9) is excluded.
  assert.deepEqual(ids(second), [1, 2, 3, 5]);
  assert.equal(second.bookingContext?.startDate, "2026-11-02");
  assert.equal(second.bookingContext?.endDate, "2026-11-05");
  assert.equal(second.bookingContext?.city, "Dhaka");
  assert.equal(second.resultsMode, "available");
  assert.match(second.answer, /4 vehicles available in Dhaka/);
});

test("'Nov 2-5' short range and 'for five people' follow-ups", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need a vehicle in Dhaka");
  const people = await chat.say("for five people");
  assert.equal(people.conversationState.slots.passengers, 5);
  assert.equal(people.conversationState.awaiting, "dates");
  assert.match(people.answer, /5 passengers/);

  const reply = await chat.say("Nov 2-5");
  assert.equal(reply.conversationState.slots.startDate, "2026-11-02");
  assert.equal(reply.conversationState.slots.endDate, "2026-11-05");
  assert.ok(reply.vehicles.every((v) => v.total_seats >= 5));
});

test("an SUV in Dhaka for a date range filters by type", async () => {
  const reply = await new FakeBrowser().say("I need an SUV in Dhaka from November 2 to November 5");
  assert.deepEqual(ids(reply), [5]);
});

test("same-day single date finishes the trip when pickup is already known", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need an SUV next Friday");
  const reply = await chat.say("Dhaka");
  assert.equal(reply.conversationState.awaiting, "returnDate");
  const done = await chat.say("November 1");
  assert.equal(done.conversationState.slots.endDate, "2026-11-01");
  assert.ok(done.vehicles.every((v) => v.type === "SUV" && v.city === "Dhaka"));
});

test("latest question wins: Rentwise question after a price comparison", async () => {
  const chat = new FakeBrowser();
  const price = await chat.say("What is the cheapest car?");
  assert.ok(price.vehicles.length > 0);
  const reply = await chat.say("What is Rentwise?");
  assert.equal(reply.intent, "project_info");
  noCards(reply);
  assert.doesNotMatch(reply.answer, /cheapest|lowest-priced/i);
  assert.equal(reply.conversationState.lastResultIds, undefined);
});

test("latest question wins: rental request after a price comparison", async () => {
  const chat = new FakeBrowser();
  await chat.say("Which SUV is cheapest in Dhaka?");
  const reply = await chat.say("I want to hire a car");
  assert.equal(reply.intent, "rental_request");
  noCards(reply);
  assert.doesNotMatch(reply.answer, /cheapest|lowest-priced/i);
  assert.equal(reply.conversationState.slots.vehicleType, undefined);
  assert.equal(reply.conversationState.slots.city, "Dhaka");
  assert.equal(reply.conversationState.awaiting, "dates");
});

test("refining a price comparison with a city", async () => {
  const chat = new FakeBrowser();
  await chat.say("Which SUV is cheapest?");
  const reply = await chat.say("in Dhaka");
  assert.equal(reply.intent, "price_comparison");
  assert.equal(reply.vehicles[0]?.vehicle_name, "Toyota Fortuner");
});

test("price question with dates is date-checked and bookable", async () => {
  const reply = await new FakeBrowser().say("cheapest car in Dhaka from November 2 to November 5");
  assert.equal(reply.intent, "price_comparison");
  assert.equal(reply.resultsMode, "available");
  assert.equal(reply.vehicles[0]?.vehicle_name, "Toyota Axio");
  assert.equal(reply.bookingContext?.startDate, "2026-11-02");
});

test("a new rental request after finished results keeps city, drops dates", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need a car in Dhaka from November 2 to November 5");
  const reply = await chat.say("I want to hire a car");
  noCards(reply);
  assert.equal(reply.conversationState.slots.city, "Dhaka");
  assert.equal(reply.conversationState.slots.startDate, undefined);
  assert.equal(reply.conversationState.awaiting, "dates");
});

test("'what about November 10?' keeps the same trip length", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need a car in Dhaka from November 2 to November 5");
  const reply = await chat.say("what about November 10?");
  assert.equal(reply.conversationState.slots.startDate, "2026-11-10");
  assert.equal(reply.conversationState.slots.endDate, "2026-11-13");
});

/* ===== E. booking ===== */

test("how can I book: explains, never claims a booking, no cards", async () => {
  const reply = await new FakeBrowser().say("How can I book a car?");
  assert.equal(reply.intent, "booking_info");
  noCards(reply);
  assert.match(reply.answer, /can’t create a booking myself/);
});

test("'Can I book this vehicle?' explains the flow", async () => {
  const reply = await new FakeBrowser().say("Can I book this vehicle?");
  assert.equal(reply.intent, "booking_info");
});

test("'book the second one' resolves against the cards just shown", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need a car in Dhaka from November 2 to November 5");
  const reply = await chat.say("I want to book the second one");
  assert.equal(reply.intent, "select_vehicle");
  assert.deepEqual(ids(reply), [2]);
  assert.equal(reply.bookingContext?.startDate, "2026-11-02");
  assert.match(reply.answer, /Tap “Book This”/);
  assert.doesNotMatch(reply.answer, /booked|confirmed/i);
});

test("'book the second one' with nothing shown asks for a search first", async () => {
  const reply = await new FakeBrowser().say("I want to book the second one");
  assert.equal(reply.intent, "select_vehicle");
  noCards(reply);
});

test("choosing a price-only card asks for dates, then checks that vehicle", async () => {
  const chat = new FakeBrowser();
  await chat.say("Show me the lowest-priced SUVs");
  const pick = await chat.say("I'll take the first one");
  assert.deepEqual(ids(pick), [6]);
  assert.equal(pick.bookingContext, undefined);
  assert.match(pick.answer, /pickup and return dates/);
  const free = await chat.say("November 2 to November 5");
  assert.deepEqual(ids(free), [6]);
  assert.equal(free.bookingContext?.endDate, "2026-11-05");
});

/* ===== no-result handling ===== */

test("no SUV free: honest message plus real alternatives", async () => {
  const reply = await new FakeBrowser().say("I need an SUV in Dhaka from December 1 to December 5");
  assert.match(reply.answer, /No SUV is available in Dhaka/);
  assert.ok(reply.vehicles.length > 0);
  assert.ok(reply.vehicles.every((v) => v.type !== "SUV"));
});

test("no vehicles in a city: points to other cities that do have vehicles", async () => {
  const reply = await new FakeBrowser().say("I need a car in Rangpur from November 10 to November 12");
  noCards(reply);
  assert.match(reply.answer, /No vehicles are available in Rangpur/);
  assert.match(reply.answer, /Dhaka \(\d\)/);
  assert.match(reply.answer, /Chattogram \(\d\)/);
});

test("switching city after an empty result searches again", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need a car in Rangpur from November 10 to November 12");
  const reply = await chat.say("Chattogram");
  assert.deepEqual(ids(reply), [7, 6]);
});

/* ===== dates: ambiguity and invalid input ===== */

test("ambiguous numeric date is not guessed", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka on 3/11/2026");
  noCards(reply);
  assert.match(reply.answer, /day\/month or month\/day/);
  assert.equal(reply.conversationState.slots.startDate, undefined);
});

test("past date is rejected", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka on 2026-10-01");
  noCards(reply);
  assert.match(reply.answer, /in the past/);
});

test("return before pickup is rejected", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka from November 5 to November 2");
  noCards(reply);
  assert.match(reply.answer, /before the pickup/);
});

test("impossible date is rejected", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka on November 31");
  noCards(reply);
  assert.match(reply.answer, /valid calendar date/);
});

test("vague 'next week' asks for an exact date", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka next week");
  noCards(reply);
  assert.match(reply.answer, /exact date/);
});

test("'tomorrow and the next two days'", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka tomorrow and the next two days");
  assert.equal(reply.conversationState.slots.startDate, "2026-10-28");
  assert.equal(reply.conversationState.slots.endDate, "2026-10-30");
});

test("'for three days from tomorrow'", async () => {
  const reply = await new FakeBrowser().say("I need a car in Dhaka for three days from tomorrow");
  assert.equal(reply.conversationState.slots.startDate, "2026-10-28");
  assert.equal(reply.conversationState.slots.endDate, "2026-10-30");
});

/* ===== misc ===== */

test("FAQ answers stay deterministic", async () => {
  const reply = await new FakeBrowser().say("Do you rent motorcycles?");
  assert.equal(reply.intent, "faq");
  noCards(reply);
  assert.match(reply.answer, /does not offer motorcycles/);
});

test("greeting does not start a search or show cards", async () => {
  const reply = await new FakeBrowser().say("hello");
  assert.equal(reply.intent, "greeting");
  noCards(reply);
});

test("unknown question is answered honestly without inventing facts", async () => {
  const reply = await new FakeBrowser().say("What is the weather in Dhaka?");
  assert.equal(reply.intent, "knowledge");
  noCards(reply);
  assert.match(reply.answer, /don’t have verified information/);
});

test("non-English messages get the beta notice", async () => {
  const reply = await new FakeBrowser().say("ami gari chai");
  assert.equal(reply.intent, "non_english");
  assert.match(reply.answer, /English/);
});

test("empty message is refused", async () => {
  const reply = await new FakeBrowser().say("   ");
  assert.equal(reply.intent, "empty");
});

test("'start over' clears everything", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need an SUV in Dhaka from November 2 to November 5");
  const reply = await chat.say("start over");
  assert.equal(reply.intent, "restart");
  // The state travels as JSON, which drops undefined keys.
  assert.deepEqual(JSON.parse(JSON.stringify(reply.conversationState)), { slots: {} });
});

/* ===== reload / stateless server ===== */

test("RELOAD: a new browser session starts completely fresh", async () => {
  const before = new FakeBrowser();
  await before.say("I need an SUV in Dhaka");
  await before.say("for five people");
  assert.equal(before.state?.slots.city, "Dhaka");

  // Reload = the old React state is gone, the new page sends no state.
  const after = new FakeBrowser();
  const reply = await after.say("From November 2 to November 5");
  noCards(reply);
  assert.equal(reply.conversationState.slots.city, undefined);
  assert.equal(reply.conversationState.slots.vehicleType, undefined);
  assert.equal(reply.conversationState.slots.passengers, undefined);
  assert.match(reply.answer, /city/i);
});

test("server keeps no hidden memory between identical requests", async () => {
  const a = await getRentwiseChatResponse("I need a car in Dhaka", undefined, deps);
  const b = await getRentwiseChatResponse("From November 2 to November 5", undefined, deps);
  assert.equal(a.conversationState.slots.city, "Dhaka");
  assert.equal(b.conversationState.slots.city, undefined);
});

test("untrusted state from the browser is sanitised", async () => {
  const reply = await getRentwiseChatResponse(
    "I need a car",
    {
      slots: { city: "Atlantis", startDate: "2026-13-45", passengers: -4, vehicleType: "Rocket", budget: "free" },
      awaiting: "hack",
      lastResultIds: ["1; DROP TABLE", 2, 3.5],
    },
    deps,
  );
  assert.equal(reply.conversationState.slots.city, undefined);
  assert.equal(reply.conversationState.slots.startDate, undefined);
  assert.equal(reply.conversationState.slots.passengers, undefined);
  assert.equal(reply.conversationState.slots.vehicleType, undefined);
});

test("database failure gives a friendly message, not a stack trace", async () => {
  const broken: ChatDeps = {
    ...deps,
    repo: { ...repo, searchAvailable: async () => { throw new Error("connection refused 10.0.0.5"); } },
  };
  const reply = await getRentwiseChatResponse("I need a car in Dhaka from November 2 to November 5", undefined, broken);
  assert.match(reply.answer, /couldn't check the live vehicle data/);
  assert.doesNotMatch(reply.answer, /10\.0\.0\.5|connection/);
});


/* ===== regressions found while probing ===== */

test("'cancel my booking' gets the cancellation answer", async () => {
  const reply = await new FakeBrowser().say("cancel my booking");
  assert.equal(reply.intent, "faq");
  assert.match(reply.answer, /cancel option/);
});

test("'What cars do you have in Dhaka?' is a live search, not a fixed FAQ", async () => {
  const reply = await new FakeBrowser().say("What cars do you have in Dhaka?");
  assert.equal(reply.intent, "availability_search");
  assert.equal(reply.conversationState.slots.city, "Dhaka");
});

test("'van' means HiAce", async () => {
  const reply = await new FakeBrowser().say("I need a van in Rangpur");
  assert.equal(reply.conversationState.slots.vehicleType, "HiAce");
});

test("'book this' with several cards asks which one", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need a car in Dhaka from November 2 to November 5");
  const reply = await chat.say("book this");
  assert.equal(reply.intent, "select_vehicle");
  noCards(reply);
  assert.match(reply.answer, /Which one/);
});

test("'book this' with one card picks it", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need an SUV in Dhaka from November 2 to November 5");
  const reply = await chat.say("book this");
  assert.deepEqual(ids(reply), [5]);
});

test("after an FAQ the old cards can no longer be picked", async () => {
  const chat = new FakeBrowser();
  await chat.say("I need a car in Dhaka from November 2 to November 5");
  await chat.say("What is Rentwise?");
  const reply = await chat.say("book the second one");
  assert.equal(reply.intent, "select_vehicle");
  noCards(reply);
  assert.match(reply.answer, /don't have a vehicle list/);
});

test("'what is your name' introduces the assistant", async () => {
  const reply = await new FakeBrowser().say("what is your name");
  assert.equal(reply.intent, "project_info");
  assert.match(reply.answer, /Rentwise virtual assistant/);
});

/* ---------- run ---------- */

let failed = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`  ✔ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✘ ${name}`);
    console.log(`      ${error instanceof Error ? error.message.split("\n").join("\n      ") : String(error)}`);
  }
}

console.log(`\n${tests.length - failed} passed, ${failed} failed, ${tests.length} total`);
process.exitCode = failed > 0 ? 1 : 0;

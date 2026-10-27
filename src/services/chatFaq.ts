/**
 * Rentwise chatbot — fixed answers.
 *
 * Project information, FAQ and "how does booking work" replies are written
 * once here so they are always consistent and never invented by the LLM.
 * Nothing in this file touches the database.
 */

import type { IntentName } from "./chatIntent.js";

export const NON_ENGLISH_MESSAGE =
  "Sorry, I’m only trained to understand and answer English questions in this beta version of Rentwise. Please ask your question in English, and I’ll do my best to help.";

export const UNKNOWN_MESSAGE =
  "I don’t have verified information to answer that yet. I can help you find and compare vehicles, check availability, or explain how Rentwise and booking work. For anything else, please contact a Rentwise administrator.";

export interface FaqAnswer {
  intent: IntentName;
  text: string;
}

/**
 * Beta language policy: answer English questions only.
 * Non-Latin scripts and common romanised Bangla/Hindi/Spanish/French/German/
 * Portuguese phrases are rejected politely instead of being misunderstood.
 */
export function isEnglishMessage(question: string): boolean {
  const text = question.trim();
  if (!text) return true;

  const letters = Array.from(text).filter((character) => /\p{L}/u.test(character));
  if (letters.some((character) => !/\p{Script=Latin}/u.test(character))) {
    return false;
  }

  const normalized = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const nonEnglishMarkers = [
    /\b(ami|amar|amr|apni|apnar|tumi|tomar|kemon|kothay|kokhon|kobe|kalke|porshu|gari|garir|gari\s+pawa|pawa\s+jabe|ache|ase|nai|hobe|chai|lagbe|korbo|koro|kivabe|ki\s+ki|koto|keno|bhalo|valo|dhonnobad|bhai|malik|banayche|banieche|kon\s+gari)\b/i,
    /\b(hola|buenos dias|buenas noches|necesito|quiero|cuales|cuanto|gracias|por favor|donde esta)\b/i,
    /\b(bonjour|bonsoir|merci|s il vous plait|je voudrais|qu est ce|ou est|combien)\b/i,
    /\b(ol[aá]|obrigado|obrigada|preciso|quero|quanto custa)\b/i,
    /\b(hallo|guten tag|danke|bitte|ich brauche|wie viel|wo ist)\b/i,
    /\b(namaste|kripya|chahiye|kitna|kitne|kahan|kaise|mujhe|mera|meri|hai|hain|kal kya|gaadi)\b/i,
  ];

  return !nonEnglishMarkers.some((pattern) => pattern.test(normalized));
}

const OVERVIEW =
  "Rentwise is a web-based vehicle rental management system built as an academic project. Customers can search vehicles by city, dates and preferences, compare daily prices, book online and manage their bookings from their profile, while administrators manage vehicles, maintenance, customers and bookings. It currently offers Car, SUV and HiAce vehicles in Dhaka, Rangpur and Chattogram.";

const SERVICES =
  "With Rentwise you can:\n• search vehicles by city, dates, type, seats, AC and budget\n• compare daily rental prices\n• book a vehicle online and view your booking history in your profile\n• cancel an eligible booking\n\nVehicles: Car, SUV and HiAce. Cities: Dhaka, Rangpur and Chattogram. Tell me what you need and I’ll check live availability.";

const HOW_IT_WORKS =
  "Here is how Rentwise works:\n1. Choose a city, pickup date and return date (and optionally vehicle type).\n2. Browse the vehicles available for those dates.\n3. Pick a vehicle and log in or create an account.\n4. Enter your pickup point and confirm the booking.\n5. Track or cancel an eligible booking from your profile.\n\nI can start the search for you. Which city and dates do you need?";

const BOOKING_INFO =
  "To book a vehicle: search by city and dates, choose a vehicle and tap “Book This” (or Book on the vehicle page). You’ll log in or create an account, enter your pickup point and confirm. Availability is checked again when you submit.\n\nI can’t create a booking myself, and a booking only exists once the booking page confirms it. Want me to find vehicles first? Tell me your city and dates.";

const ASSISTANT_INTRO =
  "I’m the Rentwise virtual assistant. I can find available vehicles for your dates, compare daily prices, and explain how booking works. What do you need?";

const OWNER =
  "Rentwise is our academic defense project, titled “Design and Implementation of a Web-Based Vehicle Rental Management System.” It was developed by Team 2: Md. Abdul Aual, Jannatul Hafsa Mim, Moriom Akter, and Asma Banu.";

const matches = (text: string, pattern: RegExp): boolean => pattern.test(text);

/** `lower` must already be lower-cased. Returns null when no fixed answer applies. */
export function answerFaq(lower: string): FaqAnswer | null {
  if (
    matches(
      lower,
      /\bwho (?:is|are) (?:the )?(?:owner|founder|creator|developer)s?\b|\bwho (?:owns|made|created|developed|built) rentwise\b|\b(?:owner|founder|creator|developer)s? of rentwise\b/,
    )
  ) {
    return { intent: "faq", text: OWNER };
  }

  if (matches(lower, /\bwho are you\b|\bwhat(?:'s| is) your name\b|\bare you (?:a )?(?:bot|human|robot|ai)\b/)) {
    return { intent: "project_info", text: ASSISTANT_INTRO };
  }

  if (matches(lower, /\b(?:motorcycles?|motorbikes?|bikes?|scooters?)\b/)) {
    return {
      intent: "faq",
      text: "No, Rentwise currently does not offer motorcycles or bikes. The supported vehicle types are Car, SUV, and HiAce.",
    };
  }

  if (matches(lower, /\b(?:which|what) cities\b|\bsupported cities\b|\bcities (?:does|do) (?:rentwise|you)\b|\bservice areas?\b|\bwhere do you operate\b/)) {
    return { intent: "faq", text: "Rentwise currently supports Dhaka, Rangpur, and Chattogram." };
  }

  if (
    matches(
      lower,
      /\bvehicle types?\b|\btypes? of (?:vehicles?|cars?)\b|\bwhat (?:kinds?|types?) of (?:vehicles?|cars?)\b|\b(?:what|which) (?:vehicles?|cars?) (?:do you|does rentwise) (?:offer|provide)\b|\b(?:vehicles?|cars?) do you (?:offer|provide)\b/,
    )
  ) {
    return {
      intent: "faq",
      text: "Rentwise currently supports Car, SUV, and HiAce vehicles. Tell me your city and dates and I’ll show what is actually available.",
    };
  }

  if (
    matches(
      lower,
      /\bwhat (?:is|'s|are) rentwise\b|\b(?:tell|explain)(?: me)?(?: more)? about rentwise\b|\babout rentwise\b|\bwhat (?:is|are) (?:this|the) (?:site|website|app|platform|service|project)\b|\bwhat do you do\b|\brentwise project\b|\bproject overview\b/,
    )
  ) {
    return { intent: "project_info", text: OVERVIEW };
  }

  if (
    matches(
      lower,
      /\bwhat (?:services|features)\b|\b(?:services|features) (?:do )?(?:you|rentwise) (?:offer|provide|have)\b|\bwhat (?:do|can) (?:you|rentwise) (?:offer|provide|do)\b|\bwhat can i do here\b/,
    )
  ) {
    return { intent: "project_info", text: SERVICES };
  }

  if (
    matches(
      lower,
      /\bhow (?:does|do) (?:rentwise|this (?:site|website|app|platform|service)|the (?:site|website|system)|it) work\b|\bhow (?:rentwise|it) works\b/,
    )
  ) {
    return { intent: "project_info", text: HOW_IT_WORKS };
  }

  if (
    matches(
      lower,
      /\bhow (?:do|can|could|should|would) (?:i|we|one) (?:book|reserve|rent|hire|make a booking)\b|\bhow (?:to|does) (?:book|booking|reserve|rent|hire)\b|\bbooking (?:process|steps|procedure|works?)\b|\b(?:steps|procedure|process) (?:to|for|of) (?:book|booking|renting|hiring)\b|\bcan (?:i|we) book (?:this|that|it)\b/,
    )
  ) {
    return { intent: "booking_info", text: BOOKING_INFO };
  }

  if (matches(lower, /\b(?:cancel|cancellation)\b/)) {
    return {
      intent: "faq",
      text: "Open the bookings section in your Profile and use the cancel option on an eligible booking with Booked status. Completed or already cancelled bookings can’t be cancelled. Please confirm any refund policy with a Rentwise administrator.",
    };
  }

  if (matches(lower, /\b(?:my|view|see|check|show) (?:my )?(?:bookings?|booking history|reservations?)\b/) && !/\b(?:car|vehicle|suv|hiace)s?\b/.test(lower)) {
    return {
      intent: "faq",
      text: "After you log in, your bookings and booking history are in your Profile page. I can’t see account data from this chat.",
    };
  }

  if (matches(lower, /\b(?:payment methods?|how to pay|how (?:do|can) i pay|payment|refunds?|advance payment)\b/)) {
    return {
      intent: "faq",
      text: "I don’t have verified information about payment methods, advance payments, or refunds. Please confirm these with a Rentwise administrator rather than relying on an unverified answer.",
    };
  }

  if (matches(lower, /\b(?:contact|phone number|email address|customer support|support number)\b/)) {
    return {
      intent: "faq",
      text: "I don’t have a verified Rentwise phone number or email address. Please contact a Rentwise administrator for the correct contact details.",
    };
  }

  if (matches(lower, /\b(?:under maintenance|maintenance)\b/)) {
    return {
      intent: "faq",
      text: "Vehicles marked as under maintenance are left out of availability results. Administrators manage vehicle maintenance.",
    };
  }

  if (matches(lower, /\bbooking status(?:es)?\b|\bstatus of (?:a |my )?booking\b/)) {
    return { intent: "faq", text: "Rentwise booking statuses are Booked, Cancelled, and Completed." };
  }

  if (matches(lower, /\b(?:opening hours|business hours|office hours)\b/)) {
    return {
      intent: "faq",
      text: "I don’t have verified information about Rentwise’s office hours. Please confirm with an administrator.",
    };
  }

  return null;
}

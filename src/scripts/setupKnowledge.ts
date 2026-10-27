
import { pool } from "../config/db.js";

const setupKnowledge = async () => {
  try {
    console.log("Starting Rentwise knowledge setup...");

    await pool.query("BEGIN");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        embedding JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (title, category)
      );
    `);

    const entries = [
      {
        title: "Rentwise Overview",
        category: "general",
        content:
          "Rentwise is a web-based vehicle rental management system with customer accounts, vehicle search, bookings, booking history, cancellation, vehicle management, maintenance scheduling and administrator management.",
      },
      {
        title: "Supported Vehicle Types",
        category: "vehicle",
        content:
          "Rentwise supports car, SUV and HiAce vehicle types.",
      },
      {
        title: "Supported Cities",
        category: "vehicle",
        content:
          "Rentwise supports Dhaka, Rangpur and Chattogram.",
      },
      {
        title: "Rental Price Calculation",
        category: "booking",
        content:
          "Rental duration uses inclusive dates. A booking from the 20th to the 22nd counts as three days. Total rent is daily rental price multiplied by rental days.",
      },
      {
        title: "Booking Date Rules",
        category: "booking",
        content:
          "Booking dates use YYYY-MM-DD format. The end date cannot be earlier than the start date. The backend validates dates and checks for conflicting bookings.",
      },
      {
        title: "Vehicle Availability",
        category: "vehicle",
        content:
          "Vehicles under maintenance are excluded from normal vehicle search. Existing Booked reservations can make a vehicle unavailable for overlapping dates.",
      },
      {
        title: "Booking Cancellation",
        category: "booking",
        content:
          "Customers can cancel their own eligible bookings when the status is Booked. Cancelled and Completed bookings cannot be cancelled through this customer cancellation action.",
      },
      {
        title: "Vehicle Maintenance",
        category: "vehicle",
        content:
          "Vehicle maintenance is managed by administrators. Vehicles under maintenance are excluded from normal available vehicle search.",
      },
    ];

    for (const entry of entries) {
      await pool.query(
        `
          INSERT INTO "KnowledgeChunk" (title, category, content)
          VALUES ($1, $2, $3)
          ON CONFLICT (title, category)
          DO UPDATE SET
            content = EXCLUDED.content,
            updated_at = NOW();
        `,
        [entry.title, entry.category, entry.content]
      );
    }

    await pool.query("COMMIT");

    const result = await pool.query(`
      SELECT id, title, category
      FROM "KnowledgeChunk"
      ORDER BY id;
    `);

    console.log("KnowledgeChunk setup successful!");
    console.table(result.rows);
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error("Knowledge setup failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

setupKnowledge();

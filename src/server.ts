
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

import initDB from "./config/db.js";
import adminRoutes from "./routes/adminRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import vehicleRoutes from "./routes/vechicleRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";

dotenv.config();

const app = express();

// =========================
// MIDDLEWARE
// =========================

app.use(cors());
app.use(express.json());

// =========================
// SERVE UPLOADED IMAGES
// =========================

app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"))
);

// =========================
// API ROUTES
// =========================

app.use("/api/admin", adminRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/vehicle", vehicleRoutes);
app.use("/api/booking", bookingRoutes);

// Rentwise AI Chatbot API
app.use("/api/chat", chatRoutes);

// =========================
// HOME ROUTE
// =========================

app.get("/", (req, res) => {
  res.send("🚀 Defense Project Backend is Alive!");
});

// =========================
// START SERVER
// =========================

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);

  try {
    await initDB();
    console.log("✅ Database initialized successfully");
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
  }
});

import { Router } from "express";
import type { Request, Response } from "express";
import {
  getRentwiseChatResponse,
  MAX_MESSAGE_LENGTH,
} from "../services/ragService.js";

const router = Router();

/**
 * POST /api/chat
 * Body: { question: string, conversationState?: object }
 *
 * The server keeps no conversation memory. The browser sends back the
 * `conversationState` it received in the previous reply, so a page reload
 * (which empties the browser's memory) starts a completely fresh chat.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { question, conversationState } = req.body ?? {};

    if (typeof question !== "string" || !question.trim()) {
      res.status(400).json({
        success: false,
        message: "Please type a message.",
      });
      return;
    }

    if (question.trim().length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({
        success: false,
        message: `Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`,
      });
      return;
    }

    const result = await getRentwiseChatResponse(
      question.trim(),
      conversationState,
    );

    res.status(200).json({
      success: true,
      question: question.trim(),
      answer: result.answer,
      vehicles: result.vehicles,
      bookingContext: result.bookingContext,
      resultsMode: result.resultsMode,
      conversationState: result.conversationState,
      intent: result.intent,
    });
  } catch (error) {
    console.error("CHAT API ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Unable to process your question right now.",
    });
  }
});

export default router;

/**
 * ReceiptNest Cloud Functions
 *
 * Main entry point for all Firebase Cloud Functions.
 * Handles receipt processing with Document AI and Gemini.
 */

// Load environment variables from .env file (for local development)
import * as dotenv from "dotenv";
dotenv.config();

import { setGlobalOptions } from "firebase-functions";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp();

// Set global options for cost control
setGlobalOptions({ maxInstances: 10 });

// Export all functions
export { processReceipt, generateReceiptNote } from "./receipt-processor";
export { createCheckoutSession, createPortalSession, stripeWebhook } from "./billing";
export { generateAiInsights } from "./ai-insights";
export { sendTestEmail } from "./admin";
export { sendVerificationEmail, sendWelcomeEmail } from "./email";

/**
 * AI Insights Cloud Function
 *
 * Uses Gemini 2.0 Flash to analyze user expense data and provide
 * personalized financial insights and answer questions.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { VertexAI } from "@google-cloud/vertexai";

// Configuration
const PROJECT_ID = process.env.GCLOUD_PROJECT || "receipt-nest";
const VERTEX_LOCATION = "us-central1";

// Types
interface InsightData {
  totalSpend: number;
  receiptCount: number;
  monthLabel: string;
  topCategories: { name: string; total: number; percentage: number }[];
  dailyAverage: number;
  highestSpendDay: { day: number; amount: number } | null;
  monthOverMonthChange: { percent: number; isIncrease: boolean } | null;
  receipts: {
    merchant: string;
    amount: number;
    date: string;
    category: string;
  }[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface InsightsRequest {
  type: "initial_insights" | "chat";
  data: InsightData;
  message?: string;
  history?: ChatMessage[];
}

/**
 * Format currency for display in prompts
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Build context string from expense data
 */
function buildExpenseContext(data: InsightData): string {
  const parts: string[] = [];

  parts.push(`## Monthly Expense Summary for ${data.monthLabel}`);
  parts.push(`- **Total Spending**: ${formatCurrency(data.totalSpend)}`);
  parts.push(`- **Number of Receipts**: ${data.receiptCount}`);
  parts.push(`- **Daily Average** (on days with spending): ${formatCurrency(data.dailyAverage)}`);

  if (data.highestSpendDay) {
    parts.push(`- **Highest Spending Day**: Day ${data.highestSpendDay.day} (${formatCurrency(data.highestSpendDay.amount)})`);
  }

  if (data.monthOverMonthChange) {
    const direction = data.monthOverMonthChange.isIncrease ? "up" : "down";
    parts.push(`- **vs Last Month**: ${data.monthOverMonthChange.percent}% ${direction}`);
  }

  if (data.topCategories.length > 0) {
    parts.push("\n## Spending by Category");
    for (const cat of data.topCategories) {
      parts.push(`- **${cat.name}**: ${formatCurrency(cat.total)} (${cat.percentage}%)`);
    }
  }

  if (data.receipts.length > 0) {
    parts.push("\n## Recent Transactions (up to 20)");
    const recentReceipts = data.receipts.slice(0, 20);
    for (const receipt of recentReceipts) {
      parts.push(`- ${receipt.merchant}: ${formatCurrency(receipt.amount)} on ${receipt.date} (${receipt.category})`);
    }
  }

  return parts.join("\n");
}

/**
 * Generate initial insights based on expense data
 */
async function generateInitialInsights(data: InsightData): Promise<string[]> {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: VERTEX_LOCATION,
  });

  const model = vertexAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  });

  const context = buildExpenseContext(data);

  const prompt = `You are a friendly and helpful personal finance AI assistant. Analyze the following expense data and provide 3-4 personalized, actionable insights.

${context}

IMPORTANT GUIDELINES:
1. Be specific - reference actual numbers, merchants, and categories from the data
2. Be encouraging but honest - celebrate wins but point out areas for improvement
3. Be actionable - give concrete suggestions the user can implement
4. Be concise - each insight should be 1-2 sentences max
5. Use a conversational, friendly tone
6. If spending is high in a category, suggest specific ways to reduce it
7. If there's month-over-month improvement, acknowledge it positively
8. Look for patterns (frequent small purchases, weekend spending, etc.)

Return a JSON object with this structure:
{
  "insights": [
    "First insight here...",
    "Second insight here...",
    "Third insight here...",
    "Fourth insight here (optional)..."
  ]
}

Focus on being helpful and providing value. Do NOT be generic - make each insight specific to THIS user's data.`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

    logger.info("Gemini initial insights response", { text: text.substring(0, 500) });

    const parsed = JSON.parse(text);
    return parsed.insights || [];
  } catch (error) {
    logger.error("Failed to generate initial insights", error);
    throw new HttpsError("internal", "Failed to generate insights");
  }
}

/**
 * Handle chat messages about expenses
 */
async function handleChat(
  message: string,
  history: ChatMessage[],
  data: InsightData
): Promise<string> {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: VERTEX_LOCATION,
  });

  const model = vertexAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });

  const context = buildExpenseContext(data);

  const systemPrompt = `You are a friendly and knowledgeable personal finance AI assistant. You have access to the user's expense data and can answer questions about their spending.

## User's Expense Data
${context}

## Guidelines
1. Answer questions directly and specifically using the data provided
2. Be helpful, encouraging, and non-judgmental
3. Provide actionable advice when appropriate
4. Use specific numbers and percentages from the data
5. Keep responses concise but informative (2-4 sentences typically)
6. If asked about something not in the data, politely explain what information you have access to
7. For savings advice, be realistic and practical
8. Feel free to use simple formatting like bullet points if it helps clarity

Remember: You're helping the user understand and improve their financial habits. Be supportive!`;

  // Build conversation history for context
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  // Add system context as first user message
  contents.push({
    role: "user",
    parts: [{ text: systemPrompt }],
  });
  contents.push({
    role: "model",
    parts: [{ text: "I understand! I'm here to help you analyze your spending and provide personalized financial insights. I have access to your expense data and I'm ready to answer any questions you have about your spending patterns, help you find ways to save money, or provide advice on managing your finances better. What would you like to know?" }],
  });

  // Add conversation history
  for (const msg of history) {
    contents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    });
  }

  // Add current message
  contents.push({
    role: "user",
    parts: [{ text: message }],
  });

  try {
    const result = await model.generateContent({ contents });
    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

    logger.info("Gemini chat response", { messageLength: text.length });

    return text.trim();
  } catch (error) {
    logger.error("Failed to generate chat response", error);
    throw new HttpsError("internal", "Failed to generate response");
  }
}

/**
 * Main Cloud Function - Generate AI Insights
 */
export const generateAiInsights = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
  },
  async (request) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to use AI Insights");
    }

    const userId = request.auth.uid;
    const { type, data, message, history } = request.data as InsightsRequest;

    // Verify user has pro subscription
    const db = admin.firestore();
    const userDoc = await db.doc(`users/${userId}`).get();

    if (!userDoc.exists) {
      throw new HttpsError("not-found", "User profile not found");
    }

    const userData = userDoc.data();
    const subscriptionPlan = userData?.subscriptionPlan || "free";

    if (subscriptionPlan !== "pro") {
      throw new HttpsError(
        "permission-denied",
        "AI Insights is a Pro feature. Please upgrade your plan to access this feature."
      );
    }

    logger.info("Processing AI Insights request", { type, userId });

    try {
      if (type === "initial_insights") {
        const insights = await generateInitialInsights(data);
        return { insights };
      } else if (type === "chat") {
        if (!message) {
          throw new HttpsError("invalid-argument", "Message is required for chat");
        }
        const response = await handleChat(message, history || [], data);
        return { response };
      } else {
        throw new HttpsError("invalid-argument", "Invalid request type");
      }
    } catch (error: any) {
      logger.error("AI Insights error", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Failed to process AI request");
    }
  }
);

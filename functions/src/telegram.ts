/**
 * Telegram Bot Integration for ReceiptNest
 *
 * Handles:
 * 1. Account linking via deep-link tokens
 * 2. AI chat (synced with web app's AI Insights)
 * 3. Receipt upload via photo messages
 */

import { onRequest } from "firebase-functions/v2/https";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

import {
  InsightData,
  ChatMessage,
  handleChat,
  formatCurrency,
} from "./ai-insights";

// ─── Secrets & Configuration ────────────────────────────────────────────────

const telegramBotToken = defineSecret("TELEGRAM_BOT_TOKEN");

/**
 * Bot username without the @ sign.
 * Update this after creating your bot via @BotFather.
 */
const BOT_USERNAME = "receiptnestbot";

// ─── Telegram API Types ─────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  caption?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramFileResponse {
  ok: boolean;
  result?: { file_id: string; file_unique_id: string; file_path?: string };
}

// ─── Telegram Bot API Helpers ───────────────────────────────────────────────

async function telegramApi(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    logger.error(`Telegram API error (${method})`, data);
  }
  return data;
}

async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  parseMode: "Markdown" | "HTML" | "" = ""
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) {
    body.parse_mode = parseMode;
  }
  await telegramApi(token, "sendMessage", body);
}

async function sendTypingAction(
  token: string,
  chatId: number
): Promise<void> {
  await telegramApi(token, "sendChatAction", {
    chat_id: chatId,
    action: "typing",
  });
}

async function getFileInfo(
  token: string,
  fileId: string
): Promise<TelegramFileResponse> {
  return (await telegramApi(token, "getFile", {
    file_id: fileId,
  })) as TelegramFileResponse;
}

async function downloadTelegramFile(
  token: string,
  filePath: string
): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Firestore Helpers ──────────────────────────────────────────────────────

/**
 * Look up a ReceiptNest user by their Telegram chat ID.
 */
async function findUserByTelegramChatId(
  chatId: number
): Promise<{ userId: string; userData: admin.firestore.DocumentData } | null> {
  const db = admin.firestore();
  const snapshot = await db
    .collection("users")
    .where("telegramChatId", "==", chatId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { userId: doc.id, userData: doc.data() };
}

/**
 * Build InsightData on the server side by reading the user's Firestore data.
 * This mirrors the Angular frontend's prepareInsightData() method.
 */
async function buildServerInsightData(userId: string): Promise<InsightData> {
  const db = admin.firestore();

  // Get all receipts (up to 200)
  const receiptsSnap = await db
    .collection(`users/${userId}/receipts`)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const allReceipts = receiptsSnap.docs.map((d) => d.data());

  // Get monthly summaries
  const summariesSnap = await db
    .collection(`users/${userId}/monthlySummaries`)
    .orderBy(admin.firestore.FieldPath.documentId(), "asc")
    .get();

  const monthlySummaries = summariesSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

  // Current month context
  const now = new Date();
  const targetMonth = now.getMonth();
  const targetYear = now.getFullYear();
  const monthLabel = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Filter receipts for current month
  const currentMonthReceipts = allReceipts.filter((r) => {
    if (r.date) {
      const d = new Date(r.date);
      return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
    }
    if (r.createdAt?.toDate) {
      const d = r.createdAt.toDate();
      return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
    }
    return false;
  });

  const totalSpend = currentMonthReceipts.reduce(
    (sum: number, r: admin.firestore.DocumentData) =>
      sum + (r.totalAmount || 0),
    0
  );

  // Category totals for current month
  const categoryTotals: Record<string, number> = {};
  for (const r of currentMonthReceipts) {
    const cat = r.category?.name || "Other";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (r.totalAmount || 0);
  }

  const topCategories = Object.entries(categoryTotals)
    .map(([name, total]) => ({
      name,
      total,
      percentage: totalSpend > 0 ? Math.round((total / totalSpend) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Daily spending for current month
  const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const dailyTotals: number[] = new Array(daysInMonth).fill(0);

  for (const r of currentMonthReceipts) {
    if (!r.totalAmount) continue;
    let day: number | null = null;
    if (r.date) {
      day = new Date(r.date).getDate();
    } else if (r.createdAt?.toDate) {
      day = r.createdAt.toDate().getDate();
    }
    if (day && day >= 1 && day <= daysInMonth) {
      dailyTotals[day - 1] += r.totalAmount;
    }
  }

  const daysWithSpending = dailyTotals.filter((d) => d > 0).length;
  const dailyAverage = daysWithSpending > 0 ? totalSpend / daysWithSpending : 0;

  let highestSpendDay: { day: number; amount: number } | null = null;
  for (let i = 0; i < dailyTotals.length; i++) {
    if (dailyTotals[i] > (highestSpendDay?.amount || 0)) {
      highestSpendDay = { day: i + 1, amount: dailyTotals[i] };
    }
  }

  // Previous month spend for month-over-month change
  let prevMonth = targetMonth - 1;
  let prevYear = targetYear;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevYear--;
  }

  const prevMonthSpend = allReceipts
    .filter((r) => {
      if (r.date) {
        const d = new Date(r.date);
        return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
      }
      return false;
    })
    .reduce(
      (sum: number, r: admin.firestore.DocumentData) =>
        sum + (r.totalAmount || 0),
      0
    );

  let monthOverMonthChange: { percent: number; isIncrease: boolean } | null =
    null;
  if (prevMonthSpend > 0) {
    const change = ((totalSpend - prevMonthSpend) / prevMonthSpend) * 100;
    monthOverMonthChange = {
      percent: Math.abs(Math.round(change)),
      isIncrease: change > 0,
    };
  }

  // Receipt summaries for current month
  const receiptSummaries = currentMonthReceipts.map((r) => ({
    merchant:
      r.merchant?.canonicalName || r.merchant?.rawName || "Unknown",
    amount: r.totalAmount || 0,
    date: r.date || "",
    category: r.category?.name || "Other",
  }));

  // Monthly summaries data
  const monthlySummariesData = monthlySummaries.map((ms: any) => {
    const categories = Object.values(ms.byCategory || {}) as any[];
    const merchants = Object.values(ms.byMerchant || {}) as any[];
    const total = ms.totalSpend || 0;

    return {
      monthId: ms.id,
      totalSpend: ms.totalSpend || 0,
      receiptCount: ms.receiptCount || 0,
      topCategories: categories
        .map((c: any) => ({
          name: c.categoryName,
          total: c.total,
          percentage:
            total > 0 ? Math.round((c.total / total) * 100) : 0,
        }))
        .sort((a: any, b: any) => b.total - a.total)
        .slice(0, 5),
      topMerchants: merchants
        .map((m: any) => ({
          name: m.merchantName,
          total: m.total,
          percentage:
            total > 0 ? Math.round((m.total / total) * 100) : 0,
        }))
        .sort((a: any, b: any) => b.total - a.total)
        .slice(0, 5),
    };
  });

  // All-time aggregation
  let allTimeTotal = 0;
  let allTimeCount = 0;
  const allCategoryTotals: Record<string, number> = {};
  const allMerchantTotals: Record<string, number> = {};

  for (const ms of monthlySummaries as any[]) {
    allTimeTotal += ms.totalSpend || 0;
    allTimeCount += ms.receiptCount || 0;
    for (const c of Object.values(ms.byCategory || {}) as any[]) {
      allCategoryTotals[c.categoryName] =
        (allCategoryTotals[c.categoryName] || 0) + (c.total || 0);
    }
    for (const m of Object.values(ms.byMerchant || {}) as any[]) {
      allMerchantTotals[m.merchantName] =
        (allMerchantTotals[m.merchantName] || 0) + (m.total || 0);
    }
  }

  // Fallback if no monthly summaries
  if (monthlySummaries.length === 0) {
    for (const r of allReceipts) {
      allTimeTotal += r.totalAmount || 0;
      allTimeCount += 1;
      const cat = r.category?.name || "Other";
      allCategoryTotals[cat] =
        (allCategoryTotals[cat] || 0) + (r.totalAmount || 0);
      const merchant =
        r.merchant?.canonicalName || r.merchant?.rawName || "Unknown";
      allMerchantTotals[merchant] =
        (allMerchantTotals[merchant] || 0) + (r.totalAmount || 0);
    }
  }

  const allTimeTopCategories = Object.entries(allCategoryTotals)
    .map(([name, total]) => ({
      name,
      total,
      percentage:
        allTimeTotal > 0 ? Math.round((total / allTimeTotal) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const allTimeTopMerchants = Object.entries(allMerchantTotals)
    .map(([name, total]) => ({
      name,
      total,
      percentage:
        allTimeTotal > 0 ? Math.round((total / allTimeTotal) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const monthsSorted = [...monthlySummariesData].sort((a, b) =>
    a.monthId.localeCompare(b.monthId)
  );
  const firstMonth =
    monthsSorted.length > 0 ? monthsSorted[0].monthId : null;
  const lastMonth =
    monthsSorted.length > 0
      ? monthsSorted[monthsSorted.length - 1].monthId
      : null;

  const recentReceipts = allReceipts.slice(0, 50).map((r) => ({
    merchant:
      r.merchant?.canonicalName || r.merchant?.rawName || "Unknown",
    amount: r.totalAmount || 0,
    date: r.date || "",
    category: r.category?.name || "Other",
  }));

  return {
    totalSpend,
    receiptCount: currentMonthReceipts.length,
    monthLabel,
    topCategories,
    dailyAverage,
    highestSpendDay,
    monthOverMonthChange,
    receipts: receiptSummaries,
    allTime: {
      totalSpend: allTimeTotal,
      receiptCount: allTimeCount,
      topCategories: allTimeTopCategories,
      topMerchants: allTimeTopMerchants,
      firstMonth,
      lastMonth,
      monthsCount: monthlySummariesData.length,
    },
    monthlySummaries: monthsSorted,
    recentReceipts,
  };
}

// ─── Account Linking Flow ───────────────────────────────────────────────────

async function handleStartCommand(
  token: string,
  message: TelegramMessage,
  linkToken: string
): Promise<void> {
  const chatId = message.chat.id;
  const db = admin.firestore();

  if (!linkToken) {
    await sendTelegramMessage(
      token,
      chatId,
      "Welcome to ReceiptNest Bot! To link your account, please use the QR code or link from the ReceiptNest app.\n\nGo to AI Insights > Connect to Telegram."
    );
    return;
  }

  // Look up the linking token
  const linkRef = db.doc(`telegramLinks/${linkToken}`);
  const linkSnap = await linkRef.get();

  if (!linkSnap.exists) {
    await sendTelegramMessage(
      token,
      chatId,
      "Invalid or expired link token. Please generate a new one from the ReceiptNest app."
    );
    return;
  }

  const linkData = linkSnap.data()!;

  // Check if already used
  if (linkData.used) {
    await sendTelegramMessage(
      token,
      chatId,
      "This link token has already been used. Please generate a new one from the app."
    );
    return;
  }

  // Check expiry
  const expiresAt = linkData.expiresAt?.toDate
    ? linkData.expiresAt.toDate()
    : new Date(linkData.expiresAt);
  if (new Date() > expiresAt) {
    await sendTelegramMessage(
      token,
      chatId,
      "This link token has expired. Please generate a new one from the ReceiptNest app."
    );
    return;
  }

  const userId = linkData.userId;

  // Link the Telegram chat to the user
  await db.doc(`users/${userId}`).update({
    telegramChatId: chatId,
    telegramLinkedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Mark token as used
  await linkRef.update({ used: true });

  const firstName = message.from?.first_name || "there";
  await sendTelegramMessage(
    token,
    chatId,
    `Hi ${firstName}! Your ReceiptNest account is now linked.\n\nYou can:\n- Send me a text message to chat about your expenses\n- Send a photo of a receipt to add it to your account\n- Type /help for more commands`
  );

  logger.info("Telegram account linked", { userId, chatId });
}

// ─── AI Chat Flow ───────────────────────────────────────────────────────────

async function handleTextMessage(
  token: string,
  message: TelegramMessage,
  userId: string
): Promise<void> {
  const chatId = message.chat.id;
  const userText = message.text || "";

  if (!userText.trim()) return;

  await sendTypingAction(token, chatId);

  const db = admin.firestore();

  try {
    // Build expense data server-side
    const insightData = await buildServerInsightData(userId);

    // Load or create a Telegram-specific chat session
    const chatsRef = db.collection(`users/${userId}/aiChats`);
    let telegramChatDoc = await chatsRef
      .where("source", "==", "telegram")
      .orderBy("updatedAt", "desc")
      .limit(1)
      .get();

    let chatDocId: string;
    let history: ChatMessage[] = [];

    if (telegramChatDoc.empty) {
      // Create a new chat session for Telegram
      const newDoc = await chatsRef.add({
        title: "Telegram Chat",
        source: "telegram",
        messages: [],
        messageCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      chatDocId = newDoc.id;
    } else {
      const doc = telegramChatDoc.docs[0];
      chatDocId = doc.id;
      const data = doc.data();
      const storedMessages = data.messages || [];
      history = storedMessages.map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    }

    // Use last 10 messages for context
    const recentHistory = history.slice(-10);

    // Call the shared AI handler
    const aiResponse = await handleChat(userText, recentHistory, insightData);

    // Persist both messages
    const now = new Date().toISOString();
    const userMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      timestamp: now,
    };
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: aiResponse,
      timestamp: now,
    };

    const updatedMessages = [...history.map((m, i) => ({
      id: `hist-${i}`,
      role: m.role,
      content: m.content,
      timestamp: now,
    })), userMsg, assistantMsg];

    // Keep only last 50 messages to avoid document size issues
    const trimmedMessages = updatedMessages.slice(-50);

    await db.doc(`users/${userId}/aiChats/${chatDocId}`).update({
      title: userText.length > 56 ? userText.slice(0, 56) + "..." : userText,
      messages: trimmedMessages,
      messageCount: trimmedMessages.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send AI response back to Telegram
    // Truncate if over Telegram's 4096 character limit
    const responseText =
      aiResponse.length > 4000
        ? aiResponse.slice(0, 4000) + "\n\n(Message truncated)"
        : aiResponse;

    await sendTelegramMessage(token, chatId, responseText);
  } catch (error) {
    logger.error("Error handling Telegram chat message", error);
    await sendTelegramMessage(
      token,
      chatId,
      "Sorry, I encountered an error processing your message. Please try again."
    );
  }
}

// ─── Receipt Upload Flow ────────────────────────────────────────────────────

async function handlePhotoMessage(
  token: string,
  message: TelegramMessage,
  userId: string
): Promise<void> {
  const chatId = message.chat.id;
  const photos = message.photo;

  if (!photos || photos.length === 0) {
    await sendTelegramMessage(
      token,
      chatId,
      "I couldn't detect a photo in your message. Please try sending it again."
    );
    return;
  }

  await sendTelegramMessage(
    token,
    chatId,
    "Receipt received! Processing..."
  );

  try {
    // Get the largest photo (last in the array)
    const largestPhoto = photos[photos.length - 1];

    // Get file info from Telegram
    const fileInfo = await getFileInfo(token, largestPhoto.file_id);
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      throw new Error("Failed to get file info from Telegram");
    }

    // Download the file
    const fileBuffer = await downloadTelegramFile(
      token,
      fileInfo.result.file_path
    );

    // Determine mime type from file path
    const filePath = fileInfo.result.file_path;
    let mimeType = "image/jpeg";
    if (filePath.endsWith(".png")) mimeType = "image/png";
    else if (filePath.endsWith(".webp")) mimeType = "image/webp";

    // Upload to Firebase Storage
    const timestamp = Date.now();
    const fileName = `telegram_receipt_${timestamp}.jpg`;
    const storagePath = `users/${userId}/receipts/${timestamp}_${fileName}`;

    const bucket = admin.storage().bucket();
    const storageFile = bucket.file(storagePath);
    await storageFile.save(fileBuffer, {
      metadata: { contentType: mimeType },
    });

    // Create receipt document in Firestore (triggers processReceipt)
    const db = admin.firestore();
    const receiptRef = await db
      .collection(`users/${userId}/receipts`)
      .add({
        userId,
        status: "uploaded",
        file: {
          storagePath,
          originalName: fileName,
          mimeType,
          sizeBytes: fileBuffer.length,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        source: "telegram",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Update with document ID
    await receiptRef.update({ id: receiptRef.id });

    await sendTelegramMessage(
      token,
      chatId,
      "Your receipt has been uploaded and is being processed. You'll see it in the app shortly!"
    );

    logger.info("Receipt uploaded via Telegram", {
      userId,
      receiptId: receiptRef.id,
      fileSize: fileBuffer.length,
    });
  } catch (error) {
    logger.error("Error handling Telegram photo upload", error);
    await sendTelegramMessage(
      token,
      chatId,
      "Sorry, I had trouble processing that receipt. Please try again or upload it through the app."
    );
  }
}

async function handleDocumentMessage(
  token: string,
  message: TelegramMessage,
  userId: string
): Promise<void> {
  const chatId = message.chat.id;
  const document = message.document;

  if (!document) return;

  // Check if it's an image or PDF
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
  ];

  if (document.mime_type && !allowedTypes.includes(document.mime_type)) {
    await sendTelegramMessage(
      token,
      chatId,
      "Sorry, I can only process images (JPEG, PNG, WebP) and PDF files. Please send a supported file type."
    );
    return;
  }

  // Check file size (10MB limit)
  if (document.file_size && document.file_size > 10 * 1024 * 1024) {
    await sendTelegramMessage(
      token,
      chatId,
      "That file is too large. Please send a file under 10MB."
    );
    return;
  }

  await sendTelegramMessage(
    token,
    chatId,
    "Receipt document received! Processing..."
  );

  try {
    const fileInfo = await getFileInfo(token, document.file_id);
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      throw new Error("Failed to get file info from Telegram");
    }

    const fileBuffer = await downloadTelegramFile(
      token,
      fileInfo.result.file_path
    );

    const mimeType = document.mime_type || "image/jpeg";
    const timestamp = Date.now();
    const originalName = document.file_name || `telegram_receipt_${timestamp}`;
    const storagePath = `users/${userId}/receipts/${timestamp}_${originalName.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    const bucket = admin.storage().bucket();
    const storageFile = bucket.file(storagePath);
    await storageFile.save(fileBuffer, {
      metadata: { contentType: mimeType },
    });

    const db = admin.firestore();
    const receiptRef = await db
      .collection(`users/${userId}/receipts`)
      .add({
        userId,
        status: "uploaded",
        file: {
          storagePath,
          originalName,
          mimeType,
          sizeBytes: fileBuffer.length,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        source: "telegram",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    await receiptRef.update({ id: receiptRef.id });

    await sendTelegramMessage(
      token,
      chatId,
      "Your receipt has been uploaded and is being processed. You'll see it in the app shortly!"
    );

    logger.info("Receipt document uploaded via Telegram", {
      userId,
      receiptId: receiptRef.id,
      fileName: originalName,
      fileSize: fileBuffer.length,
    });
  } catch (error) {
    logger.error("Error handling Telegram document upload", error);
    await sendTelegramMessage(
      token,
      chatId,
      "Sorry, I had trouble processing that file. Please try again or upload it through the app."
    );
  }
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function handleHelpCommand(
  token: string,
  chatId: number
): Promise<void> {
  await sendTelegramMessage(
    token,
    chatId,
    "Here's what I can do:\n\n" +
    "- Send a text message to chat about your expenses and get AI insights\n" +
    "- Send a photo or PDF of a receipt to add it to your account\n" +
    "- /help - Show this help message\n" +
    "- /status - Check your account status\n" +
    "- /unlink - Disconnect your Telegram from ReceiptNest"
  );
}

async function handleStatusCommand(
  token: string,
  chatId: number,
  userId: string
): Promise<void> {
  try {
    const insightData = await buildServerInsightData(userId);
    const statusMsg =
      `Your ReceiptNest Account:\n\n` +
      `Current Month: ${insightData.monthLabel}\n` +
      `Receipts This Month: ${insightData.receiptCount}\n` +
      `Spending This Month: ${formatCurrency(insightData.totalSpend)}\n` +
      `All-Time Receipts: ${insightData.allTime.receiptCount}\n` +
      `All-Time Spending: ${formatCurrency(insightData.allTime.totalSpend)}`;

    await sendTelegramMessage(token, chatId, statusMsg);
  } catch (error) {
    logger.error("Error handling status command", error);
    await sendTelegramMessage(
      token,
      chatId,
      "Sorry, I couldn't retrieve your account status right now."
    );
  }
}

async function handleUnlinkCommand(
  token: string,
  message: TelegramMessage,
  userId: string
): Promise<void> {
  const chatId = message.chat.id;
  const db = admin.firestore();

  await db.doc(`users/${userId}`).update({
    telegramChatId: admin.firestore.FieldValue.delete(),
    telegramLinkedAt: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await sendTelegramMessage(
    token,
    chatId,
    "Your Telegram account has been unlinked from ReceiptNest. You can re-link anytime from the app."
  );

  logger.info("Telegram account unlinked", { userId, chatId });
}

// ─── Main Webhook Handler ───────────────────────────────────────────────────

export const telegramWebhook = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    secrets: [telegramBotToken],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const token = telegramBotToken.value();
    if (!token) {
      logger.error("TELEGRAM_BOT_TOKEN secret is not set");
      res.status(500).send("Bot not configured");
      return;
    }

    const update: TelegramUpdate = req.body;

    if (!update.message) {
      // Could be an edited_message, callback_query, etc. -- ignore for now.
      res.status(200).send("OK");
      return;
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || "";

    try {
      // Handle /start command (account linking)
      if (text.startsWith("/start")) {
        const parts = text.split(" ");
        const linkToken = parts.length > 1 ? parts[1] : "";
        await handleStartCommand(token, message, linkToken);
        res.status(200).send("OK");
        return;
      }

      // For all other commands/messages, user must be linked
      const userResult = await findUserByTelegramChatId(chatId);

      if (!userResult) {
        await sendTelegramMessage(
          token,
          chatId,
          "Your Telegram account is not linked to ReceiptNest yet.\n\nTo get started, open the ReceiptNest app, go to AI Insights, and click 'Connect to Telegram'."
        );
        res.status(200).send("OK");
        return;
      }

      const { userId } = userResult;

      // Handle commands
      if (text === "/help") {
        await handleHelpCommand(token, chatId);
      } else if (text === "/status") {
        await handleStatusCommand(token, chatId, userId);
      } else if (text === "/unlink") {
        await handleUnlinkCommand(token, message, userId);
      } else if (message.photo && message.photo.length > 0) {
        // Photo message --> receipt upload
        await handlePhotoMessage(token, message, userId);
      } else if (message.document) {
        // Document message --> receipt upload (PDF, etc.)
        await handleDocumentMessage(token, message, userId);
      } else if (text && !text.startsWith("/")) {
        // Regular text --> AI chat
        await handleTextMessage(token, message, userId);
      } else {
        await sendTelegramMessage(
          token,
          chatId,
          "I didn't understand that command. Type /help for available commands."
        );
      }
    } catch (error) {
      logger.error("Error processing Telegram update", error);
      try {
        await sendTelegramMessage(
          token,
          chatId,
          "Something went wrong. Please try again later."
        );
      } catch {
        // Ignore send failures in error handler
      }
    }

    res.status(200).send("OK");
  }
);

// ─── Generate Telegram Link Token (called from Angular app) ─────────────────

export const generateTelegramLinkToken = onCall(
  {
    region: "us-central1",
    secrets: [telegramBotToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in to link Telegram"
      );
    }

    const userId = request.auth.uid;
    const db = admin.firestore();

    // Generate a unique token
    const linkToken = crypto.randomUUID();

    // Store with 10-minute expiry
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    await db.doc(`telegramLinks/${linkToken}`).set({
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      used: false,
    });

    const deepLink = `https://t.me/${BOT_USERNAME}?start=${linkToken}`;

    logger.info("Generated Telegram link token", { userId, deepLink });

    return {
      deepLink,
      token: linkToken,
      botUsername: BOT_USERNAME,
    };
  }
);

// ─── Setup Telegram Webhook (admin one-time setup) ──────────────────────────

export const setupTelegramWebhook = onCall(
  {
    region: "us-central1",
    secrets: [telegramBotToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    // Verify admin role
    const db = admin.firestore();
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists || userDoc.data()?.role !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Only admins can setup the webhook"
      );
    }

    const token = telegramBotToken.value();
    if (!token) {
      throw new HttpsError("failed-precondition", "Bot token not configured");
    }

    const webhookUrl = `https://us-central1-receipt-nest.cloudfunctions.net/telegramWebhook`;

    const result = await telegramApi(token, "setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message"],
    });

    logger.info("Telegram webhook setup result", result);

    return { success: true, webhookUrl, result };
  }
);

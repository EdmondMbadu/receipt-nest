/** Shared diagnosis and retry policy. No Firebase dependencies so historical receipts are testable. */
export const RECEIPT_STUCK_MS = 10 * 60 * 1000;
export const RECEIPT_MODEL_ID = "gemini-2.5-flash";
export const RECEIPT_PIPELINE_VERSION = "receipt-extraction-v2";
export type IssueKind = "failed" | "stuck" | "incomplete";
export type IssueCause = "service_error" | "file_problem" | "unreadable_image" | "extraction_mistake" | "classification_mistake" | "unknown";
export const ISSUE_CAUSES: IssueCause[] = ["service_error", "file_problem", "unreadable_image", "extraction_mistake", "classification_mistake", "unknown"];

export function millis(value: any): number {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function receiptValues(data: any) {
  return {
    totalAmount: data.totalAmount ?? null, currency: data.currency ?? "",
    date: data.date ?? "", merchant: data.merchant?.canonicalName ?? "",
    category: data.category?.name ?? "",
  };
}

export function missingReceiptFields(data: any): string[] {
  const missing: string[] = [];
  if (typeof data.totalAmount !== "number" || !Number.isFinite(data.totalAmount) || data.totalAmount <= 0) missing.push("total");
  if (!data.currency || !/^[A-Z]{3}$/.test(data.currency)) missing.push("currency");
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || (Number.isNaN(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0, 10) !== data.date)) missing.push("date");
  if (!data.merchant?.canonicalName || data.merchant.canonicalName === "Unknown") missing.push("merchant");
  return missing;
}

export function diagnoseReceipt(data: any, now = Date.now()): { kind: IssueKind; reason: string; recommendation: string; cause: IssueCause } | null {
  if (data.skipProcessing === true) return null;
  if (["uploaded", "processing"].includes(data.status)) {
    const started = millis(data.processingAttempt?.startedAt) || millis(data.updatedAt) || millis(data.createdAt);
    if (started && now - started >= RECEIPT_STUCK_MS) return {
      kind: "stuck", reason: data.status === "uploaded" ? "Processing never started" : "Processing is taking too long",
      recommendation: "Retry processing. If this happens again, inspect the attempt history and file.", cause: "unknown",
    };
    return null;
  }
  if (data.processingAttempt?.state === "failed") return {
    kind: "failed", reason: data.processingAttempt.reason || "Processing failed",
    recommendation: data.processingAttempt.cause === "file_problem" ? "Open the original file. Check its format and readability before retrying." : "Retry processing. Review the technical details if the same error returns.",
    cause: data.processingAttempt.cause || "unknown",
  };
  const missing = missingReceiptFields(data);
  if (["needs_review", "extracted"].includes(data.status) || (data.processingAttempt && missing.length)) return {
    kind: "incomplete", reason: missing.length ? `Missing ${missing.join(", ")}` : "Receipt needs verification",
    recommendation: "Compare the extracted fields with the original. Correct the values, or retry if the receipt is readable.", cause: "unknown",
  };
  return null;
}

/** Errors displayed to admins do not expose provider payloads or document contents. */
export function processingFailure(error: unknown, stage: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (stage === "file" || stage === "conversion") return { cause: "file_problem", reason: stage === "conversion" ? "Image conversion failed" : "The original file could not be opened", code: "file_error" };
  if (/429|quota|resource.exhausted/i.test(message)) return { cause: "service_error", reason: "The extraction service reached its limit", code: "rate_limit" };
  if (/timeout|deadline|503|unavailable|504/i.test(message)) return { cause: "service_error", reason: "The extraction service was unavailable or timed out", code: "service_unavailable" };
  if (/json|empty response|no.*response/i.test(message)) return { cause: "extraction_mistake", reason: "The model returned no usable receipt data", code: "invalid_response" };
  return { cause: "unknown", reason: "Processing failed; the cause needs investigation", code: "processing_error" };
}

/** Preserve edits made during the attempt and pre-existing manual corrections. */
export function mergeRetryValues(initial: any, current: any, proposed: Record<string, any>) {
  const result: Record<string, any> = {};
  const previous: Record<string, any> = {
    totalAmount: initial.extraction?.totalAmount?.value,
    currency: initial.extraction?.currency?.value,
    date: initial.extraction?.date?.value,
    merchant: initial.merchant?.matchedBy === "manual" ? undefined : initial.merchant,
    category: ["user", "manual"].includes(initial.category?.assignedBy) ? undefined : initial.category,
  };
  for (const key of ["totalAmount", "currency", "date", "merchant", "category"]) {
    const unchanged = JSON.stringify(initial[key]) === JSON.stringify(current[key]);
    const empty = current[key] === undefined || current[key] === null || current[key] === "";
    const wasExtracted = JSON.stringify(initial[key]) === JSON.stringify(previous[key]);
    if (proposed[key] !== undefined && unchanged && (empty || wasExtracted)) result[key] = proposed[key];
  }
  return result;
}

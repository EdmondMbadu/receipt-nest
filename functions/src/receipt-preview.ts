import * as admin from "firebase-admin";
import sharp from "sharp";
import heicDecode from "heic-decode";

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
export interface ReceiptPreview {
  imageUrl: string;
  pdfUrl: string;
  originalUrl: string;
  error: string;
}

/** Resolve provenance stored on an authorized receipt, never a client-supplied path. */
export async function loadReceiptSourceBundlePreview(data: any, userId: string, bucket: ReturnType<admin.storage.Storage["bucket"]>): Promise<ReceiptPreview> {
  return loadReceiptPreview({ file: { storagePath: data.sourceBundle?.storagePath, mimeType: "application/pdf" } }, userId, bucket);
}

function ownedPath(userId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const prefix = `users/${userId}/receipts/`;
  const filename = path.slice(prefix.length);
  return path.startsWith(prefix) && !!filename && !filename.includes("/") && ![".", ".."].includes(filename);
}

function mediaType(contentType: string | undefined, path: string) {
  const type = contentType?.split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", heic: "image/heic", heif: "image/heif" } as Record<string, string>)[extension || ""] || "application/octet-stream";
}

/** Only called after admin authorization; never changes object ACLs or creates download tokens. */
export async function loadReceiptPreview(data: any, userId: string, bucket: ReturnType<admin.storage.Storage["bucket"]>): Promise<ReceiptPreview> {
  const result: ReceiptPreview = { imageUrl: "", pdfUrl: "", originalUrl: "", error: "" };
  const originalPath = data.file?.storagePath;
  const paths = [...new Set([data.email?.previewStoragePath, originalPath, data.email?.pdfStoragePath])].filter(path => ownedPath(userId, path));
  if (!paths.length) return { ...result, error: "No original file is attached to this receipt. You can still enter and save its values." };
  let missing = false;
  for (const path of paths) {
    try {
      const file = bucket.file(path);
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) > MAX_PREVIEW_BYTES) continue;
      const type = mediaType(metadata.contentType || (path === originalPath ? data.file?.mimeType : undefined), path);
      const token = metadata.metadata?.firebaseStorageDownloadTokens;
      // Existing Firebase URLs work for the same authorized admin without another client metadata request.
      const url = typeof token === "string" && token ? `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token.split(",")[0])}` : "";
      if (path === originalPath && url) result.originalUrl = url;
      if (result.imageUrl || result.pdfUrl) continue;
      if (["image/heic", "image/heif"].includes(type)) {
        const [buffer] = await file.download();
        let jpeg: Buffer;
        try { jpeg = await sharp(buffer).rotate().resize(1800, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); }
        catch {
          const decoded = await heicDecode({ buffer });
          jpeg = await sharp(Buffer.from(decoded.data), { raw: { width: decoded.width, height: decoded.height, channels: 4 } }).rotate().resize(1800, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        }
        result.imageUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      } else if (["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "application/pdf"].includes(type)) {
        // Server-ingested files may have no Firebase download token. Return their bytes to this authorized caller only.
        const source = url || `data:${type};base64,${(await file.download())[0].toString("base64")}`;
        if (type === "application/pdf") result.pdfUrl = source;
        else result.imageUrl = source;
        if (path === originalPath) result.originalUrl = source;
      }
    } catch (error) {
      if ((error as { code?: number }).code === 404) missing = true;
      // A missing original must not hide a usable email preview or PDF.
    }
  }
  if (!result.imageUrl && !result.pdfUrl) result.error = missing
    ? "The original file is missing from storage. You can still enter and save its values."
    : "This file could not be previewed. You can still enter and save its values, or open the original if available.";
  return result;
}

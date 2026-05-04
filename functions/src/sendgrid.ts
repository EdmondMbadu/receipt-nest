import sgMail from "@sendgrid/mail";
import Mail from "@sendgrid/helpers/classes/mail";
import { logger } from "firebase-functions";

type SendgridMessage = Record<string, unknown> & {
  attachments?: Array<Record<string, unknown>>;
};

const normalizeAttachments = (attachments: unknown) => {
  if (!Array.isArray(attachments)) {
    return attachments;
  }

  return attachments.map((attachment) => {
    if (!attachment || typeof attachment !== "object") {
      return attachment;
    }

    const normalized = { ...(attachment as Record<string, unknown>) };
    if (typeof normalized.contentId === "string" && normalized.contentId.length > 0) {
      normalized.content_id = normalized.contentId;
      delete normalized.contentId;
    }

    return normalized;
  });
};

export const sendSendgridMail = async (apiKey: string, message: SendgridMessage) => {
  sgMail.setApiKey(apiKey);

  const mail = Mail.create(message as never) as Mail & { headers?: Record<string, string> };
  const body = mail.toJSON() as unknown as Record<string, unknown>;
  body.attachments = normalizeAttachments(body.attachments) as Record<string, unknown>[] | undefined;
  const client = sgMail as typeof sgMail & {
    client: {
      request: (request: {
        method: string;
        url: string;
        headers?: Record<string, string>;
        body: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };

  try {
    return await client.client.request({
      method: "POST",
      url: "/v3/mail/send",
      headers: mail.headers,
      body,
    });
  } catch (error) {
    logger.error("SendGrid request failed", {
      subject: typeof body.subject === "string" ? body.subject : null,
      to: body.personalizations,
      sendgridErrors: (error as { response?: { body?: { errors?: unknown } } })?.response?.body?.errors ?? null,
      error,
    });
    throw error;
  }
};

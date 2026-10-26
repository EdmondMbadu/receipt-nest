import { appendAppDownloadText } from "./email-app-links";
import { appendUnsubscribeText } from "./email-suppression";
import { buildWelcomeEmailContent } from "./welcome-email-content";
import { buildFirstReceiptReminder, buildOnboardingFollowup, buildOnboardingEmailHtml, getOnboardingEmailAttachments } from "./onboarding-email-content";
import type { OnboardingReminderTemplate } from "./email-lifecycle-policy";

export type OnboardingEmailTemplate = "welcome" | OnboardingReminderTemplate;

// Production delivery and admin tests share the complete message, including
// plain text, footer links and embedded logo. This function writes no state.
export const buildOnboardingEmailMessage = (
  template: OnboardingEmailTemplate,
  baseUrl: string,
  firstName = "",
  unsubscribeUrl?: string,
) => {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const unsubscribe = unsubscribeUrl || `${base}/unsubscribe`;
  if (template === "welcome") {
    const content = buildWelcomeEmailContent(base);
    const text = appendUnsubscribeText(appendAppDownloadText(
      `${content.text}\n\nSupport: ${base}/support\nEmail preferences: ${base}/app?settings=notifications`,
    ), unsubscribe);
    return {
      subject: content.subject,
      text,
      html: buildOnboardingEmailHtml({ ...content, title: "Welcome to ReceiptNest.", baseUrl: base, unsubscribeUrl: unsubscribe }),
      attachments: getOnboardingEmailAttachments(),
    };
  }
  const content = template === "first-receipt"
    ? buildFirstReceiptReminder(base, firstName, unsubscribe)
    : buildOnboardingFollowup(template, base, firstName, unsubscribe);
  return {
    subject: content.subject,
    text: appendUnsubscribeText(appendAppDownloadText(content.text), unsubscribe),
    html: content.html,
    attachments: getOnboardingEmailAttachments(),
  };
};

import type { EmailDriver } from "./interface";
import { SettingsService } from "../../../modules/settings/settings.service";

/** Build verification email content (pure, no transport) */
export function buildVerificationEmail(verifyUrl: string): { subject: string; html: string } {
    const subject = "Verify your email address";
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
            <h2 style="color: #1a1a1a; margin-bottom: 16px;">Verify Your Email</h2>
            <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
                Thank you for registering. Please click the button below to verify your email address.
            </p>
            <a href="${verifyUrl}"
               style="display: inline-block; background-color: #0066FF; color: #fff; text-decoration: none;
                      padding: 12px 32px; border-radius: 8px; font-weight: 600;">
                Verify Email
            </a>
            <p style="color: #999; font-size: 13px; margin-top: 32px;">
                If you did not create an account, you can safely ignore this email.
                This link expires in 3 days.
            </p>
        </div>
    `;
    return { subject, html };
}

const RESEND_API_URL = "https://api.resend.com/emails";

export class ResendDriver implements EmailDriver {
    async send({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
        const api_key = SettingsService.get("resend_api_key");
        if (!api_key) {
            console.error("RESEND_API_KEY is not configured");
            return false;
        }

        const from = SettingsService.get("email_from") || "noreply@ehex.cc";

        try {
            const response = await fetch(RESEND_API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${api_key}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from,
                    to,
                    subject,
                    html,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                console.error("Resend API error:", response.status, error);
                return false;
            }

            return true;
        } catch (error) {
            console.error("Failed to send email:", error);
            return false;
        }
    }
}

import { config } from "dotenv";
config();

const RESEND_API_URL = "https://api.resend.com/emails";

interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.error("RESEND_API_KEY is not configured");
        return false;
    }

    const from = process.env.EMAIL_FROM || "noreply@ehex.cc";

    try {
        const response = await fetch(RESEND_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
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
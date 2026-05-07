import { config } from "dotenv";
config();

const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";
function getApiKey(): string {
    const key = process.env.NOWPAYMENTS_API_KEY;
    if (!key) throw new Error("NOWPAYMENTS_API_KEY not configured");
    return key;
}

interface NowPaymentsInvoiceResponse {
    id: string;
    invoice_url: string;
    order_id: string;
    payment_id?: string;
    payment_status?: string;
    price_amount: number;
    price_currency: string;
    pay_currency?: string;
    created_at?: string;
    expiration_seconds?: number;
}

/**
 * Create a payment invoice via NowPayments.
 * Returns the invoice URL (user pays here) and payment ID (for status tracking).
 */
export async function createInvoice(
    planName: string,
    priceCents: number,
    accountId: string,
): Promise<{ invoice_url: string; payment_id: string; invoice_id: string }> {
    const apiKey = getApiKey();
    const priceInUsd = priceCents / 100;
    const body = {
        price_amount: priceInUsd,
        price_currency: "USDTERC20",
        pay_currency: "USDTERC20",
        order_id: accountId,
        order_description: `ehex ${planName} plan subscription`,
        ipn_callback_url: process.env.IPN_CALLBACK_URL + "/api/subscription/ipnwebhook",
        is_fixed_rate: false,
    };

    const resp = await fetch(`${NOWPAYMENTS_API_URL}/invoice`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`NowPayments create invoice failed (${resp.status}): ${text}`);
    }

    const json: NowPaymentsInvoiceResponse = await resp.json();

    return {
        invoice_url: json.invoice_url,
        invoice_id: json.id,
        payment_id: json.payment_id || json.id,
    };
}

export async function checkPaymentStatus(paymentId: string): Promise<{
    status: string;
    actuallyPaid: number | null;
}> {
    const apiKey = getApiKey();
    const resp = await fetch(`${NOWPAYMENTS_API_URL}/payment/${paymentId}`, {
        headers: { "x-api-key": apiKey },
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`NowPayments check payment failed (${resp.status}): ${text}`);
    }

    const json: {
        payment_id: string;
        payment_status: string;
        actually_paid?: string;
        pay_amount?: string;
        price_amount: number;
    } = await resp.json();

    let status: string;
    switch (json.payment_status) {
        case "finished":
        case "confirmed":
            status = "confirmed";
            break;
        case "failed":
        case "expired":
        case "refunded":
            status = "expired";
            break;
        default:
            status = "pending";
    }

    const actuallyPaid = json.actually_paid ? Math.round(parseFloat(json.actually_paid) * 100) : null;

    return { status, actuallyPaid };
}


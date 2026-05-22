import { PAYMENT_CURRENCIES } from "../../../shared/modules/subscription_record/subscription_record.interface";
import { SettingsService } from "../settings/settings.service";
import type { PaymentCurrency } from "../../../shared/modules/subscription_record/subscription_record.interface";
export { PAYMENT_CURRENCIES };

const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";
function getApiKey(): string {
    const key = SettingsService.get("nowpayments_api_key");
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
 * Build the request body for NowPayments invoice creation.
 * Extracted as a standalone function so it can be used/tested independently.
 */
export function buildPaymentBody(params: {
    priceDollars: number;
    accountId: string;
    payCurrency: PaymentCurrency;
}): Record<string, unknown> {
    return {
        price_amount: params.priceDollars,
        price_currency: params.payCurrency,
        pay_currency: params.payCurrency,
        order_id: params.accountId,
        order_description: "ehex token topup",
        ipn_callback_url: `${SettingsService.get("ipn_callback_url")}/api/subscription/ipnwebhook`,
        is_fixed_rate: false,
    };
}

/**
 * Create a payment invoice via NowPayments.
 * Returns the invoice URL (user pays here) and payment ID (for status tracking).
 */
export async function createInvoice(
    priceDollars: number,
    accountId: string,
    payCurrency: PaymentCurrency = "USDTERC20",
): Promise<{ invoice_url: string; payment_id: string; invoice_id: string }> {
    const apiKey = getApiKey();
    const body = buildPaymentBody({ priceDollars, accountId, payCurrency });

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

    const actuallyPaid = json.actually_paid ? parseFloat(parseFloat(json.actually_paid).toFixed(2)) : null;

    return { status, actuallyPaid };
}
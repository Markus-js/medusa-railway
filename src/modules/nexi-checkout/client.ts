import type {
  NexiChargeResponse,
  NexiCheckoutProviderOptions,
  NexiCreatePaymentInput,
  NexiPaymentDetails,
  NexiPaymentResponse,
} from "./types"
import { amountToMinorUnits, sanitizeIdempotencyKey } from "./utils"

const TEST_BASE_URL = "https://test.api.dibspayment.eu"
const LIVE_BASE_URL = "https://api.dibspayment.eu"

type RequestOptions = {
  body?: Record<string, unknown>
  idempotencyKey?: string
}

export class NexiCheckoutClient {
  private readonly baseUrl: string
  private readonly secretKey?: string
  private readonly merchantNumber?: string

  constructor(private readonly options: NexiCheckoutProviderOptions) {
    this.secretKey = options.secretKey
    this.merchantNumber = options.merchantNumber
    this.baseUrl =
      options.baseUrl ||
      (options.environment === "live" ? LIVE_BASE_URL : TEST_BASE_URL)
  }

  async createPayment(
    input: NexiCreatePaymentInput
  ): Promise<NexiPaymentResponse> {
    const body: Record<string, unknown> = {
      order: {
        items: input.orderItems,
        amount: amountToMinorUnits(input.amount, input.currencyCode),
        currency: input.currencyCode.toUpperCase(),
        reference: input.orderReference,
      },
      checkout: {
        ...input.checkout,
        ...(input.consumer ? { consumer: input.consumer } : {}),
      },
      ...(input.notifications ? { notifications: input.notifications } : {}),
      myReference: input.myReference,
      ...(this.merchantNumber ? { merchantNumber: this.merchantNumber } : {}),
    }

    return await this.request<NexiPaymentResponse>("POST", "/v1/payments", {
      body,
      idempotencyKey: input.idempotencyKey,
    })
  }

  async retrievePayment(paymentId: string): Promise<NexiPaymentDetails> {
    return await this.request<NexiPaymentDetails>(
      "GET",
      `/v1/payments/${encodeURIComponent(paymentId)}`
    )
  }

  async updateOrder(
    paymentId: string,
    input: {
      amount: number
      items: unknown[]
    }
  ): Promise<void> {
    await this.request<void>(
      "PUT",
      `/v1/payments/${encodeURIComponent(paymentId)}/orderitems`,
      {
        body: input,
      }
    )
  }

  async terminatePayment(paymentId: string): Promise<void> {
    await this.request<void>(
      "PUT",
      `/v1/payments/${encodeURIComponent(paymentId)}/terminate`
    )
  }

  async cancelPayment(
    paymentId: string,
    amount: number
  ): Promise<Record<string, unknown>> {
    return await this.request<Record<string, unknown>>(
      "POST",
      `/v1/payments/${encodeURIComponent(paymentId)}/cancels`,
      {
        body: { amount },
      }
    )
  }

  async chargePayment(
    paymentId: string,
    amount: number,
    idempotencyKey?: string
  ): Promise<NexiChargeResponse> {
    return await this.request<NexiChargeResponse>(
      "POST",
      `/v1/payments/${encodeURIComponent(paymentId)}/charges`,
      {
        body: {
          amount,
          finalCharge: true,
        },
        idempotencyKey: sanitizeIdempotencyKey(idempotencyKey, "charge"),
      }
    )
  }

  async refundCharge(
    chargeId: string,
    amount: number,
    idempotencyKey?: string
  ): Promise<Record<string, unknown>> {
    return await this.request<Record<string, unknown>>(
      "POST",
      `/v1/charges/${encodeURIComponent(chargeId)}/refunds`,
      {
        body: { amount },
        idempotencyKey: sanitizeIdempotencyKey(idempotencyKey, "refund"),
      }
    )
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    if (!this.secretKey) {
      throw new Error(
        "Nexi Checkout is selected but NEXI_CHECKOUT_SECRET_KEY is missing. Set it on the Medusa Railway service and redeploy before using this payment provider."
      )
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: this.secretKey,
    }

    if (options.body) {
      headers["Content-Type"] = "application/json"
    }

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey
    }

    if (this.merchantNumber) {
      headers["MerchantNumber"] = this.merchantNumber
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    const rawBody = await response.text()
    const responseBody = rawBody ? parseJson(rawBody) : undefined

    if (!response.ok) {
      throw new Error(
        `Nexi Checkout ${method} ${path} failed with ${response.status}: ${formatErrorBody(
          responseBody || rawBody
        )}`
      )
    }

    return (responseBody ?? {}) as T
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function formatErrorBody(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return "Unknown Nexi Checkout error"
  }
}

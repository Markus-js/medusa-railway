import type { BigNumberInput } from "@medusajs/framework/types"

export type NexiCheckoutEnvironment = "test" | "live"

export type NexiCheckoutProviderOptions = {
  secretKey: string
  environment?: NexiCheckoutEnvironment
  baseUrl?: string
  returnUrl: string
  cancelUrl: string
  termsUrl: string
  merchantTermsUrl?: string
  checkoutUrl?: string
  webhookUrl?: string
  webhookAuthorization?: string
  merchantNumber?: string
  countryCode?: string
  autoCapture?: boolean
  merchantHandlesConsumerData?: boolean
  paymentMethods?: string[]
  webhookEvents?: string[]
}

export type NexiOrderItem = {
  reference: string
  name: string
  quantity: number
  unit: string
  unitPrice: number
  taxRate?: number
  taxAmount?: number
  grossTotalAmount: number
  netTotalAmount: number
  imageUrl?: string
}

export type NexiCreatePaymentInput = {
  amount: BigNumberInput
  currencyCode: string
  sessionId: string
  orderReference: string
  myReference: string
  orderItems: NexiOrderItem[]
  checkout: Record<string, unknown>
  notifications?: Record<string, unknown>
  consumer?: Record<string, unknown>
  idempotencyKey?: string
}

export type NexiPaymentResponse = {
  paymentId: string
  hostedPaymentPageUrl?: string
}

export type NexiPaymentDetails = {
  payment?: Record<string, unknown>
} & Record<string, unknown>

export type NexiChargeResponse = {
  chargeId?: string
  invoice?: Record<string, unknown>
} & Record<string, unknown>

export type NexiAmount = {
  amount: string | number
  currency?: string
}

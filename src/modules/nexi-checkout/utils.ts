import { MathBN } from "@medusajs/framework/utils"
import type { BigNumberInput } from "@medusajs/framework/types"
import type { NexiAmount, NexiOrderItem } from "./types"

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
])

const ISO2_TO_ISO3: Record<string, string> = {
  dk: "DNK",
  da: "DNK",
  dnk: "DNK",
  se: "SWE",
  swe: "SWE",
  no: "NOR",
  nor: "NOR",
  gb: "GBR",
  uk: "GBR",
  gbr: "GBR",
  de: "DEU",
  deu: "DEU",
  fi: "FIN",
  fin: "FIN",
}

export const DEFAULT_WEBHOOK_EVENTS = [
  "payment.checkout.completed",
  "payment.reservation.created",
  "payment.reservation.failed",
  "payment.charge.created",
  "payment.charge.failed",
  "payment.cancel.created",
  "payment.cancel.failed",
  "payment.refund.completed",
  "payment.refund.failed",
]

export function currencyMultiplier(currencyCode?: string): number {
  return ZERO_DECIMAL_CURRENCIES.has((currencyCode || "").toLowerCase())
    ? 1
    : 100
}

export function amountToMinorUnits(
  amount: BigNumberInput,
  currencyCode?: string
): number {
  const multiplier = currencyMultiplier(currencyCode)
  return MathBN.mult(amount, multiplier).decimalPlaces(0).toNumber()
}

export function amountFromMinorUnits(
  amount: string | number | undefined,
  currencyCode?: string
): number {
  if (amount === undefined || amount === null || amount === "") {
    return 0
  }

  return Number(amount) / currencyMultiplier(currencyCode)
}

export function sanitizeNexiString(
  value: unknown,
  maxLength = 128,
  fallback = "medusa"
): string {
  const normalized = String(value ?? fallback)
    .replace(/[<>"'&\\]/g, "")
    .trim()

  return (normalized || fallback).slice(0, maxLength)
}

export function sanitizeMyReference(value: unknown): string {
  return sanitizeNexiString(value, 36, "medusa")
}

export function sanitizeIdempotencyKey(value: unknown, suffix?: string): string {
  return sanitizeNexiString(
    suffix ? `${String(value ?? "medusa")}-${suffix}` : value,
    63,
    "medusa"
  )
}

export function toIso3CountryCode(value?: string | null): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.toLowerCase()
  return ISO2_TO_ISO3[normalized] || value.toUpperCase()
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

export function getNestedRecord(
  source: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  return asRecord(source[key])
}

export function getString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value
  }

  if (typeof value === "number") {
    return String(value)
  }

  return undefined
}

export function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

export function getHeader(
  headers: Record<string, unknown>,
  headerName: string
): string | undefined {
  const normalizedName = headerName.toLowerCase()
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === normalizedName
  )

  const value = match?.[1]
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]) : undefined
  }

  return getString(value)
}

export function buildFallbackOrderItem(
  amountMinor: number,
  reference: string
): NexiOrderItem {
  return {
    reference: sanitizeNexiString(reference, 128, "order"),
    name: "Order",
    quantity: 1,
    unit: "pcs",
    unitPrice: amountMinor,
    taxRate: 0,
    taxAmount: 0,
    grossTotalAmount: amountMinor,
    netTotalAmount: amountMinor,
  }
}

export function normalizeOrderItems(
  items: unknown,
  amountMinor: number,
  reference: string
): NexiOrderItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [buildFallbackOrderItem(amountMinor, reference)]
  }

  return items.map((item, index) => {
    const source = asRecord(item)
    const grossTotalAmount =
      getNumber(source.grossTotalAmount) ??
      getNumber(source.gross_total_amount) ??
      amountMinor
    const taxAmount = getNumber(source.taxAmount) ?? getNumber(source.tax_amount) ?? 0
    const netTotalAmount =
      getNumber(source.netTotalAmount) ??
      getNumber(source.net_total_amount) ??
      grossTotalAmount - taxAmount

    return {
      reference: sanitizeNexiString(source.reference, 128, `item-${index + 1}`),
      name: sanitizeNexiString(source.name, 128, "Order item"),
      quantity: getNumber(source.quantity) ?? 1,
      unit: sanitizeNexiString(source.unit, 128, "pcs"),
      unitPrice:
        getNumber(source.unitPrice) ??
        getNumber(source.unit_price) ??
        netTotalAmount,
      taxRate: getNumber(source.taxRate) ?? getNumber(source.tax_rate) ?? 0,
      taxAmount,
      grossTotalAmount,
      netTotalAmount,
      ...(getString(source.imageUrl) || getString(source.image_url)
        ? { imageUrl: getString(source.imageUrl) || getString(source.image_url) }
        : {}),
    }
  })
}

export function extractNexiAmount(
  source: Record<string, unknown>,
  fallbackCurrency?: string
): { amount: number; currency?: string } {
  const amount = asRecord(source.amount) as NexiAmount
  const value =
    getNumber(amount.amount) ??
    getNumber(source.amount) ??
    getNumber(source.grossTotalAmount) ??
    0
  const currency = getString(amount.currency) || fallbackCurrency

  return {
    amount: amountFromMinorUnits(value, currency),
    currency,
  }
}


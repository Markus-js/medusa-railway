import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { NexiCheckoutClient } from "./client"
import type { NexiCheckoutProviderOptions, NexiPaymentDetails } from "./types"
import {
  DEFAULT_WEBHOOK_EVENTS,
  amountFromMinorUnits,
  amountToMinorUnits,
  asRecord,
  extractNexiAmount,
  getHeader,
  getNestedRecord,
  getNumber,
  getString,
  normalizeOrderItems,
  sanitizeIdempotencyKey,
  sanitizeMyReference,
  sanitizeNexiString,
  toIso3CountryCode,
} from "./utils"

type InjectedDependencies = {
  logger?: Logger
}

export default class NexiCheckoutProviderService extends AbstractPaymentProvider<NexiCheckoutProviderOptions> {
  static identifier = "nexi-checkout"

  protected readonly logger_: Logger | Console
  protected readonly options_: NexiCheckoutProviderOptions
  protected readonly client_: NexiCheckoutClient

  static validateOptions(options: NexiCheckoutProviderOptions): void {
    const requiredOptions = ["secretKey", "returnUrl", "cancelUrl", "termsUrl"]
    const missing = requiredOptions.filter((key) => !options?.[key])

    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Missing Nexi Checkout option(s): ${missing.join(", ")}`
      )
    }
  }

  constructor(
    container: InjectedDependencies,
    options: NexiCheckoutProviderOptions
  ) {
    super(container, options)

    this.logger_ = container.logger || console
    this.options_ = options
    this.client_ = new NexiCheckoutClient(options)
  }

  async initiatePayment({
    amount,
    currency_code,
    data,
    context,
  }: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId =
      getString(data?.session_id) ||
      getString(context?.idempotency_key) ||
      sanitizeIdempotencyKey(Date.now())
    const amountMinor = amountToMinorUnits(amount, currency_code)
    const orderReference = sanitizeNexiString(sessionId, 128)
    const myReference = sanitizeMyReference(sessionId)
    const orderItems = normalizeOrderItems(
      data?.order_items || data?.orderItems,
      amountMinor,
      orderReference
    )
    const checkout = this.buildCheckout(data, context)
    const notifications = this.buildNotifications()
    const consumer = this.buildConsumer(context?.customer)

    const payment = await this.client_.createPayment({
      amount,
      currencyCode: currency_code,
      sessionId,
      orderReference,
      myReference,
      orderItems,
      checkout,
      notifications,
      consumer,
      idempotencyKey: sanitizeIdempotencyKey(context?.idempotency_key),
    })

    return {
      id: payment.paymentId,
      status: PaymentSessionStatus.PENDING,
      data: {
        ...data,
        id: payment.paymentId,
        paymentId: payment.paymentId,
        hostedPaymentPageUrl: payment.hostedPaymentPageUrl,
        session_id: sessionId,
        amount: amountMinor,
        currency_code,
        order_reference: orderReference,
        myReference,
        orderItems,
      },
    }
  }

  async updatePayment({
    data,
    amount,
    currency_code,
    context,
  }: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const paymentId = this.getPaymentId(data)

    if (!paymentId) {
      return await this.initiatePayment({
        amount,
        currency_code,
        data,
        context,
      })
    }

    const amountMinor = amountToMinorUnits(amount, currency_code)
    const orderReference = sanitizeNexiString(
      getString(data?.order_reference) || getString(data?.session_id),
      128
    )
    const orderItems = normalizeOrderItems(
      data?.order_items || data?.orderItems,
      amountMinor,
      orderReference
    )

    await this.client_.updateOrder(paymentId, {
      amount: amountMinor,
      items: orderItems,
    })

    const payment = await this.client_.retrievePayment(paymentId)
    const status = this.getStatusFromPayment(payment)

    return {
      status,
      data: {
        ...data,
        id: paymentId,
        paymentId,
        amount: amountMinor,
        currency_code,
        orderItems,
        nexi: payment,
      },
    }
  }

  async deletePayment({
    data,
  }: DeletePaymentInput): Promise<DeletePaymentOutput> {
    const paymentId = this.getPaymentId(data)

    if (!paymentId) {
      return { data: data || {} }
    }

    try {
      await this.client_.terminatePayment(paymentId)
    } catch (error) {
      this.logger_.warn?.(
        `Unable to terminate Nexi Checkout payment ${paymentId}: ${this.getErrorMessage(
          error
        )}`
      )
    }

    return { data: { ...data, deleted: true } }
  }

  async authorizePayment({
    data,
  }: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const paymentId = this.requirePaymentId(data, "authorizePayment")
    const payment = await this.client_.retrievePayment(paymentId)
    const status = this.getStatusFromPayment(payment)

    return {
      status,
      data: {
        ...data,
        id: paymentId,
        paymentId,
        nexi: payment,
      },
    }
  }

  async capturePayment({
    data,
    context,
  }: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const paymentId = this.requirePaymentId(data, "capturePayment")
    const amount = this.getStoredMinorAmount(data)
    const charge = await this.client_.chargePayment(
      paymentId,
      amount,
      context?.idempotency_key
    )

    return {
      data: {
        ...data,
        id: paymentId,
        paymentId,
        chargeId: charge.chargeId,
        latest_charge_id: charge.chargeId,
        latestCharge: charge,
      },
    }
  }

  async refundPayment({
    amount,
    data,
    context,
  }: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const currencyCode = getString(data?.currency_code)
    const refundAmount = amountToMinorUnits(amount, currencyCode)
    const chargeId = await this.getChargeId(data)

    const refund = await this.client_.refundCharge(
      chargeId,
      refundAmount,
      context?.idempotency_key
    )

    return {
      data: {
        ...data,
        latestRefund: refund,
      },
    }
  }

  async retrievePayment({
    data,
  }: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const paymentId = this.requirePaymentId(data, "retrievePayment")
    const payment = await this.client_.retrievePayment(paymentId)

    return {
      data: {
        ...data,
        id: paymentId,
        paymentId,
        nexi: payment,
      },
    }
  }

  async cancelPayment({
    data,
  }: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const paymentId = this.requirePaymentId(data, "cancelPayment")
    const amount = this.getStoredMinorAmount(data)
    const cancellation = await this.client_.cancelPayment(paymentId, amount)

    return {
      data: {
        ...data,
        id: paymentId,
        paymentId,
        latestCancellation: cancellation,
      },
    }
  }

  async getPaymentStatus({
    data,
  }: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const paymentId = this.requirePaymentId(data, "getPaymentStatus")
    const payment = await this.client_.retrievePayment(paymentId)

    return {
      status: this.getStatusFromPayment(payment),
      data: {
        ...data,
        id: paymentId,
        paymentId,
        nexi: payment,
      },
    }
  }

  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    this.validateWebhookAuthorization(webhookData.headers)

    const event = getString(webhookData.data.event) || ""
    const eventData = getNestedRecord(webhookData.data, "data")
    const paymentId = this.getWebhookPaymentId(webhookData.data)

    if (!paymentId) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const payment = await this.client_.retrievePayment(paymentId)
    const sessionId = this.getWebhookSessionId(webhookData.data, payment)
    const amount = this.getWebhookAmount(eventData, payment)

    if (!sessionId) {
      this.logger_.warn?.(
        `Nexi Checkout webhook ${event} for ${paymentId} did not include a Medusa payment session reference`
      )
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    if (event === "payment.charge.created" || event === "payment.charge.created.v2") {
      return {
        action: PaymentActions.SUCCESSFUL,
        data: { session_id: sessionId, amount: new BigNumber(amount) },
      }
    }

    if (event === "payment.cancel.created") {
      return {
        action: PaymentActions.CANCELED,
        data: { session_id: sessionId, amount: new BigNumber(amount) },
      }
    }

    if (
      event === "payment.reservation.failed" ||
      event === "payment.charge.failed" ||
      event === "payment.charge.failed.v2" ||
      event === "payment.cancel.failed"
    ) {
      return {
        action: PaymentActions.FAILED,
        data: { session_id: sessionId, amount: new BigNumber(amount) },
      }
    }

    if (
      event === "payment.reservation.created" ||
      event === "payment.reservation.created.v2"
    ) {
      return {
        action: PaymentActions.AUTHORIZED,
        data: { session_id: sessionId, amount: new BigNumber(amount) },
      }
    }

    if (event === "payment.checkout.completed") {
      const status = this.getStatusFromPayment(payment)

      if (status === PaymentSessionStatus.CAPTURED) {
        return {
          action: PaymentActions.SUCCESSFUL,
          data: { session_id: sessionId, amount: new BigNumber(amount) },
        }
      }

      if (status === PaymentSessionStatus.AUTHORIZED) {
        return {
          action: PaymentActions.AUTHORIZED,
          data: { session_id: sessionId, amount: new BigNumber(amount) },
        }
      }
    }

    return { action: PaymentActions.NOT_SUPPORTED }
  }

  private buildCheckout(
    data: Record<string, unknown> | undefined,
    context: InitiatePaymentInput["context"]
  ): Record<string, unknown> {
    const checkout: Record<string, unknown> = {
      integrationType: "HostedPaymentPage",
      returnUrl:
        getString(data?.return_url) ||
        getString(data?.returnUrl) ||
        this.options_.returnUrl,
      cancelUrl:
        getString(data?.cancel_url) ||
        getString(data?.cancelUrl) ||
        this.options_.cancelUrl,
      termsUrl:
        getString(data?.terms_url) ||
        getString(data?.termsUrl) ||
        this.options_.termsUrl,
      charge: this.options_.autoCapture === true,
      merchantHandlesConsumerData:
        this.options_.merchantHandlesConsumerData ?? true,
      countryCode: this.options_.countryCode || "DNK",
    }

    if (this.options_.checkoutUrl) {
      checkout.url = this.options_.checkoutUrl
    }

    if (this.options_.merchantTermsUrl) {
      checkout.merchantTermsUrl = this.options_.merchantTermsUrl
    }

    const paymentMethods = this.options_.paymentMethods?.filter(Boolean)
    if (paymentMethods?.length) {
      checkout.paymentMethodsConfiguration = paymentMethods.map((name) => ({
        name,
        enabled: true,
      }))
    }

    return checkout
  }

  private buildNotifications(): Record<string, unknown> | undefined {
    const webHooks = this.buildWebhooks()
    if (webHooks.length) {
      return {
        webHooks,
      }
    }

    return undefined
  }

  private buildWebhooks(): Record<string, unknown>[] {
    if (!this.options_.webhookUrl) {
      return []
    }

    const events = this.options_.webhookEvents?.length
      ? this.options_.webhookEvents
      : DEFAULT_WEBHOOK_EVENTS

    return events.map((eventName) => ({
      eventName,
      url: this.options_.webhookUrl,
      ...(this.options_.webhookAuthorization
        ? { authorization: this.options_.webhookAuthorization }
        : {}),
    }))
  }

  private buildConsumer(
    customer?: InitiatePaymentInput["context"]["customer"]
  ): Record<string, unknown> | undefined {
    if (!customer) {
      return undefined
    }

    const address = customer.billing_address
    const billingAddress =
      address?.address_1 && address?.postal_code && address?.city
        ? {
            addressLine1: sanitizeNexiString(address.address_1),
            ...(address.address_2
              ? { addressLine2: sanitizeNexiString(address.address_2) }
              : {}),
            postalCode: sanitizeNexiString(address.postal_code, 12),
            city: sanitizeNexiString(address.city),
            country: toIso3CountryCode(address.country_code),
          }
        : undefined

    const consumer: Record<string, unknown> = {
      reference: sanitizeNexiString(customer.id),
      email: customer.email,
      ...(billingAddress ? { billingAddress } : {}),
    }

    if (customer.company_name) {
      consumer.company = {
        name: sanitizeNexiString(customer.company_name),
        contact: {
          firstName: sanitizeNexiString(customer.first_name, 128, "Customer"),
          lastName: sanitizeNexiString(customer.last_name, 128, "Customer"),
        },
      }
    } else if (customer.first_name || customer.last_name) {
      consumer.privatePerson = {
        firstName: sanitizeNexiString(customer.first_name, 128, "Customer"),
        lastName: sanitizeNexiString(customer.last_name, 128, "Customer"),
      }
    }

    return consumer
  }

  private getStatusFromPayment(
    paymentDetails: NexiPaymentDetails
  ): PaymentSessionStatus {
    const payment = asRecord(paymentDetails.payment || paymentDetails)
    const summary = asRecord(payment.summary)
    const chargedAmount = getNumber(summary.chargedAmount) ?? 0
    const reservedAmount = getNumber(summary.reservedAmount) ?? 0
    const cancelledAmount = getNumber(summary.cancelledAmount) ?? 0

    if (chargedAmount > 0) {
      return PaymentSessionStatus.CAPTURED
    }

    if (reservedAmount > 0) {
      return PaymentSessionStatus.AUTHORIZED
    }

    if (cancelledAmount > 0) {
      return PaymentSessionStatus.CANCELED
    }

    return PaymentSessionStatus.PENDING
  }

  private validateWebhookAuthorization(headers: Record<string, unknown>): void {
    if (!this.options_.webhookAuthorization) {
      return
    }

    const authorization = getHeader(headers, "authorization")
    if (authorization !== this.options_.webhookAuthorization) {
      throw new Error("Invalid Nexi Checkout webhook authorization header")
    }
  }

  private getWebhookPaymentId(webhookBody: Record<string, unknown>): string | undefined {
    const eventData = getNestedRecord(webhookBody, "data")
    return (
      getString(eventData.paymentId) ||
      getString(eventData.payment_id) ||
      getString(webhookBody.paymentId) ||
      getString(webhookBody.payment_id)
    )
  }

  private getWebhookSessionId(
    webhookBody: Record<string, unknown>,
    paymentDetails: NexiPaymentDetails
  ): string | undefined {
    const eventData = getNestedRecord(webhookBody, "data")
    const payment = asRecord(paymentDetails.payment || paymentDetails)
    const order = asRecord(eventData.order)
    const orderDetails = asRecord(payment.orderDetails)

    return (
      getString(order.reference) ||
      getString(orderDetails.reference) ||
      getString(eventData.session_id) ||
      getString(eventData.myReference) ||
      getString(payment.myReference)
    )
  }

  private getWebhookAmount(
    eventData: Record<string, unknown>,
    paymentDetails: NexiPaymentDetails
  ): number {
    const amount = extractNexiAmount(eventData)
    if (amount.amount) {
      return amount.amount
    }

    const payment = asRecord(paymentDetails.payment || paymentDetails)
    const orderDetails = asRecord(payment.orderDetails)
    const currency = getString(orderDetails.currency)
    const orderAmount = getNumber(orderDetails.amount)

    return amountFromMinorUnits(orderAmount, currency)
  }

  private getPaymentId(data?: Record<string, unknown>): string | undefined {
    return (
      getString(data?.paymentId) ||
      getString(data?.payment_id) ||
      getString(data?.id)
    )
  }

  private requirePaymentId(
    data: Record<string, unknown> | undefined,
    methodName: string
  ): string {
    const paymentId = this.getPaymentId(data)

    if (!paymentId) {
      throw new Error(`No Nexi Checkout payment id provided for ${methodName}`)
    }

    return paymentId
  }

  private getStoredMinorAmount(data?: Record<string, unknown>): number {
    const amount = getNumber(data?.amount) ?? getNumber(data?.amount_minor)

    if (!amount) {
      throw new Error("No Nexi Checkout amount found in payment data")
    }

    return amount
  }

  private async getChargeId(
    data?: Record<string, unknown>
  ): Promise<string> {
    const directChargeId =
      getString(data?.chargeId) ||
      getString(data?.charge_id) ||
      getString(data?.latest_charge_id)

    if (directChargeId) {
      return directChargeId
    }

    const paymentId = this.requirePaymentId(data, "refundPayment")
    const payment = asRecord(
      (await this.client_.retrievePayment(paymentId)).payment
    )
    const charges = Array.isArray(payment.charges) ? payment.charges : []
    const firstCharge = asRecord(charges[0])
    const chargeId = getString(firstCharge.chargeId) || getString(firstCharge.id)

    if (!chargeId) {
      throw new Error("No Nexi Checkout charge id found for refundPayment")
    }

    return chargeId
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}

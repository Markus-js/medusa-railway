import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "production", process.cwd())

const backendUrl = process.env.MEDUSA_BACKEND_URL || process.env.BACKEND_URL || ""
const storefrontUrl = (
  process.env.STOREFRONT_URL ||
  process.env.CMS_STOREFRONT_URL ||
  "http://localhost:4321"
).replace(/\/$/, "")

const parseBoolean = (value: string | undefined, defaultValue = false) => {
  if (value === undefined) {
    return defaultValue
  }

  return value === "true"
}

const parseCsv = (value: string | undefined) =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

const nexiProvider = process.env.NEXI_CHECKOUT_SECRET_KEY
  ? [
      {
        resolve: "./src/modules/nexi-checkout",
        id: "nexi",
        options: {
          secretKey: process.env.NEXI_CHECKOUT_SECRET_KEY,
          environment: process.env.NEXI_CHECKOUT_ENV || "test",
          baseUrl: process.env.NEXI_CHECKOUT_BASE_URL,
          returnUrl:
            process.env.NEXI_CHECKOUT_RETURN_URL ||
            `${storefrontUrl}/shop/checkout/return`,
          cancelUrl:
            process.env.NEXI_CHECKOUT_CANCEL_URL ||
            `${storefrontUrl}/shop/cart`,
          termsUrl:
            process.env.NEXI_CHECKOUT_TERMS_URL ||
            `${storefrontUrl}/vilkaar`,
          merchantTermsUrl: process.env.NEXI_CHECKOUT_MERCHANT_TERMS_URL,
          checkoutUrl: process.env.NEXI_CHECKOUT_URL,
          webhookUrl:
            process.env.NEXI_CHECKOUT_WEBHOOK_URL ||
            (backendUrl
              ? `${backendUrl.replace(
                  /\/$/,
                  ""
                )}/hooks/payment/pp_nexi-checkout_nexi`
              : undefined),
          webhookAuthorization:
            process.env.NEXI_CHECKOUT_WEBHOOK_AUTHORIZATION,
          merchantNumber: process.env.NEXI_CHECKOUT_MERCHANT_NUMBER,
          countryCode: process.env.NEXI_CHECKOUT_COUNTRY_CODE || "DNK",
          autoCapture: parseBoolean(process.env.NEXI_CHECKOUT_AUTO_CAPTURE),
          merchantHandlesConsumerData: parseBoolean(
            process.env.NEXI_CHECKOUT_MERCHANT_HANDLES_CONSUMER_DATA,
            true
          ),
          paymentMethods: parseCsv(process.env.NEXI_CHECKOUT_PAYMENT_METHODS),
          webhookEvents: parseCsv(process.env.NEXI_CHECKOUT_WEBHOOK_EVENTS),
        },
      },
    ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    workerMode:
      (process.env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server") ||
      "shared",
    http: {
      storeCors: process.env.STORE_CORS || "",
      adminCors: process.env.ADMIN_CORS || "",
      authCors: process.env.AUTH_CORS || "",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },

  admin: {
    backendUrl,
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
  },

  modules: [
    {
      key: "api_key",
      resolve: "@medusajs/medusa/api-key",
    },
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: nexiProvider,
      },
    },
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "s3",
            options: {
              file_url: process.env.S3_FILE_URL,
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              region: process.env.S3_REGION,
              bucket: process.env.S3_BUCKET,
              endpoint: process.env.S3_ENDPOINT,
              additional_client_config: {
                forcePathStyle: true,
              },
            },
          },
        ],
      },
    },
  ],
})

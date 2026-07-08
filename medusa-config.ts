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

const s3AuthenticationMethod = process.env.S3_AUTHENTICATION_METHOD || "access-key"
const s3RequiredConfig = {
  S3_BUCKET: process.env.S3_BUCKET,
  S3_FILE_URL: process.env.S3_FILE_URL,
  S3_REGION: process.env.S3_REGION,
}
const s3RequiredAuth =
  s3AuthenticationMethod === "s3-iam-role"
    ? {}
    : {
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
      }
const s3Config = {
  ...s3RequiredConfig,
  ...s3RequiredAuth,
}
const configuredS3Entries = Object.entries(s3Config).filter(
  ([, value]) => !!value
)
const missingS3Entries = Object.entries(s3Config)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (configuredS3Entries.length > 0 && missingS3Entries.length > 0) {
  throw new Error(
    `Incomplete S3 file provider configuration. Missing: ${missingS3Entries.join(
      ", "
    )}`
  )
}

const fileProvider =
  configuredS3Entries.length > 0
    ? {
        resolve: "@medusajs/medusa/file-s3",
        id: "s3",
        options: {
          file_url: process.env.S3_FILE_URL,
          access_key_id: process.env.S3_ACCESS_KEY_ID,
          secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
          authentication_method: s3AuthenticationMethod,
          session_token: process.env.S3_SESSION_TOKEN,
          region: process.env.S3_REGION,
          bucket: process.env.S3_BUCKET,
          endpoint: process.env.S3_ENDPOINT,
          cache_control: process.env.S3_CACHE_CONTROL,
          download_file_duration: process.env.S3_DOWNLOAD_FILE_DURATION
            ? Number(process.env.S3_DOWNLOAD_FILE_DURATION)
            : undefined,
          prefix: process.env.S3_PREFIX,
          additional_client_config: {
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
          },
        },
      }
    : {
        resolve: "@medusajs/medusa/file-local",
        id: "local",
        options: {
          backend_url:
            process.env.LOCAL_FILE_BACKEND_URL ||
            `${backendUrl || `http://localhost:${process.env.PORT || 9000}`}/static`,
          upload_dir: process.env.LOCAL_FILE_UPLOAD_DIR,
          private_upload_dir: process.env.LOCAL_FILE_PRIVATE_UPLOAD_DIR,
        },
      }

if (!process.env.NEXI_CHECKOUT_SECRET_KEY) {
  console.warn(
    "Nexi Checkout provider is registered but missing NEXI_CHECKOUT_SECRET_KEY. It can be selected in Medusa Admin, but checkout will fail until the key is configured."
  )
}

const nexiProvider = [
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
        providers: [fileProvider],
      },
    },
  ],
})

import fs from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const sourcePath = path.join(
  root,
  "node_modules",
  "@medusajs",
  "dashboard",
  "src",
  "i18n",
  "translations",
  "en.json"
)
const outputPath = path.join(
  root,
  "src",
  "admin",
  "i18n",
  "translations",
  "da.json"
)

const TRANSLATE_URL =
  "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=da&dt=t"
const BATCH_SEPARATOR = "\n|||MEDUSA_SPLIT|||\n"

const DANISH_OVERRIDES = {
  "general.apply": "Anvend",
  "general.range": "Interval",
  "general.prev": "Forrige",
  "general.remaining": "Tilbage",
  "general.noRecordsTitle": "Ingen poster",
  "general.noRecordsMessage": "Der er ingen poster at vise",
  "actions.apply": "Anvend",
  "actions.complete": "Fuldfør",
  "actions.duplicate": "Dupliker",
  "fields.items": "Varer",
  "fields.minutes": "Minutter",
  "fields.order": "Ordre",
  "fields.product_tags": "Produkttags",
  "fields.province": "Provins",
  "fields.qty": "Antal",
  "fields.serviceZone": "Servicezone",
  "fields.state": "Stat",
  "app.search.openResult": "Åbn resultat",
  "app.search.groups.location": "Lokationer",
  "app.search.groups.reservation": "Reservationer",
  "app.menus.store.storeSettings": "Butiksindstillinger",
  "app.nav.main.storeSettings": "Butiksindstillinger",
}

const PROTECTED_PATTERNS = [
  /{{\s*[^}]+\s*}}/g,
  /<\/?\d+>/g,
  /<br\s*\/?>/gi,
  /https?:\/\/[^\s"')]+/g,
  /\/[a-zA-Z0-9_./:[\]-]+/g,
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function protect(value) {
  const replacements = []
  let result = value

  for (const pattern of PROTECTED_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const token = `QZX${replacements.length}XZQ`
      replacements.push({ token, value: match })
      return token
    })
  }

  return { value: result, replacements }
}

function restore(value, replacements) {
  let result = value

  for (const { token, value: original } of replacements) {
    const looseToken = token.split("").join("\\s*")
    result = result.replace(new RegExp(looseToken, "gi"), original)
  }

  return result
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
}

function shouldKeepEnglish(value) {
  if (!value.trim()) {
    return true
  }

  if (/^[A-Z0-9_./:[\]{}<>\-+|'" ]+$/.test(value) && value.length <= 16) {
    return true
  }

  return false
}

function collectStrings(node, entries = []) {
  if (typeof node === "string") {
    entries.push(node)
    return entries
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectStrings(item, entries))
    return entries
  }

  if (node && typeof node === "object") {
    Object.values(node).forEach((item) => collectStrings(item, entries))
  }

  return entries
}

function applyTranslations(node, translations) {
  if (typeof node === "string") {
    return translations.shift()
  }

  if (Array.isArray(node)) {
    return node.map((item) => applyTranslations(item, translations))
  }

  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        applyTranslations(value, translations),
      ])
    )
  }

  return node
}

function setPath(node, keyPath, value) {
  const keys = keyPath.split(".")
  let current = node

  for (const key of keys.slice(0, -1)) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return
    }

    current = current[key]
  }

  const finalKey = keys.at(-1)
  if (current && typeof current === "object" && finalKey in current) {
    current[finalKey] = value
  }
}

function applyDanishOverrides(translated) {
  for (const [keyPath, value] of Object.entries(DANISH_OVERRIDES)) {
    setPath(translated, keyPath, value)
  }
}

async function translateBatch(items) {
  const params = new URLSearchParams({
    q: items.map((item) => item.value).join(BATCH_SEPARATOR),
  })

  const response = await fetch(`${TRANSLATE_URL}&${params.toString()}`)

  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status}`)
  }

  const data = await response.json()
  const translated = data[0].map((entry) => entry?.[0] ?? "").join("")
  const parts = translated.split("|||MEDUSA_SPLIT|||").map((part) => part.trim())

  if (parts.length !== items.length) {
    if (items.length === 1) {
      return [restore(translated, items[0].replacements)]
    }

    const translatedItems = []
    for (const item of items) {
      translatedItems.push(...(await translateBatch([item])))
      await sleep(50)
    }

    return translatedItems
  }

  return parts.map((part, index) => restore(part, items[index].replacements))
}

async function translateAll(strings) {
  const translated = []
  let batch = []
  let batchLength = 0

  async function flush() {
    if (!batch.length) {
      return
    }

    const done = await translateBatch(batch)
    translated.push(...done)
    batch = []
    batchLength = 0
    await sleep(100)
  }

  for (const original of strings) {
    if (shouldKeepEnglish(original)) {
      await flush()
      translated.push(original)
      continue
    }

    const protectedValue = protect(original)
    const encodedLength = encodeURIComponent(protectedValue.value).length

    if (batch.length && batchLength + encodedLength > 3500) {
      await flush()
    }

    batch.push(protectedValue)
    batchLength += encodedLength
  }

  await flush()
  return translated
}

const source = JSON.parse(await fs.readFile(sourcePath, "utf8"))
const strings = collectStrings(source)

console.log(`[da-admin] Translating ${strings.length} dashboard strings...`)
const translations = await translateAll(strings)
const translated = applyTranslations(source, [...translations])
applyDanishOverrides(translated)

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${JSON.stringify(translated, null, 2)}\n`)

console.log(`[da-admin] Wrote ${path.relative(root, outputPath)}`)

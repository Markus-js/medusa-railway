import fs from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const languagesPath = path.join(
  root,
  "node_modules",
  "@medusajs",
  "dashboard",
  "src",
  "i18n",
  "languages.ts"
)
const dashboardDistPath = path.join(
  root,
  "node_modules",
  "@medusajs",
  "dashboard",
  "dist"
)

const danishLanguage = `  {
    code: "da",
    display_name: "Dansk",
    ltr: true,
    date_locale: da,
  },
`

async function patchLanguages() {
  const changed = await Promise.all([
    patchSourceLanguages(),
    patchCommonJsBundle(),
    patchEsmLanguageChunks(),
  ])

  if (changed.some(Boolean)) {
    console.log("[da-admin] Registered Danish in Medusa dashboard languages.")
    return
  }

  console.log("[da-admin] Medusa dashboard already includes Danish.")
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") {
      return null
    }

    throw error
  }
}

async function patchSourceLanguages() {
  const source = await readIfExists(languagesPath)
  if (!source) {
    console.warn(
      "[da-admin] Medusa dashboard source language registry not found; skipping source patch."
    )
    return false
  }

  let next = source

  if (!next.includes("  da,\n")) {
    next = next.replace("  cs,\n", "  cs,\n  da,\n")
  }

  if (!next.includes('code: "da"')) {
    next = next.replace(
      '  {\n    code: "de",',
      `${danishLanguage}  {\n    code: "de",`
    )
  }

  if (next === source) {
    return false
  }

  await fs.writeFile(languagesPath, next)
  return true
}

async function patchCommonJsBundle() {
  const bundlePath = path.join(dashboardDistPath, "app.js")
  const source = await readIfExists(bundlePath)
  if (!source) {
    return false
  }

  let next = source

  if (!next.includes('code: "da"')) {
    next = next.replace(
      '      {\n        code: "de",',
      `      {
        code: "da",
        display_name: "Dansk",
        ltr: true,
        date_locale: import_locale.da
      },
      {
        code: "de",`
    )
  }

  if (next === source) {
    return false
  }

  await fs.writeFile(bundlePath, next)
  return true
}

async function patchEsmLanguageChunks() {
  let entries

  try {
    entries = await fs.readdir(dashboardDistPath, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") {
      return false
    }

    throw error
  }

  let changed = false
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) {
      continue
    }

    const filePath = path.join(dashboardDistPath, entry.name)
    const source = await fs.readFile(filePath, "utf8")
    if (
      !source.includes("// src/i18n/languages.ts") ||
      !source.includes("var languages = [")
    ) {
      continue
    }

    let next = source

    if (!next.includes("  da,\n")) {
      next = next.replace("  cs,\n", "  cs,\n  da,\n")
    }

    if (!next.includes('code: "da"')) {
      next = next.replace(
        '  {\n    code: "de",',
        `  {
    code: "da",
    display_name: "Dansk",
    ltr: true,
    date_locale: da
  },
  {
    code: "de",`
      )
    }

    if (next !== source) {
      await fs.writeFile(filePath, next)
      changed = true
    }
  }

  return changed
}

await patchLanguages()

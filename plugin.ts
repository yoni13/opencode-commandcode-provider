import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CATALOG_URL = "https://raw.githubusercontent.com/yoni13/opencode-commandcode-provider/main/models.json"
const CATALOG_TIMEOUT_MS = 5000

type OpencodeModality = "text" | "audio" | "image" | "video" | "pdf"

interface ModelEntry {
  id: string
  name: string
  tier: "premium" | "open-source"
  reasoning: boolean
  attachment?: boolean
  modalities?: { input: OpencodeModality[]; output: OpencodeModality[] }
  reasoning_efforts?: string[]
  variants?: Record<string, { reasoningEffort: string }>
  tool_call: boolean
  cost: { input: number; output: number; cache_read?: number; cache_write?: number }
  limit: { context: number; output: number }
}

interface CommandCodePluginOptions {
  autoUpdateModels?: boolean
  excludePremiumModels?: boolean
  modelCatalogUrl?: string
}

function loadBundledModels(): ModelEntry[] {
  const modelsPath = join(__dirname, "models.json")
  return JSON.parse(readFileSync(modelsPath, "utf-8"))
}

function isModelEntry(value: unknown): value is ModelEntry {
  if (typeof value !== "object" || value === null) return false
  const model = value as Partial<ModelEntry>
  return typeof model.id === "string" &&
    typeof model.name === "string" &&
    (model.tier === "premium" || model.tier === "open-source") &&
    typeof model.cost?.input === "number" &&
    typeof model.cost?.output === "number" &&
    typeof model.limit?.context === "number" &&
    typeof model.limit?.output === "number"
}

async function loadRemoteModels(url: string, bundled: ModelEntry[]): Promise<ModelEntry[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return bundled
    const remote = await response.json()
    if (!Array.isArray(remote) || !remote.every(isModelEntry)) return bundled

    // Never replace a newer bundled catalog with stale remote data.
    return remote.length >= bundled.length ? remote : bundled
  } catch {
    return bundled
  } finally {
    clearTimeout(timeout)
  }
}

async function loadModels(options: CommandCodePluginOptions): Promise<ModelEntry[]> {
  const bundled = loadBundledModels()
  if (options.autoUpdateModels === false) return bundled
  return loadRemoteModels(options.modelCatalogUrl ?? DEFAULT_CATALOG_URL, bundled)
}

function toConfigKey(id: string): string {
  const slashIdx = id.indexOf("/")
  const short = slashIdx >= 0 ? id.slice(slashIdx + 1) : id
  return short.toLowerCase()
}

function buildReasoningVariants(efforts: string[] | undefined): Record<string, { reasoningEffort: string }> | undefined {
  if (!efforts?.length) return undefined
  return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
}

const AUTH_KEY_FIELDS = [
  "key",
  "apiKey",
  "apikey",
  "api_key",
  "token",
  "accessToken",
  "access_token",
  "value",
  "password",
]

function extractAuthKey(input: unknown): string | undefined {
  if (typeof input === "string") {
    const key = input.trim()
    return key || undefined
  }

  if (typeof input !== "object" || input === null) return undefined

  const record = input as Record<string, unknown>
  for (const field of AUTH_KEY_FIELDS) {
    const value = record[field]
    if (typeof value !== "string") continue
    const key = value.trim()
    if (key) return key
  }

  const stringValues = Object.values(record)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
  return stringValues.length === 1 ? stringValues[0] : undefined
}

export default async function commandcodePlugin(
  _input?: unknown,
  pluginOptions: CommandCodePluginOptions = {},
) {
  return {
    config: async (config: Record<string, unknown>) => {
      const providers = config.provider as Record<string, Record<string, unknown>> | undefined
      if (!providers) {
        (config as Record<string, unknown>).provider = { commandcode: {} }
      }
      const cc = ((config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>)?.commandcode as Record<string, unknown> | undefined
      if (!cc) return

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider"
      if (!cc.name) cc.name = "Command Code"
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"]

      if (!cc.models) {
        const providerOptions = (typeof cc.options === "object" && cc.options !== null
          ? cc.options
          : {}) as CommandCodePluginOptions
        const options = { ...providerOptions, ...pluginOptions }
        const models = (await loadModels(options)).filter(
          (entry) => !options.excludePremiumModels || entry.tier !== "premium",
        )
        const modelsObj: Record<string, unknown> = {}
        for (const entry of models) {
          const key = toConfigKey(entry.id)
          const costObj: Record<string, number> = { input: entry.cost.input, output: entry.cost.output }
          if (entry.cost.cache_read !== undefined) costObj.cache_read = entry.cost.cache_read
          if (entry.cost.cache_write !== undefined) costObj.cache_write = entry.cost.cache_write
          const variants = entry.variants ?? buildReasoningVariants(entry.reasoning_efforts)

          modelsObj[key] = {
            id: entry.id,
            name: entry.name,
            reasoning: entry.reasoning,
            ...(entry.attachment !== undefined ? { attachment: entry.attachment } : {}),
            ...(entry.modalities ? { modalities: entry.modalities } : {}),
            ...(entry.reasoning_efforts ? { reasoning_efforts: entry.reasoning_efforts } : {}),
            ...(variants ? { variants } : {}),
            tool_call: entry.tool_call,
            cost: costObj,
            limit: entry.limit,
          }
        }
        cc.models = modelsObj
      }
    },

    auth: {
      provider: "commandcode",
      methods: [
        {
          type: "api",
          label: "API Key",
        },
      ],
      loader: async (getAuth: () => Promise<Record<string, unknown> | null>) => {
        try {
          const auth = await getAuth()
          if (!auth) return {}
          const key = extractAuthKey(auth)
          if (auth.type === "api" && key) return { apiKey: key }
          return {}
        } catch {
          return {}
        }
      },
    },
  }
}

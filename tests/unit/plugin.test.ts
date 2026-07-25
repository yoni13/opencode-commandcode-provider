import { expect, test, beforeAll } from "bun:test"

type PluginResult = {
  config: (config: Record<string, unknown>) => Promise<void>
  auth: {
    provider: string
    methods: Array<{
      type: string
      label: string
      authorize?: (inputs: unknown) => Promise<{ type: string; key?: string }>
    }>
    loader: (getAuth: () => Promise<Record<string, unknown> | null>) => Promise<Record<string, unknown>>
  }
}

type PluginOptions = {
  autoUpdateModels?: boolean
  excludePremiumModels?: boolean
  modelCatalogUrl?: string
}

type PluginModule = {
  default: (input?: unknown, options?: PluginOptions) => Promise<PluginResult>
}

let pluginFn: PluginModule["default"]

function createPlugin(options: PluginOptions = {}) {
  return pluginFn(undefined, { autoUpdateModels: false, ...options })
}

beforeAll(async () => {
  const mod = await import("../../plugin.ts")
  pluginFn = mod.default
})

test("plugin returns correct provider name", async () => {
  const plugin = await createPlugin()
  expect(plugin.auth.provider).toBe("commandcode")
})

test("api auth method lets opencode save the prompted key directly", async () => {
  const plugin = await createPlugin()
  expect(plugin.auth.methods[0]).toEqual({
    type: "api",
    label: "API Key",
  })
})

test("loader returns apiKey on successful auth", async () => {
  const plugin = await createPlugin()
  const result = await plugin.auth.loader(async () => ({
    type: "api",
    key: "sk-loaded-key",
  }))
  expect(result).toEqual({ apiKey: "sk-loaded-key" })
})

test("loader accepts API key field aliases", async () => {
  const plugin = await createPlugin()
  const result = await plugin.auth.loader(async () => ({
    type: "api",
    apiKey: "sk-loaded-key",
  }))
  expect(result).toEqual({ apiKey: "sk-loaded-key" })
})

test("loader returns empty object on null auth", async () => {
  const plugin = await createPlugin()
  const result = await plugin.auth.loader(async () => null)
  expect(result).toEqual({})
})

test("loader returns empty object on wrong auth type", async () => {
  const plugin = await createPlugin()
  const result = await plugin.auth.loader(async () => ({
    type: "oauth",
    key: "some-token",
  } as Record<string, unknown>))
  expect(result).toEqual({})
})

test("loader returns empty object when getAuth throws", async () => {
  const plugin = await createPlugin()
  const result = await plugin.auth.loader(async () => {
    throw new Error("auth failed")
  })
  expect(result).toEqual({})
})

test("config hook registers provider with npm and models", async () => {
  const plugin = await createPlugin()
  const config: Record<string, unknown> = {
    provider: { commandcode: {} },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  expect(cc.npm).toBe("commandcode-go-opencode-provider")
  expect(cc.name).toBe("Command Code")
  expect(cc.env).toEqual(["COMMANDCODE_API_KEY"])
  expect(cc.models).toBeDefined()
  const models = cc.models as Record<string, unknown>
  expect(Object.keys(models).length).toBeGreaterThan(0)
})

test("config hook can exclude premium models", async () => {
  const plugin = await createPlugin()
  const config: Record<string, unknown> = {
    provider: {
      commandcode: {
        options: { excludePremiumModels: true },
      },
    },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  const models = cc.models as Record<string, Record<string, unknown>>
  expect(Object.keys(models).length).toBeGreaterThan(0)
  expect(Object.values(models).some((model) =>
    String(model.name).startsWith("[Premium] "),
  )).toBe(false)
  expect(models["claude-sonnet-5"]).toBeUndefined()
})

test("config hook can update models from a remote catalog", async () => {
  const bundled = JSON.parse(
    await Bun.file(new URL("../../models.json", import.meta.url)).text(),
  ) as Array<Record<string, unknown>>
  const remote = bundled.map((model, index) =>
    index === 0 ? { ...model, name: "Remote catalog model" } : model,
  )
  const modelCatalogUrl = `data:application/json,${encodeURIComponent(JSON.stringify(remote))}`
  const plugin = await pluginFn(undefined, { autoUpdateModels: true, modelCatalogUrl })
  const config: Record<string, unknown> = {
    provider: { commandcode: {} },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  const models = cc.models as Record<string, Record<string, unknown>>
  const firstId = String(remote[0].id)
  expect(models[firstId.toLowerCase()].name).toBe("Remote catalog model")
})

test("config hook exposes reasoning efforts as opencode variants", async () => {
  const plugin = await createPlugin()
  const config: Record<string, unknown> = {
    provider: { commandcode: {} },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  const models = cc.models as Record<string, Record<string, unknown>>
  const sonnet = models["claude-sonnet-4-6"]

  expect(sonnet.reasoning_efforts).toEqual(["low", "medium", "high", "xhigh", "max"])
  expect(sonnet.variants).toEqual({
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    xhigh: { reasoningEffort: "xhigh" },
    max: { reasoningEffort: "max" },
  })
})

test("config hook exposes vision models as opencode attachments", async () => {
  const plugin = await createPlugin()
  const config: Record<string, unknown> = {
    provider: { commandcode: {} },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  const models = cc.models as Record<string, Record<string, unknown>>
  const sonnet = models["claude-sonnet-4-6"]

  expect(sonnet.attachment).toBe(true)
  expect(sonnet.modalities).toEqual({
    input: ["text", "image"],
    output: ["text"],
  })
})

test("config hook does not overwrite existing npm field", async () => {
  const plugin = await createPlugin()
  const config: Record<string, unknown> = {
    provider: { commandcode: { npm: "custom-package" } },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  expect(cc.npm).toBe("custom-package")
})

test("config hook does not overwrite existing models", async () => {
  const plugin = await createPlugin()
  const config: Record<string, unknown> = {
    provider: { commandcode: { models: { "my-model": { id: "my-model" } } } },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  const models = cc.models as Record<string, unknown>
  expect(Object.keys(models)).toEqual(["my-model"])
})

test("config hook creates provider block if missing", async () => {
  const plugin = await createPlugin()
  const config: Record<string, unknown> = {}
  await plugin.config(config)

  expect(config.provider).toBeDefined()
  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  expect(cc).toBeDefined()
  expect(cc.npm).toBe("commandcode-go-opencode-provider")
})

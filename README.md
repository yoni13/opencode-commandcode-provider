# opencode-commandcode-provider

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

This is a community fork — install directly from GitHub:

## Quick Start

### 1. Install

```bash
opencode plugin https://github.com/yoni13/opencode-commandcode-provider
```

This installs the provider and registers all available models automatically.

### 2. Connect

Run `/connect` in opencode, search for **Command Code**, and enter your API key:

```
/connect
```

Multiple keys can be entered as a comma-separated list:

```text
key1,key2,key3
```

When a key reports insufficient credits, the provider switches to the next key. Key values are never included in status messages or logs.

### 3. Select a model

Run `/models` to pick from available models:

```
/models
```

## Manual Configuration

If you prefer to configure manually, add this to your `opencode.json`:

```json
{
  "plugin": ["https://github.com/yoni13/opencode-commandcode-provider/server"],
  "provider": {
    "commandcode": {
      "npm": "https://github.com/yoni13/opencode-commandcode-provider",
      "name": "Command Code",
      "env": ["COMMANDCODE_API_KEY"],
      "options": {
        "excludePremiumModels": true
      }
    }
  },
  "model": "commandcode/deepseek-v4-flash"
}
```

The plugin auto-registers models from [`models.json`](./models.json) at startup. You only need the `provider.commandcode` block — no need to list individual models.

`excludePremiumModels: true` removes every model marked as premium from the opencode model picker. It defaults to `false`.

The plugin checks this fork's latest `models.json` at startup and falls back to its bundled catalog if the request fails, times out, is invalid, or is older than the bundled catalog. Set `autoUpdateModels: false` under `provider.commandcode.options` to disable this check. A scheduled GitHub workflow refreshes the repository catalog daily from the latest Command Code CLI and pricing page.

### Environment Variable

Set `COMMANDCODE_API_KEY` instead of using `/connect`:

```bash
COMMANDCODE_API_KEY=your-key opencode
```

The environment variable also accepts comma-separated keys:

```bash
COMMANDCODE_API_KEY=key1,key2,key3 opencode
```

### Reasoning Effort

Some Command Code models support explicit reasoning effort. When calling the provider through the AI SDK, pass the setting under the `commandcode` provider options:

```ts
import { streamText } from "ai"
import { createCommandCode } from "commandcode-go-opencode-provider"

const commandcode = createCommandCode()

await streamText({
  model: commandcode.languageModel("claude-sonnet-4-6"),
  prompt: "Implement the next task.",
  providerOptions: {
    commandcode: {
      reasoningEffort: "high",
    },
  },
})
```

The provider sends this as `reasoning_effort` to Command Code. Supported values are `low`, `medium`, `high`, `xhigh`, and `max`, depending on the selected model. The generated [`models.json`](./models.json) records per-model support in `reasoning_efforts` and exposes them to opencode as model `variants`, so the opencode variant picker can select the effort when the installed opencode build supports variants.

### Vision Inputs

Models that Command Code publishes with image input support are exposed to opencode with `attachment: true` and `modalities.input: ["text", "image"]`. Image inputs from the AI SDK are forwarded as Command Code image content, including URL, data URL, base64 string, and `Uint8Array` file parts.

## Available Models

| Model ID | Name | Tier | Reasoning | Context |
|---|---|---|---|---|
| `claude-fable-5`                           | [Premium] Claude Fable 5    | premium      | yes | 1M     |
| `claude-haiku-4-5-20251001`                | [Premium] Claude Haiku 4.5  | premium      | no  | 200K   |
| `claude-opus-4-7`                          | [Premium] Claude Opus 4.7   | premium      | yes | 1M     |
| `claude-opus-4-8`                          | [Premium] Claude Opus 4.8   | premium      | yes | 1M     |
| `claude-opus-5`                            | [Premium] Claude Opus 5     | premium      | yes | 1M     |
| `claude-sonnet-4-6`                        | [Premium] Claude Sonnet 4.6 | premium      | yes | 1M     |
| `claude-sonnet-5`                          | [Premium] Claude Sonnet 5   | premium      | yes | 1M     |
| `google/gemini-3.1-flash-lite`             | [Premium] Gemini 3.1 Flash Lite | premium      | yes | 1M     |
| `google/gemini-3.5-flash`                  | [Premium] Gemini 3.5 Flash  | premium      | yes | 1M     |
| `google/gemini-3.5-flash-lite`             | [Premium] Gemini 3.5 Flash Lite | premium      | yes | 1M     |
| `google/gemini-3.6-flash`                  | [Premium] Gemini 3.6 Flash  | premium      | yes | 1M     |
| `google/gemini-3.7-flash`                  | [Premium] Gemini 3.7 Flash  | premium      | yes | 1M     |
| `gpt-5.3-codex`                            | [Premium] GPT-5.3 Codex     | premium      | yes | 400K   |
| `gpt-5.4`                                  | [Premium] GPT-5.4           | premium      | yes | 400K   |
| `gpt-5.4-mini`                             | [Premium] GPT-5.4 Mini      | premium      | yes | 400K   |
| `gpt-5.5`                                  | [Premium] GPT-5.5           | premium      | yes | 256K   |
| `gpt-5.6-sol`                              | [Premium] GPT-5.6 Sol       | premium      | yes | 1M     |
| `poolside/laguna-s-2.1-free`               | [Free] Laguna S 2.1         | open-source  | yes | 256K   |
| `inclusionai/ling-3.0-flash-free`          | [Free] Ling 3.0 Flash       | open-source  | yes | 256K   |
| `MiniMaxAI/MiniMax-M3-Free`                | [Free] MiniMax M3           | open-source  | yes | 1M     |
| `tencent/Hy3`                              | [Free] Tencent Hy3 (Free)   | open-source  | yes | 262K   |
| `deepseek/deepseek-v4-flash`               | DeepSeek V4 Flash (latest)  | open-source  | yes | 1M     |
| `deepseek/deepseek-v4-pro`                 | DeepSeek V4 Pro (latest)    | open-source  | yes | 1M     |
| `sakana/fugu-ultra`                        | Fugu Ultra                  | open-source  | yes | 1M     |
| `zai-org/GLM-5`                            | GLM-5                       | open-source  | no  | 200K   |
| `zai-org/GLM-5.1`                          | GLM-5.1                     | open-source  | no  | 200K   |
| `zai-org/GLM-5.2`                          | GLM-5.2                     | open-source  | yes | 1M     |
| `zai-org/GLM-5.2-Fast`                     | GLM-5.2 Fast                | open-source  | no  | 1M     |
| `zai-org/GLM-5.3`                          | GLM-5.3                     | open-source  | yes | 1M     |
| `gpt-5.6-luna`                             | GPT-5.6 Luna                | open-source  | yes | 1M     |
| `gpt-5.6-terra`                            | GPT-5.6 Terra               | open-source  | yes | 1M     |
| `xai/grok-4.5`                             | Grok 4.5                    | open-source  | yes | 500K   |
| `xai/grok-4.6`                             | Grok 4.6                    | open-source  | yes | 500K   |
| `thinkingmachines/inkling`                 | Inkling                     | open-source  | yes | 256K   |
| `thinkingmachines/inkling-small`           | Inkling Small               | open-source  | yes | 1M     |
| `moonshotai/Kimi-K2.5`                     | Kimi K2.5                   | open-source  | no  | 256K   |
| `moonshotai/Kimi-K2.6`                     | Kimi K2.6                   | open-source  | no  | 256K   |
| `moonshotai/Kimi-K2.7-Code`                | Kimi K2.7 Code              | open-source  | yes | 256K   |
| `moonshotai/Kimi-K2.7-Code-Highspeed`      | Kimi K2.7 Code HighSpeed    | open-source  | yes | 262K   |
| `moonshotai/Kimi-K3`                       | Kimi K3                     | open-source  | yes | 1M     |
| `xiaomi/mimo-v2.5`                         | MiMo V2.5                   | open-source  | no  | 1M     |
| `xiaomi/mimo-v2.5-pro`                     | MiMo V2.5 Pro               | open-source  | no  | 1M     |
| `MiniMaxAI/MiniMax-M2.5`                   | MiniMax M2.5                | open-source  | no  | 200K   |
| `MiniMaxAI/MiniMax-M2.7`                   | MiniMax M2.7                | open-source  | no  | 1M     |
| `MiniMaxAI/MiniMax-M3`                     | MiniMax M3                  | open-source  | yes | 1M     |
| `meta/muse-spark-1.1`                      | Muse Spark 1.1              | open-source  | yes | 1M     |
| `meta/muse-spark-1.2`                      | Muse Spark 1.2              | open-source  | yes | 1M     |
| `meta/muse-spark-1.2-contributor`          | Muse Spark 1.2 Contributor  | open-source  | yes | 1M     |
| `nvidia/nemotron-3-ultra-550b-a55b`        | Nemotron 3 Ultra            | open-source  | yes | 1M     |
| `Qwen/Qwen3.6-Max-Preview`                 | Qwen 3.6 Max Preview        | open-source  | yes | 1M     |
| `Qwen/Qwen3.6-Plus`                        | Qwen 3.6 Plus               | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Flash`                       | Qwen 3.7 Flash              | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Max`                         | Qwen 3.7 Max                | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Plus`                        | Qwen 3.7 Plus               | open-source  | yes | 1M     |
| `Qwen/Qwen3.8-Max`                         | Qwen 3.8 Max                | open-source  | yes | 1M     |
| `stepfun/Step-3.5-Flash`                   | Step 3.5 Flash              | open-source  | yes | 1M     |
| `stepfun/Step-3.7-Flash`                   | Step 3.7 Flash              | open-source  | yes | 256K   |
| `tencent/hy3-paid`                         | Tencent Hy3                 | open-source  | yes | 262K   |

Full model list is maintained in [`models.json`](./models.json). See [Sync Models](#sync-models) to refresh it from the latest Command Code CLI release.

## Development

```bash
git clone https://github.com/yoni13/opencode-commandcode-provider.git
cd commandcode-go-opencode-provider
bun install
```

For local testing, create `opencode.local.json` (gitignored) with `file://` paths:

```json
{
  "plugin": ["file:///path/to/commandcode-go-opencode-provider/server"],
  "provider": {
    "commandcode": {
      "npm": "file:///path/to/commandcode-go-opencode-provider",
      "name": "Command Code (local)",
      "env": ["COMMANDCODE_API_KEY"]
    }
  }
}
```

Run `opencode --config opencode.local.json` to test with your local build.

### Sync Models

Refresh the model catalog whenever Command Code publishes new models:

```bash
bun install
bun run sync
bun run generate-readme
bun run typecheck
```

`bun run sync` downloads the latest `command-code` package from npm, extracts its model catalog and CLI pricing table, fetches public pricing from `https://commandcode.ai/models`, and writes [`models.json`](./models.json). Models without published pricing are still included with a `$0/$0` placeholder so the catalog does not silently drop newly available models.

`bun run generate-readme` rebuilds the Available Models table from `models.json`.

To also write the refreshed model map into your local global config, run:

```bash
bun run sync:global
```

## License

MIT

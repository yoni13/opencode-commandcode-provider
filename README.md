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
      "env": ["COMMANDCODE_API_KEY"]
    }
  },
  "model": "commandcode/deepseek-v4-flash"
}
```

The plugin auto-registers models from [`models.json`](./models.json) at startup. You only need the `provider.commandcode` block — no need to list individual models.

### Environment Variable

Set `COMMANDCODE_API_KEY` instead of using `/connect`:

```bash
COMMANDCODE_API_KEY=your-key opencode
```

The environment variable also accepts comma-separated keys:

```bash
COMMANDCODE_API_KEY=key1,key2,key3 opencode
```

## Available Models

| Model ID | Name | Tier | Reasoning | Context |
|---|---|---|---|---|
| `claude-fable-5`                           | [Premium] Claude Fable 5    | premium      | yes | 1M     |
| `claude-haiku-4-5-20251001`                | [Premium] Claude Haiku 4.5  | premium      | no  | 200K   |
| `claude-opus-4-7`                          | [Premium] Claude Opus 4.7   | premium      | yes | 1M     |
| `claude-opus-4-8`                          | [Premium] Claude Opus 4.8   | premium      | yes | 1M     |
| `claude-sonnet-4-6`                        | [Premium] Claude Sonnet 4.6 | premium      | yes | 1M     |
| `google/gemini-3.1-flash-lite`             | [Premium] Gemini 3.1 Flash Lite | premium      | yes | 1M     |
| `google/gemini-3.5-flash`                  | [Premium] Gemini 3.5 Flash  | premium      | yes | 1M     |
| `gpt-5.3-codex`                            | [Premium] GPT-5.3 Codex     | premium      | yes | 400K   |
| `gpt-5.4`                                  | [Premium] GPT-5.4           | premium      | yes | 400K   |
| `gpt-5.4-mini`                             | [Premium] GPT-5.4 Mini      | premium      | yes | 400K   |
| `gpt-5.5`                                  | [Premium] GPT-5.5           | premium      | yes | 256K   |
| `MiniMaxAI/MiniMax-M3-Free`                | [Free] MiniMax M3           | open-source  | yes | 1M     |
| `deepseek/deepseek-v4-flash`               | DeepSeek V4 Flash           | open-source  | yes | 1M     |
| `deepseek/deepseek-v4-pro`                 | DeepSeek V4 Pro             | open-source  | yes | 1M     |
| `zai-org/GLM-5`                            | GLM-5                       | open-source  | no  | 200K   |
| `zai-org/GLM-5.1`                          | GLM-5.1                     | open-source  | no  | 200K   |
| `zai-org/GLM-5.2`                          | GLM-5.2                     | open-source  | no  | 1M     |
| `moonshotai/Kimi-K2.5`                     | Kimi K2.5                   | open-source  | no  | 256K   |
| `moonshotai/Kimi-K2.6`                     | Kimi K2.6                   | open-source  | no  | 256K   |
| `moonshotai/Kimi-K2.7-Code`                | Kimi K2.7 Code              | open-source  | yes | 256K   |
| `moonshotai/Kimi-K2.7-Code-Highspeed`      | Kimi K2.7 Code HighSpeed    | open-source  | yes | 262K   |
| `xiaomi/mimo-v2.5`                         | MiMo V2.5                   | open-source  | no  | 1M     |
| `xiaomi/mimo-v2.5-pro`                     | MiMo V2.5 Pro               | open-source  | no  | 1M     |
| `MiniMaxAI/MiniMax-M2.5`                   | MiniMax M2.5                | open-source  | no  | 200K   |
| `MiniMaxAI/MiniMax-M2.7`                   | MiniMax M2.7                | open-source  | no  | 1M     |
| `MiniMaxAI/MiniMax-M3`                     | MiniMax M3                  | open-source  | yes | 1M     |
| `nvidia/nemotron-3-ultra-550b-a55b`        | Nemotron 3 Ultra            | open-source  | yes | 1M     |
| `Qwen/Qwen3.6-Max-Preview`                 | Qwen 3.6 Max Preview        | open-source  | yes | 1M     |
| `Qwen/Qwen3.6-Plus`                        | Qwen 3.6 Plus               | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Max`                         | Qwen 3.7 Max                | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Plus`                        | Qwen 3.7 Plus               | open-source  | yes | 1M     |
| `stepfun/Step-3.5-Flash`                   | Step 3.5 Flash              | open-source  | yes | 1M     |
| `stepfun/Step-3.7-Flash`                   | Step 3.7 Flash              | open-source  | yes | 256K   |

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

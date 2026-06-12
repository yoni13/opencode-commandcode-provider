import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamResult,
  LanguageModelV3GenerateResult,
  LanguageModelV3Content,
  LanguageModelV3Usage,
  LanguageModelV3FinishReason,
} from "@ai-sdk/provider"
import { buildRequest } from "./convert.js"
import { parseStreamEvents } from "./stream.js"

const DEFAULT_BASE_URL = "https://api.commandcode.ai"
// x-command-code-version must match the Command Code CLI version for API compatibility
const CC_VERSION = "0.26.20"

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export interface CommandCodeModelOptions {
  apiKey: string
  baseURL?: string
  headers?: Record<string, string>
  maxRetries?: number
  retryDelayMs?: number
}

export class CommandCodeLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider = "commandcode"
  readonly modelId: string
  supportedUrls: Record<string, RegExp[]> = {}

  private opts: CommandCodeModelOptions

  constructor(modelId: string, opts: CommandCodeModelOptions) {
    this.modelId = modelId
    this.opts = opts
  }

  private get baseURL(): string {
    return this.opts.baseURL ?? DEFAULT_BASE_URL
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.opts.apiKey}`,
      "x-command-code-version": CC_VERSION,
      "x-cli-environment": "production",
      "x-project-slug": "opencode",
      ...this.opts.headers,
    }
  }

  private async fetchWithRetry(requestBody: string, abortSignal: AbortSignal): Promise<Response> {
    const maxRetries = this.opts.maxRetries ?? 3
    const retryDelayMs = this.opts.retryDelayMs ?? 1000
    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutMs = 300_000 + attempt * 60_000
        const timeout = setTimeout(() => controller.abort(new Error("Request timed out after 5 minutes")), timeoutMs)

        const onAbort = () => controller.abort(abortSignal.reason)
        abortSignal.addEventListener("abort", onAbort, { once: true })

        try {
          const response = await fetch(`${this.baseURL}/alpha/generate`, {
            method: "POST",
            headers: this.buildHeaders(),
            body: requestBody,
            signal: controller.signal,
          })

          if (!response.ok && RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
            const delay = retryDelayMs * Math.pow(2, attempt)
            console.warn(`Command Code API ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
            await new Promise((r) => setTimeout(r, delay))
            continue
          }

          if (!response.ok) {
            const errorBody = await response.text().catch(() => "")
            let errorMessage = `Command Code API error: ${response.status} ${response.statusText}`
            try {
              const parsed = JSON.parse(errorBody)
              if (parsed.error?.message) errorMessage = parsed.error.message
              else if (parsed.message) errorMessage = parsed.message
            } catch {
              // intentionally silent: error body is not JSON
            }
            throw new Error(`${errorMessage} [model=${this.modelId}]`)
          }

          return response
        } finally {
          clearTimeout(timeout)
          abortSignal.removeEventListener("abort", onAbort)
        }
      } catch (err) {
        lastError = err
        const isAbort = err instanceof DOMException || (err instanceof Error && err.name === "AbortError")

        if (isAbort && attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt)
          console.warn(`Command Code request aborted, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        if (isAbort) throw err
        if (attempt >= maxRetries) throw err
      }
    }

    throw lastError
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const body = buildRequest(this.modelId, options)
    const requestBody = JSON.stringify(body)

    const controller = new AbortController()
    const userSignal = options.abortSignal
    if (userSignal) {
      const onAbort = () => controller.abort(userSignal.reason)
      userSignal.addEventListener("abort", onAbort, { once: true })
    }

    const response = await this.fetchWithRetry(requestBody, controller.signal)

    if (!response.body) {
      throw new Error(`Command Code API returned no body [model=${this.modelId}]`)
    }

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v
    })

    return {
      stream: parseStreamEvents(response.body as ReadableStream<Uint8Array>),
      request: { body: requestBody },
      response: { headers: responseHeaders },
    }
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { stream } = await this.doStream(options)

    const textParts: string[] = []
    const reasoningParts: string[] = []
    const content: LanguageModelV3Content[] = []
    let finishReason: LanguageModelV3FinishReason = { unified: "stop", raw: "stop" }
    let usage: LanguageModelV3Usage = {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    }

    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        switch (value.type) {
          case "text-delta":
            textParts.push(value.delta)
            break
          case "reasoning-delta":
            reasoningParts.push(value.delta)
            break
          case "tool-call":
            content.push({
              type: "tool-call",
              toolCallId: value.toolCallId,
              toolName: value.toolName,
              input: value.input,
            })
            break
          case "finish":
            finishReason = value.finishReason
            usage = value.usage
            break
        }
      }
    } finally {
      reader.releaseLock()
      stream.cancel()
    }

    const text = textParts.join("")
    if (text) content.unshift({ type: "text", text })

    const reasoning = reasoningParts.join("")
    if (reasoning) content.unshift({ type: "reasoning", text: reasoning })

    return {
      content,
      finishReason,
      usage,
      warnings: [],
    }
  }
}

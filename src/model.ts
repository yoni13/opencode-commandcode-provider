import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3GenerateResult,
  LanguageModelV3Content,
  LanguageModelV3Usage,
  LanguageModelV3FinishReason,
} from "@ai-sdk/provider"
import { randomUUID } from "crypto"
import { buildRequest } from "./convert.js"
import { parseStreamEvents } from "./stream.js"

const DEFAULT_BASE_URL = "https://api.commandcode.ai"
// x-command-code-version must match the Command Code CLI version for API compatibility
const CC_VERSION = "0.40.0"

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
  private apiKeys: string[]
  private keyIndex = 0
  private sessionId = randomUUID()

  constructor(modelId: string, opts: CommandCodeModelOptions) {
    this.modelId = modelId
    this.opts = opts
    this.apiKeys = [...new Set(
      opts.apiKey
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    )]
    if (this.apiKeys.length === 0) {
      throw new Error("Command Code API key not found")
    }
  }

  private get baseURL(): string {
    return this.opts.baseURL ?? DEFAULT_BASE_URL
  }

  private get projectSlug(): string {
    return "commandcode-provider"
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKeys[this.keyIndex]}`,
      "x-command-code-version": CC_VERSION,
      "x-cli-environment": "production",
      "x-project-slug": this.projectSlug,
      "x-co-flag": "false",
      "x-taste-learning": "false",
      "x-session-id": this.sessionId,
      ...this.opts.headers,
    }
  }

  private isInsufficientCredits(message: string): boolean {
    const normalized = message.toLowerCase()
    return normalized.includes("insufficient credit") ||
      normalized.includes("credits exhausted") ||
      normalized.includes("credit balance") ||
      normalized.includes("quota exceeded") ||
      normalized.includes("usage exceeded")
  }

  private errorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
      const message = (error as Record<string, unknown>).message
      if (typeof message === "string") return message
      return JSON.stringify(error)
    }
    return String(error)
  }

  private isRateLimitError(error: unknown, message: string): boolean {
    const normalized = message.toLowerCase()
    if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
      return true
    }

    if (typeof error !== "object" || error === null) return false
    const record = error as Record<string, unknown>
    return record.status === 429 ||
      record.statusCode === 429 ||
      record.type === "rate_limit_error" ||
      (typeof record.error === "object" &&
        record.error !== null &&
        (record.error as Record<string, unknown>).type === "rate_limit_error")
  }

  private isRetryableStreamError(error: unknown, message: string): boolean {
    if (this.isRateLimitError(error, message)) return false
    if (message.toLowerCase().includes("network connection lost")) return true
    return typeof error === "object" &&
      error !== null &&
      (error as Record<string, unknown>).isRetryable === true
  }

  private isRetryableHttpError(response: Response, parsedBody: unknown, message: string): boolean {
    if (this.isRateLimitError(parsedBody, message) || response.status === 429) return false
    if (response.status === 529) return false

    if (typeof parsedBody === "object" &&
        parsedBody !== null &&
        (parsedBody as Record<string, unknown>).isRetryable === true) {
      return true
    }

    return response.status >= 500 && response.status < 600
  }

  private selectNextAvailableKey(exhaustedKeyIndexes: Set<number>): boolean {
    for (let offset = 1; offset <= this.apiKeys.length; offset++) {
      const candidate = (this.keyIndex + offset) % this.apiKeys.length
      if (!exhaustedKeyIndexes.has(candidate)) {
        this.keyIndex = candidate
        return true
      }
    }
    return false
  }

  private keyStatusMessage(): string {
    return `Command Code: switched to API key ${this.keyIndex + 1}/${this.apiKeys.length}`
  }

  private async doFetch(
    url: string,
    body: string,
    signal: AbortSignal,
    exhaustedKeyIndexes: Set<number>,
  ): Promise<Response> {
    let retryCount = 0
    const maxRetries = Math.max(0, this.opts.maxRetries ?? 3)
    const retryDelayMs = Math.max(0, this.opts.retryDelayMs ?? 1000)

    while (true) {
      if (exhaustedKeyIndexes.has(this.keyIndex) &&
          !this.selectNextAvailableKey(exhaustedKeyIndexes)) {
        throw new Error(
          `Command Code API: insufficient credits on all ${this.apiKeys.length} configured API keys [model=${this.modelId}]`,
        )
      }

      let response: Response
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this.buildHeaders(),
          body,
          signal,
        })
      } catch (error) {
        if (signal.aborted || retryCount >= maxRetries) throw error
        const delay = retryDelayMs * Math.pow(2, retryCount)
        retryCount++
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
        continue
      }

      if (response.ok) {
        if (!response.body) {
          throw new Error(`Command Code API returned no body [model=${this.modelId}]`)
        }
        return response
      }

      const errorBody = await response.text().catch(() => "")
      let errorMessage = `Command Code API error: ${response.status} ${response.statusText}`
      let parsedBody: unknown
      try {
        parsedBody = JSON.parse(errorBody)
        if ((parsedBody as any).error?.message) errorMessage = (parsedBody as any).error.message
        else if ((parsedBody as any).message) errorMessage = (parsedBody as any).message
      } catch {
        // intentionally silent: error body is not JSON
      }

      if (!this.isInsufficientCredits(errorMessage)) {
        if (this.isRetryableHttpError(response, parsedBody, errorMessage)) {
          if (retryCount >= maxRetries) {
            throw new Error(
              `${errorMessage} after ${maxRetries} retries [model=${this.modelId}]`,
            )
          }

          const delay = retryDelayMs * Math.pow(2, retryCount)
          retryCount++
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay))
          }
          continue
        }

        throw new Error(`${errorMessage} [model=${this.modelId}]`)
      }

      exhaustedKeyIndexes.add(this.keyIndex)
      if (!this.selectNextAvailableKey(exhaustedKeyIndexes)) {
        throw new Error(
          `${errorMessage} Tried all ${this.apiKeys.length} configured API keys. [model=${this.modelId}]`,
        )
      }
    }
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const body = buildRequest(this.modelId, options)
    const requestBody = JSON.stringify(body)

    const abortController = new AbortController()
    const timeout = setTimeout(
      () => abortController.abort(new Error("Request timed out after 30 minutes")),
      30 * 60 * 1000,
    )
    const userSignal = options.abortSignal
    const onAbort = () => abortController.abort(userSignal?.reason)
    if (userSignal) {
      userSignal.addEventListener("abort", onAbort, { once: true })
    }

    const url = `${this.baseURL}/alpha/generate`
    const exhaustedKeyIndexes = new Set<number>()
    const cleanup = () => {
      clearTimeout(timeout)
      userSignal?.removeEventListener("abort", onAbort)
    }

    try {
      const initialResponse = await this.doFetch(
        url,
        requestBody,
        abortController.signal,
        exhaustedKeyIndexes,
      )

      const responseHeaders: Record<string, string> = {}
      initialResponse.headers.forEach((v, k) => {
        responseHeaders[k] = v
      })

      const stream = this.retryableStream(
        parseStreamEvents(initialResponse.body as ReadableStream<Uint8Array>),
        () => this.doFetch(url, requestBody, abortController.signal, exhaustedKeyIndexes),
        abortController.signal,
        cleanup,
        exhaustedKeyIndexes,
      )

      return {
        stream,
        request: { body: requestBody },
        response: { headers: responseHeaders },
      }
    } catch (error) {
      cleanup()
      throw error
    }
  }

  private retryableStream(
    initialStream: ReadableStream<LanguageModelV3StreamPart>,
    retryFetch: () => Promise<Response>,
    abortSignal: AbortSignal,
    cleanup: () => void,
    exhaustedKeyIndexes: Set<number>,
  ): ReadableStream<LanguageModelV3StreamPart> {
    const maxRetries = Math.max(0, this.opts.maxRetries ?? 3)
    const retryDelayMs = Math.max(0, this.opts.retryDelayMs ?? 1000)
    let currentReader = initialStream.getReader()
    let cancelled = false
    let retryCount = 0
    let cleanedUp = false

    const finishCleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      cleanup()
    }

    const cancelCurrentReader = () => {
      void currentReader.cancel().catch(() => {
        // reader may already be closed
      })
    }

    const enqueueStatus = (
      controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
      id: string,
      message: string,
    ) => {
      controller.enqueue({ type: "text-start", id })
      controller.enqueue({ type: "text-delta", id, delta: `\n[${message}]\n` })
      controller.enqueue({ type: "text-end", id })
    }

    return new ReadableStream({
      pull: async (controller) => {
        try {
          while (!cancelled) {
            const { done, value } = await currentReader.read()
            if (done) {
              finishCleanup()
              controller.close()
              return
            }

            if (value.type !== "error") {
              controller.enqueue(value)
              return
            }

            const message = this.errorMessage(value.error)

            if (this.isInsufficientCredits(message)) {
              exhaustedKeyIndexes.add(this.keyIndex)
              if (!this.selectNextAvailableKey(exhaustedKeyIndexes)) {
                finishCleanup()
                controller.enqueue({
                  type: "error",
                  error: new Error(
                    `${message} Tried all ${this.apiKeys.length} configured API keys. [model=${this.modelId}]`,
                  ),
                })
                controller.close()
                return
              }

              cancelCurrentReader()
              const keyStatusMessage = this.keyStatusMessage()
              enqueueStatus(controller, "commandcode-key-status", keyStatusMessage)

              const response = await retryFetch()
              currentReader = parseStreamEvents(
                response.body as ReadableStream<Uint8Array>,
              ).getReader()
              continue
            }

            if (!this.isRetryableStreamError(value.error, message)) {
              finishCleanup()
              controller.enqueue(value)
              controller.close()
              return
            }

            if (retryCount >= maxRetries) {
              finishCleanup()
              controller.enqueue({
                type: "error",
                error: new Error(
                  `Command Code API: ${message} after ${maxRetries} retries [model=${this.modelId}]`,
                ),
              })
              controller.close()
              return
            }

            retryCount++
            cancelCurrentReader()

            const delay = retryDelayMs * Math.pow(2, retryCount - 1)
            const retryReason = message.toLowerCase().includes("network connection lost")
              ? "network connection lost"
              : `retryable server error: ${message.replace(/[.;:!?]+$/, "")}`
            const retryMessage =
              `Command Code: ${retryReason}; retry ${retryCount}/${maxRetries}` +
              (delay > 0 ? ` in ${delay}ms` : "")
            enqueueStatus(controller, "commandcode-retry-status", retryMessage)

            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay))
            }

            if (abortSignal.aborted || cancelled) {
              finishCleanup()
              controller.close()
              return
            }

            const response = await retryFetch()
            currentReader = parseStreamEvents(
              response.body as ReadableStream<Uint8Array>,
            ).getReader()
          }
        } catch (error) {
          finishCleanup()
          controller.enqueue({
            type: "error",
            error: new Error(
              `Command Code API retry failed after ${retryCount}/${maxRetries} retries: ${error instanceof Error ? error.message : String(error)} [model=${this.modelId}]`,
            ),
          })
          controller.close()
        }
      },
      cancel: () => {
        cancelled = true
        cancelCurrentReader()
        finishCleanup()
      },
    })
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
          case "error":
            throw new Error(
              `Command Code API stream error: ${typeof value.error === "object" && value.error !== null ? (value.error as Error).message ?? JSON.stringify(value.error) : value.error} [model=${this.modelId}]`,
            )
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

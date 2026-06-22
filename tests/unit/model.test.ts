import { expect, test, beforeAll, afterAll } from "bun:test"
import { CommandCodeLanguageModel } from "../../src/model.js"
import { mockFetchTrack, mockFetchError, mockFetchStream, makeCallOptions } from "../helpers/mocks.js"

const MODEL_ID = "test-model"
const API_KEY = "sk-test-key"

function makeModel(baseURL?: string) {
  return new CommandCodeLanguageModel(MODEL_ID, {
    apiKey: API_KEY,
    baseURL,
  })
}

let originalEnv: Record<string, string | undefined> = {}
beforeAll(() => {
  originalEnv.COMMANDCODE_API_KEY = process.env.COMMANDCODE_API_KEY
  delete process.env.COMMANDCODE_API_KEY
})
afterAll(() => {
  if (originalEnv.COMMANDCODE_API_KEY) process.env.COMMANDCODE_API_KEY = originalEnv.COMMANDCODE_API_KEY
})

test("provider and modelId are correct", () => {
  const model = makeModel()
  expect(model.provider).toBe("commandcode")
  expect(model.modelId).toBe(MODEL_ID)
  expect(model.specificationVersion).toBe("v3")
})

test("doStream sends correct headers", async () => {
  const { calls, restore, respondWith } = mockFetchTrack()
  respondWith({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'))
        controller.close()
      },
    }),
  })

  const model = makeModel()
  await model.doStream(makeCallOptions())
  restore()

  expect(calls).toHaveLength(1)
  const headers = calls[0].options.headers as Record<string, string>
  expect(headers["Authorization"]).toBe("Bearer sk-test-key")
  expect(headers["Content-Type"]).toBe("application/json")
  expect(headers["x-command-code-version"]).toBe("0.40.0")
  expect(headers["x-cli-environment"]).toBe("production")
  expect(headers["x-project-slug"]).toBe("commandcode-provider")
  expect(headers["x-co-flag"]).toBe("false")
  expect(headers["x-taste-learning"]).toBe("false")
  expect(typeof headers["x-session-id"]).toBe("string")
})

test("doStream accepts comma-separated API keys", async () => {
  const encoder = new TextEncoder()
  const authorizations: string[] = []
  const originalFetch = globalThis.fetch
  let callCount = 0
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    authorizations.push((options?.headers as Record<string, string>).Authorization)
    callCount++
    if (callCount === 1) {
      return {
        ok: false,
        status: 402,
        statusText: "Payment Required",
        headers: new Headers(),
        body: null,
        text: () => Promise.resolve(JSON.stringify({
          error: { message: "You have insufficient credits to make this request." },
        })),
      } as Response
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"start"}\n\n'))
          controller.close()
        },
      }),
    } as Response
  }) as typeof globalThis.fetch

  try {
    const model = new CommandCodeLanguageModel(MODEL_ID, {
      apiKey: " key-one, key-two ",
    })
    await model.doStream(makeCallOptions())
    expect(authorizations).toEqual(["Bearer key-one", "Bearer key-two"])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("doStream sends request body with model and messages", async () => {
  const { calls, restore, respondWith } = mockFetchTrack()
  respondWith({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'))
        controller.close()
      },
    }),
  })

  const model = makeModel()
  await model.doStream(makeCallOptions({ prompt: [{ role: "user", content: "hi" }] }))
  restore()

  const body = JSON.parse(calls[0].options.body as string)
  expect(body.params.model).toBe(MODEL_ID)
  expect(body.params.messages).toHaveLength(1)
  expect(body.params.messages[0].content).toBe("hi")
})

test("doStream uses correct URL", async () => {
  const { calls, restore, respondWith } = mockFetchTrack()
  respondWith({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'))
        controller.close()
      },
    }),
  })

  const model = makeModel()
  await model.doStream(makeCallOptions())
  restore()

  expect(calls[0].url).toBe("https://api.commandcode.ai/alpha/generate")
})

test("doStream uses custom baseURL when provided", async () => {
  const { calls, restore, respondWith } = mockFetchTrack()
  respondWith({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'))
        controller.close()
      },
    }),
  })

  const model = makeModel("https://custom.example.com")
  await model.doStream(makeCallOptions())
  restore()

  expect(calls[0].url).toBe("https://custom.example.com/alpha/generate")
})

test("doStream throws descriptive error on non-OK response", async () => {
  const { restore } = mockFetchError(401, "Unauthorized", JSON.stringify({
    error: { message: "Invalid API key" },
  }))
  const model = makeModel()
  expect(model.doStream(makeCallOptions())).rejects.toThrow("Invalid API key")
  restore()
})

test("doStream throws on HTTP error without JSON body", async () => {
  const { restore } = mockFetchError(500, "Internal Server Error")
  const model = new CommandCodeLanguageModel(MODEL_ID, { apiKey: API_KEY, maxRetries: 0 })
  expect(model.doStream(makeCallOptions())).rejects.toThrow("Command Code API error: 500 Internal Server Error")
  restore()
})

test("doStream throws when response body is null", async () => {
  const { restore: r1 } = mockFetchError(200, "OK")
  const track = mockFetchTrack()
  track.respondWith({ ok: true, body: null })
  const model = makeModel()
  expect(model.doStream(makeCallOptions())).rejects.toThrow("Command Code API returned no body")
  track.restore()
  r1()
})

test("doStream streams returned parts", async () => {
  const { restore } = mockFetchStream([
    'data: {"type":"start"}\n\n',
    'data: {"type":"text-delta","id":"t1","delta":"hello"}\n\n',
  ])
  const model = makeModel()
  const result = await model.doStream(makeCallOptions())
  const reader = result.stream.getReader()
  const parts: any[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  reader.releaseLock()
  restore()

  expect(parts).toHaveLength(2)
  expect(parts[0].type).toBe("stream-start")
  expect(parts[1].type).toBe("text-delta")
})

test("doStream retries a server_error network connection loss", async () => {
  const encoder = new TextEncoder()
  const responses = [
    ['data: {"type":"server_error","message":"Network connection lost."}\n\n'],
    [
      'data: {"type":"start"}\n\n',
      'data: {"type":"text-delta","id":"t1","delta":"recovered"}\n\n',
    ],
  ]
  const calls: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    const chunks = responses.shift()
    if (!chunks) throw new Error("Unexpected fetch")
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.close()
        },
      }),
    } as Response
  }) as typeof globalThis.fetch

  try {
    const model = new CommandCodeLanguageModel(MODEL_ID, {
      apiKey: API_KEY,
      maxRetries: 1,
      retryDelayMs: 0,
    })
    const result = await model.doStream(makeCallOptions())
    const reader = result.stream.getReader()
    const parts: any[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(calls).toHaveLength(2)
    expect(parts.some((part) => part.type === "error")).toBe(false)
    expect(parts).toContainEqual({
      type: "text-delta",
      id: "commandcode-retry-status",
      delta: "\n[Command Code: network connection lost; retry 1/1]\n",
    })
    expect(parts).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "recovered",
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("doStream reports how many network retries were exhausted", async () => {
  const encoder = new TextEncoder()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"server_error","message":"Network connection lost."}\n\n'),
        )
        controller.close()
      },
    }),
  })) as typeof globalThis.fetch

  try {
    const model = new CommandCodeLanguageModel(MODEL_ID, {
      apiKey: API_KEY,
      maxRetries: 2,
      retryDelayMs: 0,
    })
    const result = await model.doStream(makeCallOptions())
    const reader = result.stream.getReader()
    const parts: any[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(
      parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta),
    ).toEqual([
      "\n[Command Code: network connection lost; retry 1/2]\n",
      "\n[Command Code: network connection lost; retry 2/2]\n",
    ])
    const finalError = parts.find((part) => part.type === "error")
    expect(finalError.error.message).toContain("after 2 retries")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("doStream retries a server error marked isRetryable", async () => {
  const encoder = new TextEncoder()
  const responses = [
    [
      'data: {"type":"server_error","message":"Service temporarily unavailable. Please try again shortly.","statusCode":503,"isRetryable":true}\n\n',
    ],
    ['data: {"type":"text-delta","id":"t1","delta":"recovered"}\n\n'],
  ]
  const originalFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = (async () => {
    fetchCount++
    const chunks = responses.shift()
    if (!chunks) throw new Error("Unexpected fetch")
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.close()
        },
      }),
    } as Response
  }) as typeof globalThis.fetch

  try {
    const model = new CommandCodeLanguageModel(MODEL_ID, {
      apiKey: API_KEY,
      maxRetries: 1,
      retryDelayMs: 0,
    })
    const result = await model.doStream(makeCallOptions())
    const reader = result.stream.getReader()
    const parts: any[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(fetchCount).toBe(2)
    expect(parts).toContainEqual({
      type: "text-delta",
      id: "commandcode-retry-status",
      delta: "\n[Command Code: retryable server error: Service temporarily unavailable. Please try again shortly; retry 1/1]\n",
    })
    expect(parts).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "recovered",
    })
    expect(parts.some((part) => part.type === "error")).toBe(false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("doStream switches keys on a streamed insufficient credits error", async () => {
  const encoder = new TextEncoder()
  const authorizations: string[] = []
  const responses = [
    ['data: {"type":"server_error","message":"Insufficient credits."}\n\n'],
    ['data: {"type":"text-delta","id":"t1","delta":"second key"}\n\n'],
  ]
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    authorizations.push((options?.headers as Record<string, string>).Authorization)
    const chunks = responses.shift()
    if (!chunks) throw new Error("Unexpected fetch")
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.close()
        },
      }),
    } as Response
  }) as typeof globalThis.fetch

  try {
    const model = new CommandCodeLanguageModel(MODEL_ID, {
      apiKey: "key-one,key-two",
      retryDelayMs: 0,
    })
    const result = await model.doStream(makeCallOptions())
    const reader = result.stream.getReader()
    const parts: any[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(authorizations).toEqual(["Bearer key-one", "Bearer key-two"])
    expect(parts).toContainEqual({
      type: "text-delta",
      id: "commandcode-key-status",
      delta: "\n[Command Code: switched to API key 2/2]\n",
    })
    expect(parts).toContainEqual({
      type: "text-delta",
      id: "t1",
      delta: "second key",
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("doStream reports when all configured keys lack credits", async () => {
  const originalFetch = globalThis.fetch
  const authorizations: string[] = []
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    authorizations.push((options?.headers as Record<string, string>).Authorization)
    return {
      ok: false,
      status: 402,
      statusText: "Payment Required",
      headers: new Headers(),
      body: null,
      text: () => Promise.resolve(JSON.stringify({
        message: "Insufficient credits.",
      })),
    } as Response
  }) as typeof globalThis.fetch

  try {
    const model = new CommandCodeLanguageModel(MODEL_ID, {
      apiKey: "key-one,key-two,key-three",
    })
    expect(model.doStream(makeCallOptions())).rejects.toThrow(
      "Tried all 3 configured API keys",
    )
    expect(authorizations).toEqual([
      "Bearer key-one",
      "Bearer key-two",
      "Bearer key-three",
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("doGenerate returns complete response", async () => {
  const { restore } = mockFetchStream([
    'data: {"type":"start"}\n\n',
    'data: {"type":"text-delta","id":"t1","delta":"Hello "}\n\n',
    'data: {"type":"text-delta","id":"t1","delta":"world"}\n\n',
    'data: {"type":"finish-step","finishReason":"stop","usage":{"inputTokens":5,"outputTokens":10}}\n\n',
  ])
  const model = makeModel()
  const result = await model.doGenerate(makeCallOptions())
  restore()

  expect(result.content).toHaveLength(1)
  expect(result.content[0]).toMatchObject({ type: "text", text: "Hello world" })
  expect(result.finishReason.unified).toBe("stop")
  expect(result.finishReason.raw).toBe("stop")
  expect(result.usage.inputTokens.total).toBe(5)
  expect(result.usage.outputTokens.total).toBe(10)
})

test("doGenerate includes reasoning before text", async () => {
  const { restore } = mockFetchStream([
    'data: {"type":"start"}\n\n',
    'data: {"type":"reasoning-delta","id":"r1","text":"think"}\n\n',
    'data: {"type":"text-delta","id":"t1","delta":"answer"}\n\n',
    'data: {"type":"finish-step","finishReason":"stop","usage":{"inputTokens":1,"outputTokens":1}}\n\n',
  ])
  const model = makeModel()
  const result = await model.doGenerate(makeCallOptions())
  restore()

  expect(result.content).toHaveLength(2)
  expect(result.content[0]).toMatchObject({ type: "reasoning", text: "think" })
  expect(result.content[1]).toMatchObject({ type: "text", text: "answer" })
})

test("doGenerate handles tool calls", async () => {
  const { restore } = mockFetchStream([
    'data: {"type":"start"}\n\n',
    'data: {"type":"text-delta","id":"t1","delta":"Let me run..."}\n\n',
    `data: ${JSON.stringify({ type: "tool-call", toolCallId: "tc1", toolName: "bash", input: { cmd: "ls" } })}\n\n`,
    'data: {"type":"finish-step","finishReason":"tool_calls","usage":{"inputTokens":5,"outputTokens":3}}\n\n',
  ])
  const model = makeModel()
  const result = await model.doGenerate(makeCallOptions())
  restore()

  expect(result.content).toHaveLength(2)
  expect(result.content[0]).toMatchObject({ type: "text", text: "Let me run..." })
  expect(result.content[1]).toMatchObject({ type: "tool-call", toolCallId: "tc1", toolName: "bash" })
  expect(result.finishReason.unified).toBe("tool-calls")
})

test("doStream includes model ID in error messages", async () => {
  const { restore } = mockFetchError(500, "Server Error", JSON.stringify({
    error: { message: "Something broke" },
  }))
  const model = new CommandCodeLanguageModel(MODEL_ID, { apiKey: API_KEY, maxRetries: 0 })
  try {
    await model.doStream(makeCallOptions())
    expect.unreachable("Should have thrown")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    expect(msg).toContain("[model=test-model]")
  }
  restore()
})

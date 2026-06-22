import { execSync } from "child_process"
import { readdirSync } from "fs"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type {
  LanguageModelV3FunctionTool,
  LanguageModelV3FilePart,
  LanguageModelV3Message,
  LanguageModelV3TextPart,
  LanguageModelV3ReasoningPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3ToolResultOutput,
} from "@ai-sdk/provider"

type CCMessage =
  | { role: "user"; content: string | CCUserContent[] }
  | { role: "assistant"; content: CCAssistantContent[] }
  | { role: "tool"; content: CCToolResultContent[] }

type CCUserContent =
  | { type: "text"; text: string }
  | { type: "image"; image: string }

type CCAssistantContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }

type CCToolResultContent = {
  type: "tool-result"
  toolCallId: string
  toolName: string
  output: { type: "text"; value: string } | { type: "error-text"; value: string }
}

type CCTool = {
  type: "function"
  name: string
  description?: string
  input_schema: unknown
}

interface CCRequestEnvelope {
  config: {
    workingDir: string
    date: string
    environment: string
    structure: string[]
    isGitRepo: boolean
    currentBranch: string
    mainBranch: string
    gitStatus: string
    recentCommits: string[]
  }
  memory: string
  taste: string
  skills: null
  permissionMode: string
  params: {
    model: string
    messages: CCMessage[]
    tools: CCTool[]
    system: string
    max_tokens: number
    stream: true
    temperature?: number
    top_p?: number
    top_k?: number
    reasoning_effort?: ReasoningEffort
  }
}

const REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

function hasType(p: unknown, type: string): boolean {
  return typeof p === "object" && p !== null && (p as { type?: string }).type === type
}

function isTextPart(p: unknown): p is LanguageModelV3TextPart {
  return hasType(p, "text")
}

function isFilePart(p: unknown): p is LanguageModelV3FilePart {
  return hasType(p, "file")
}

function isReasoningPart(p: unknown): p is LanguageModelV3ReasoningPart {
  return hasType(p, "reasoning")
}

function isToolCallPart(p: unknown): p is LanguageModelV3ToolCallPart {
  return hasType(p, "tool-call")
}

function isToolResultPart(p: unknown): p is LanguageModelV3ToolResultPart {
  return hasType(p, "tool-result")
}

function getStringProperty(obj: unknown, key: string): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined
  const value = (obj as Record<string, unknown>)[key]
  return typeof value === "string" ? value : undefined
}

function dataToImageUrl(data: LanguageModelV3FilePart["data"], mediaType: string): string {
  if (data instanceof URL) return data.toString()
  if (typeof data === "string") {
    if (/^(https?:|data:|file:)/.test(data)) return data
    return `data:${mediaType};base64,${data}`
  }
  return `data:${mediaType};base64,${Buffer.from(data).toString("base64")}`
}

function convertImagePart(part: unknown): CCUserContent | null {
  if (isFilePart(part)) {
    if (!part.mediaType.startsWith("image/")) return null
    return { type: "image", image: dataToImageUrl(part.data, part.mediaType) }
  }

  if (hasType(part, "image")) {
    const image = getStringProperty(part, "image") ?? getStringProperty(part, "url")
    return image ? { type: "image", image } : null
  }

  return null
}

function convertUserContent(content: unknown): string | CCUserContent[] {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const converted: CCUserContent[] = []
    let dropped = 0

    for (const part of content) {
      if (isTextPart(part)) {
        converted.push({ type: "text", text: part.text })
        continue
      }

      const image = convertImagePart(part)
      if (image) {
        converted.push(image)
        continue
      }

      dropped++
    }

    if (dropped > 0 && converted.length === 0) {
      console.warn(`Command Code provider: dropped ${dropped} unsupported part(s) in user message`)
    }

    const first = converted[0]
    if (converted.length === 1 && first?.type === "text") {
      return first.text
    }

    const textOnly = converted.filter((part): part is { type: "text"; text: string } => part.type === "text")
    if (textOnly.length === converted.length) {
      return textOnly.map((part) => part.text).join("\n")
    }

    return converted
  }
  return ""
}

function convertToolResultOutput(output: LanguageModelV3ToolResultOutput): CCToolResultContent["output"] {
  switch (output.type) {
    case "text":
      return { type: "text", value: output.value }
    case "error-text":
      return { type: "error-text", value: output.value }
    case "json":
      return { type: "text", value: JSON.stringify(output.value) }
    case "execution-denied":
      return { type: "error-text", value: output.reason ?? "Execution denied" }
    case "error-json":
      return { type: "error-text", value: JSON.stringify(output.value) }
    case "content":
      return { type: "text", value: output.value.map((v: Record<string, unknown>) => ("text" in v ? v.text : JSON.stringify(v))).join("\n") }
    default:
      return { type: "text", value: JSON.stringify(output) }
  }
}

function convertMessage(msg: LanguageModelV3Message): CCMessage | null {
  switch (msg.role) {
    case "user": {
      return { role: "user", content: convertUserContent(msg.content) }
    }
    case "assistant": {
      const parts: CCAssistantContent[] = []
      for (const part of msg.content) {
        if (isTextPart(part)) {
          parts.push({ type: "text", text: part.text })
        } else if (isReasoningPart(part)) {
          parts.push({ type: "reasoning", text: part.text })
        } else if (isToolCallPart(part)) {
          parts.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          })
        }
      }
      return { role: "assistant", content: parts }
    }
    case "tool": {
      const parts: CCToolResultContent[] = []
      for (const part of msg.content) {
        if (isToolResultPart(part)) {
          parts.push({
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: convertToolResultOutput(part.output),
          })
        }
      }
      return { role: "tool", content: parts }
    }
    default:
      return null
  }
}

function convertTools(
  tools: Array<LanguageModelV3FunctionTool | { type: "provider"; id: `${string}.${string}`; name: string; args: Record<string, unknown> }> | undefined,
): CCTool[] {
  if (!tools) return []
  return tools
    .filter((t): t is LanguageModelV3FunctionTool => t.type === "function")
    .map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
}

function normalizeReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized && REASONING_EFFORTS.has(normalized)
    ? normalized as ReasoningEffort
    : undefined
}

function getReasoningEffort(options: LanguageModelV3CallOptions): ReasoningEffort | undefined {
  const providerOptions = options.providerOptions
  const commandcode = providerOptions?.commandcode ?? providerOptions?.commandCode

  return normalizeReasoningEffort(
    getStringProperty(commandcode, "reasoningEffort") ??
    getStringProperty(commandcode, "reasoning_effort") ??
    getStringProperty(commandcode, "effort"),
  )
}

const STRUCTURE_IGNORES = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".svn",
  ".hg",
  "coverage",
  ".nyc_output",
  ".cache",
  "tmp",
  "temp",
  ".next",
  ".nuxt",
  "out",
])

function getGitCommand(command: string): string {
  return execSync(command, {
    encoding: "utf8",
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "ignore"],
  }).trim()
}

function isGitRepository(): boolean {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: process.cwd(),
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

function getCurrentBranch(): string {
  try {
    return getGitCommand("git branch --show-current")
  } catch {
    return ""
  }
}

function getMainBranch(): string {
  try {
    const branch = getGitCommand("git symbolic-ref --short refs/remotes/origin/HEAD")
      .replace(/^origin\//, "")
    if (branch) return branch
  } catch {
    // Fall back to common remote branch names below.
  }

  try {
    const branches = getGitCommand("git branch -r")
    if (branches.includes("origin/main")) return "main"
    if (branches.includes("origin/master")) return "master"
    return "main"
  } catch {
    return ""
  }
}

function getGitStatus(): string {
  try {
    const status = getGitCommand("git status --porcelain")
    if (!status) return "Working tree clean"

    const lines = status.split("\n")
    const modified = lines.filter((line) => line.startsWith(" M")).length
    const added = lines.filter((line) => line.startsWith("A ")).length
    const deleted = lines.filter((line) => line.startsWith(" D")).length
    const untracked = lines.filter((line) => line.startsWith("??")).length
    const parts: string[] = []

    if (modified > 0) parts.push(`M ${modified}`)
    if (added > 0) parts.push(`A ${added}`)
    if (deleted > 0) parts.push(`D ${deleted}`)
    if (untracked > 0) parts.push(`?? ${untracked}`)

    return parts.join(", ") || status
  } catch {
    return ""
  }
}

function getRecentCommits(): string[] {
  try {
    const commits = getGitCommand("git log --oneline -3")
    return commits ? commits.split("\n") : []
  } catch {
    return []
  }
}

function getRootDirectoryStructure(): string[] {
  try {
    return readdirSync(process.cwd(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith("."))
      .filter((entry) => !STRUCTURE_IGNORES.has(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function getEnvironmentContext(): CCRequestEnvelope["config"] {
  const isGitRepo = isGitRepository()
  return {
    workingDir: process.cwd() ?? "/",
    date: new Date().toISOString().split("T")[0] ?? "",
    environment: `${process.platform}-${process.arch}`,
    structure: getRootDirectoryStructure(),
    isGitRepo,
    currentBranch: isGitRepo ? getCurrentBranch() : "",
    mainBranch: isGitRepo ? getMainBranch() : "",
    gitStatus: isGitRepo ? getGitStatus() : "",
    recentCommits: isGitRepo ? getRecentCommits() : [],
  }
}

export function buildRequest(
  modelId: string,
  options: LanguageModelV3CallOptions,
): CCRequestEnvelope {
  let systemPrompt = ""
  const messages: CCMessage[] = []

  for (const msg of options.prompt) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + msg.content
      continue
    }
    const converted = convertMessage(msg)
    if (converted) messages.push(converted)
  }

  const params: CCRequestEnvelope["params"] = {
    model: modelId,
    messages,
    tools: convertTools(options.tools),
    system: systemPrompt,
    max_tokens: options.maxOutputTokens ?? 16384,
    stream: true,
  }

  if (options.temperature !== undefined) params.temperature = options.temperature
  if (options.topP !== undefined) params.top_p = options.topP
  if (options.topK !== undefined) params.top_k = options.topK
  const reasoningEffort = getReasoningEffort(options)
  if (reasoningEffort !== undefined) params.reasoning_effort = reasoningEffort

  return {
    config: getEnvironmentContext(),
    memory: "",
    taste: "",
    skills: null,
    permissionMode: "standard",
    params,
  }
}

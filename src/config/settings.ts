import { asRecord, asStringRecord } from "../ai/json";
import { LogLevel, ProviderKind, ResolvedProviderProfile } from "../ai/types";

const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const MAX_REQUEST_TIMEOUT_MS = 3600000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_LOG_LEVEL: LogLevel = "normal";
const DEFAULT_AZURE_API_VERSION = "2024-10-21";
const DEFAULT_GEMINI_API_VERSION = "v1beta";

const PROVIDER_KINDS: ProviderKind[] = [
  "openaiCompat",
  "openaiResponses",
  "anthropic",
  "azureOpenai",
  "gemini",
  "ollama"
];

const KIND_MODEL_HINTS: Record<ProviderKind, string[]> = {
  openaiCompat: ["gpt-4.1-mini", "gpt-4o-mini", "o3-mini"],
  openaiResponses: ["gpt-4.1-mini", "gpt-4o-mini", "o3-mini"],
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest"],
  azureOpenai: ["gpt-4o-mini", "gpt-4.1-mini"],
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro"],
  ollama: ["qwen2.5-coder:7b", "llama3.1:8b"]
};

export interface RawExtensionSettings {
  providerProfiles?: unknown;
  activeProfile?: unknown;
  fallbackProfiles?: unknown;
  requestTimeoutMs?: unknown;
  maxRetries?: unknown;
  logLevel?: unknown;
  logRedactSensitive?: unknown;
  apiKey?: unknown;
  openaiApiKey?: unknown;
  apiBaseUrl?: unknown;
  apiProtocol?: unknown;
  openaiModel?: unknown;
}

export interface ResolvedExtensionSettings {
  profiles: ResolvedProviderProfile[];
  executionOrder: ResolvedProviderProfile[];
  activeProfile: string;
  fallbackProfiles: string[];
  requestTimeoutMs: number;
  maxRetries: number;
  logLevel: LogLevel;
  logRedactSensitive: boolean;
  usedLegacyConfig: boolean;
  warnings: string[];
}

export function resolveExtensionSettings(
  raw: RawExtensionSettings,
  env: NodeJS.ProcessEnv
): ResolvedExtensionSettings {
  const warnings: string[] = [];
  const requestTimeoutDefault = clampInt(env.API_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 1000, MAX_REQUEST_TIMEOUT_MS);
  const requestTimeoutMs = clampInt(raw.requestTimeoutMs, requestTimeoutDefault, 1000, MAX_REQUEST_TIMEOUT_MS);
  const maxRetries = clampInt(raw.maxRetries, DEFAULT_MAX_RETRIES, 0, 5);
  const logLevel = parseLogLevel(raw.logLevel);
  const logRedactSensitive = toBoolean(raw.logRedactSensitive, true);

  let profiles = parseProviderProfiles(raw.providerProfiles, {
    requestTimeoutMs,
    maxRetries,
    env,
    warnings
  });

  let usedLegacyConfig = false;
  if (profiles.length === 0) {
    const hasLegacyValues = hasLegacyConfiguration(raw);
    profiles = [buildLegacyProfile(raw, env, requestTimeoutMs, maxRetries, hasLegacyValues ? "legacy-default" : "default")];
    usedLegacyConfig = hasLegacyValues;
    if (hasLegacyValues) {
      warnings.push("检测到旧配置键（apiKey/openaiApiKey/apiBaseUrl/apiProtocol/openaiModel），已映射为 profile。");
    }
  }

  const enabledProfiles = profiles.filter((profile) => profile.enabled);
  const activeProfileSetting = toNonEmptyString(raw.activeProfile) || "default";
  const fallbackProfiles = toStringArray(raw.fallbackProfiles);
  const executionOrder = buildExecutionOrder(enabledProfiles, activeProfileSetting, fallbackProfiles);
  const activeProfile = executionOrder[0]?.id ?? enabledProfiles[0]?.id ?? "";

  if (activeProfileSetting && enabledProfiles.length > 0 && !enabledProfiles.some((profile) => profile.id === activeProfileSetting)) {
    warnings.push(`activeProfile="${activeProfileSetting}" 未命中已启用 profile，已自动回退到 "${activeProfile}"。`);
  }

  if (enabledProfiles.length === 0) {
    warnings.push("当前没有启用的 provider profile，AI 生成将直接回退本地规则。");
  }

  return {
    profiles,
    executionOrder,
    activeProfile,
    fallbackProfiles,
    requestTimeoutMs,
    maxRetries,
    logLevel,
    logRedactSensitive,
    usedLegacyConfig,
    warnings
  };
}

export function buildExecutionOrder(
  profiles: ResolvedProviderProfile[],
  activeProfile: string,
  fallbackProfiles: string[]
): ResolvedProviderProfile[] {
  const byId = new Map<string, ResolvedProviderProfile>();
  for (const profile of profiles) {
    byId.set(profile.id, profile);
  }

  const ordered: ResolvedProviderProfile[] = [];
  const seen = new Set<string>();
  const pushIfExists = (id: string): void => {
    if (!id || seen.has(id)) {
      return;
    }
    const profile = byId.get(id);
    if (!profile) {
      return;
    }
    ordered.push(profile);
    seen.add(id);
  };

  pushIfExists(activeProfile);
  for (const id of fallbackProfiles) {
    pushIfExists(id);
  }
  for (const profile of profiles) {
    pushIfExists(profile.id);
  }

  return ordered;
}

function parseProviderProfiles(
  rawProfiles: unknown,
  options: {
    requestTimeoutMs: number;
    maxRetries: number;
    env: NodeJS.ProcessEnv;
    warnings: string[];
  }
): ResolvedProviderProfile[] {
  if (!Array.isArray(rawProfiles)) {
    return [];
  }

  const ids = new Set<string>();
  const profiles: ResolvedProviderProfile[] = [];

  rawProfiles.forEach((raw, index) => {
    const profile = parseSingleProfile(raw, index, options);
    if (!profile) {
      return;
    }

    if (ids.has(profile.id)) {
      options.warnings.push(`providerProfiles[${index}] 的 id="${profile.id}" 重复，已忽略。`);
      return;
    }
    ids.add(profile.id);
    profiles.push(profile);
  });

  return profiles;
}

function parseSingleProfile(
  raw: unknown,
  index: number,
  options: {
    requestTimeoutMs: number;
    maxRetries: number;
    env: NodeJS.ProcessEnv;
    warnings: string[];
  }
): ResolvedProviderProfile | undefined {
  const node = asRecord(raw);
  if (!node) {
    options.warnings.push(`providerProfiles[${index}] 不是对象，已忽略。`);
    return undefined;
  }

  const kind = parseProviderKind(node.kind);
  if (!kind) {
    options.warnings.push(`providerProfiles[${index}] 缺少或包含无效 kind，已忽略。`);
    return undefined;
  }

  const id = toNonEmptyString(node.id);
  if (!id) {
    options.warnings.push(`providerProfiles[${index}] 缺少 id，已忽略。`);
    return undefined;
  }

  const rawModel = toNonEmptyString(node.model);
  const rawBaseUrl = toNonEmptyString(node.baseUrl);
  const model = rawModel || defaultModelForKind(kind, options.env);
  const baseUrl = rawBaseUrl || defaultBaseUrlForKind(kind, options.env);
  if (!baseUrl) {
    options.warnings.push(`providerProfiles[${index}] (${id}) 缺少 baseUrl，已忽略。`);
    return undefined;
  }

  if (!rawModel) {
    options.warnings.push(
      `providerProfiles[${index}] (${id}) 未配置 model，已使用默认值 "${model}"（kind=${kind}）。`
    );
  } else if (shouldShowModelHint(kind, model, baseUrl)) {
    options.warnings.push(
      `providerProfiles[${index}] (${id}) kind=${kind} 推荐模型示例：${KIND_MODEL_HINTS[kind].join(" / ")}；当前 model="${model}"。如使用中转可忽略。`
    );
  }

  if (!rawBaseUrl) {
    options.warnings.push(
      `providerProfiles[${index}] (${id}) 未配置 baseUrl，已使用默认值 "${baseUrl}"（kind=${kind}）。`
    );
  }

  const enabled = toBoolean(node.enabled, true);
  const envKey = toNonEmptyString(node.envKey);
  const apiKey = resolveApiKey(toNonEmptyString(node.apiKey), envKey, kind, options.env);
  const timeoutMs = clampInt(node.timeoutMs, options.requestTimeoutMs, 1000, MAX_REQUEST_TIMEOUT_MS);
  const maxRetries = clampInt(node.maxRetries, options.maxRetries, 0, 5);
  const extraHeaders = asStringRecord(node.extraHeaders);
  const azureDeployment = toNonEmptyString(node.azureDeployment);
  const azureApiVersion = toNonEmptyString(node.azureApiVersion) || DEFAULT_AZURE_API_VERSION;
  const geminiApiVersion = toNonEmptyString(node.geminiApiVersion) || DEFAULT_GEMINI_API_VERSION;

  if (kind === "azureOpenai" && !azureDeployment) {
    options.warnings.push(`providerProfiles[${index}] (${id}) 缺少 azureDeployment，请补充。`);
  }

  return {
    id,
    kind,
    model,
    baseUrl,
    apiKey,
    envKey,
    enabled,
    timeoutMs,
    maxRetries,
    extraHeaders,
    azureDeployment,
    azureApiVersion,
    geminiApiVersion
  };
}

function buildLegacyProfile(
  raw: RawExtensionSettings,
  env: NodeJS.ProcessEnv,
  requestTimeoutMs: number,
  maxRetries: number,
  id: string
): ResolvedProviderProfile {
  const protocol = parseLegacyProtocol(toNonEmptyString(raw.apiProtocol));
  const kind = mapLegacyProtocolToKind(protocol);
  const baseUrl = toNonEmptyString(raw.apiBaseUrl) || defaultBaseUrlForKind(kind, env);
  const model = toNonEmptyString(raw.openaiModel) || defaultModelForKind(kind, env);
  const preferredApiKey = toNonEmptyString(raw.apiKey) || toNonEmptyString(raw.openaiApiKey);
  const apiKey = resolveApiKey(preferredApiKey, "", kind, env);

  return {
    id,
    kind,
    model,
    baseUrl,
    apiKey,
    envKey: defaultEnvKeyForKind(kind),
    enabled: true,
    timeoutMs: requestTimeoutMs,
    maxRetries,
    extraHeaders: {},
    azureDeployment: undefined,
    azureApiVersion: DEFAULT_AZURE_API_VERSION,
    geminiApiVersion: DEFAULT_GEMINI_API_VERSION
  };
}

function resolveApiKey(
  preferred: string,
  envKey: string,
  kind: ProviderKind,
  env: NodeJS.ProcessEnv
): string | undefined {
  if (preferred) {
    return preferred;
  }

  const keys = envKey ? [envKey, ...defaultEnvKeysForKind(kind)] : defaultEnvKeysForKind(kind);
  const uniqueKeys = [...new Set(keys.filter((key) => key.trim().length > 0))];
  for (const key of uniqueKeys) {
    const value = toNonEmptyString(env[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseProviderKind(value: unknown): ProviderKind | undefined {
  const kind = toNonEmptyString(value);
  if (!kind) {
    return undefined;
  }
  return (PROVIDER_KINDS as string[]).includes(kind) ? (kind as ProviderKind) : undefined;
}

function parseLegacyProtocol(value: string): "chatCompletions" | "responses" | "anthropicMessages" {
  if (value === "responses") {
    return "responses";
  }
  if (value === "anthropicMessages") {
    return "anthropicMessages";
  }
  return "chatCompletions";
}

function mapLegacyProtocolToKind(protocol: "chatCompletions" | "responses" | "anthropicMessages"): ProviderKind {
  if (protocol === "responses") {
    return "openaiResponses";
  }
  if (protocol === "anthropicMessages") {
    return "anthropic";
  }
  return "openaiCompat";
}

function shouldShowModelHint(kind: ProviderKind, model: string, baseUrl: string): boolean {
  const normalizedModel = model.toLowerCase();
  const normalizedBase = baseUrl.toLowerCase();

  if (kind === "anthropic" && normalizedBase.includes("anthropic.com")) {
    return !normalizedModel.includes("claude");
  }

  if (kind === "gemini" && normalizedBase.includes("generativelanguage.googleapis.com")) {
    return !normalizedModel.includes("gemini");
  }

  if ((kind === "openaiCompat" || kind === "openaiResponses") && normalizedBase.includes("api.openai.com")) {
    return !/(gpt|o1|o3|o4)/i.test(model);
  }

  return false;
}

function defaultBaseUrlForKind(kind: ProviderKind, env: NodeJS.ProcessEnv): string {
  if (kind === "anthropic") {
    return toNonEmptyString(env.ANTHROPIC_BASE_URL) || "https://api.anthropic.com";
  }
  if (kind === "gemini") {
    return toNonEmptyString(env.GEMINI_BASE_URL) || "https://generativelanguage.googleapis.com";
  }
  if (kind === "ollama") {
    return toNonEmptyString(env.OLLAMA_BASE_URL) || "http://127.0.0.1:11434";
  }
  if (kind === "azureOpenai") {
    return toNonEmptyString(env.AZURE_OPENAI_BASE_URL);
  }
  return toNonEmptyString(env.OPENAI_BASE_URL) || "https://api.openai.com";
}

function defaultModelForKind(kind: ProviderKind, env: NodeJS.ProcessEnv): string {
  if (kind === "anthropic") {
    return toNonEmptyString(env.ANTHROPIC_MODEL) || "claude-3-5-sonnet-latest";
  }
  if (kind === "gemini") {
    return toNonEmptyString(env.GEMINI_MODEL) || "gemini-1.5-flash";
  }
  if (kind === "ollama") {
    return toNonEmptyString(env.OLLAMA_MODEL) || "qwen2.5-coder:7b";
  }
  if (kind === "azureOpenai") {
    return toNonEmptyString(env.AZURE_OPENAI_MODEL) || "gpt-4o-mini";
  }
  return toNonEmptyString(env.OPENAI_MODEL) || "gpt-4.1-mini";
}

function defaultEnvKeyForKind(kind: ProviderKind): string {
  return defaultEnvKeysForKind(kind)[0] || "";
}

function defaultEnvKeysForKind(kind: ProviderKind): string[] {
  if (kind === "anthropic") {
    return ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"];
  }
  if (kind === "azureOpenai") {
    return ["AZURE_OPENAI_API_KEY"];
  }
  if (kind === "gemini") {
    return ["GEMINI_API_KEY"];
  }
  if (kind === "ollama") {
    return [];
  }
  return ["OPENAI_API_KEY"];
}

function parseLogLevel(value: unknown): LogLevel {
  const level = toNonEmptyString(value);
  if (level === "off" || level === "normal" || level === "debug" || level === "trace") {
    return level;
  }
  return DEFAULT_LOG_LEVEL;
}

function toBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return defaultValue;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<string>();
  for (const item of value) {
    const text = toNonEmptyString(item);
    if (text) {
      unique.add(text);
    }
  }
  return [...unique];
}

function toNonEmptyString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function clampInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return defaultValue;
  }
  const integer = Math.trunc(number);
  if (integer < min) {
    return min;
  }
  if (integer > max) {
    return max;
  }
  return integer;
}

function hasLegacyConfiguration(raw: RawExtensionSettings): boolean {
  return Boolean(
    toNonEmptyString(raw.apiKey) ||
      toNonEmptyString(raw.openaiApiKey) ||
      toNonEmptyString(raw.apiBaseUrl) ||
      toNonEmptyString(raw.apiProtocol) ||
      toNonEmptyString(raw.openaiModel)
  );
}

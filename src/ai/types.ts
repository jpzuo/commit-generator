export type ProviderKind =
  | "openaiCompat"
  | "openaiResponses"
  | "anthropic"
  | "azureOpenai"
  | "gemini"
  | "ollama";

export type LogLevel = "off" | "normal" | "debug" | "trace";

export interface ResolvedProviderProfile {
  id: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey?: string;
  envKey?: string;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
  extraHeaders: Record<string, string>;
  azureDeployment?: string;
  azureApiVersion: string;
  geminiApiVersion: string;
}

export interface AdapterRequestInput {
  profile: ResolvedProviderProfile;
  prompt: string;
  temperature: number;
}

export interface AdapterRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderAdapter {
  kind: ProviderKind;
  buildRequest(input: AdapterRequestInput): AdapterRequest;
  parseResponse(data: unknown): string;
}

export interface ProviderFailure {
  profileId: string;
  provider: ProviderKind;
  endpoint: string;
  status?: number;
  retryable: boolean;
  attempt: number;
  error: string;
  latencyMs: number;
}

export interface ProviderSuccess {
  profileId: string;
  provider: ProviderKind;
  endpoint: string;
  latencyMs: number;
  message: string;
}

export interface ProviderRunResult {
  success?: ProviderSuccess;
  failures: ProviderFailure[];
}

export interface StructuredLogEntry {
  level: "info" | "warn" | "debug" | "trace";
  message: string;
  meta?: Record<string, unknown>;
}

export interface StructuredLogger {
  log(entry: StructuredLogEntry): void;
}

export interface ProviderRunInput {
  profiles: ResolvedProviderProfile[];
  prompt: string;
  temperature?: number;
  transformMessage?: (message: string) => string;
}

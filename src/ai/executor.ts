import { getProviderAdapter } from "./adapters";
import {
  AdapterRequest,
  ProviderFailure,
  ProviderRunInput,
  ProviderRunResult,
  StructuredLogger
} from "./types";

const DEFAULT_TEMPERATURE = 0.2;

class HttpStatusError extends Error {
  constructor(public readonly status: number, public readonly body: string, message: string) {
    super(message);
  }
}

class TimeoutRequestError extends Error {}
class NetworkRequestError extends Error {}

interface HttpSuccess {
  status: number;
  data: unknown;
  bodyText: string;
  headers: Record<string, string>;
}

interface RequestTraceContext {
  provider: string;
  profile: string;
  attempt: number;
  totalAttempts: number;
}

export async function executeProviderChain(
  input: ProviderRunInput,
  logger: StructuredLogger
): Promise<ProviderRunResult> {
  const failures: ProviderFailure[] = [];
  const temperature = input.temperature ?? DEFAULT_TEMPERATURE;

  for (const profile of input.profiles) {
    const adapter = getProviderAdapter(profile.kind);
    const totalAttempts = Math.max(0, profile.maxRetries) + 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      let endpoint = profile.baseUrl;
      const startedAt = Date.now();
      try {
        const request = adapter.buildRequest({
          profile,
          prompt: input.prompt,
          temperature
        });
        endpoint = request.endpoint;

        logger.log({
          level: "debug",
          message: "provider_request",
          meta: {
            provider: profile.kind,
            profile: profile.id,
            endpoint,
            attempt,
            totalAttempts,
            timeoutMs: profile.timeoutMs,
            headers: request.headers
          }
        });

        logger.log({
          level: "trace",
          message: "provider_http_request",
          meta: {
            provider: profile.kind,
            profile: profile.id,
            endpoint,
            attempt,
            totalAttempts,
            timeoutMs: profile.timeoutMs,
            method: "POST",
            headers: request.headers,
            body: request.body
          }
        });

        const response = await postJson(request, profile.timeoutMs, logger, {
          provider: profile.kind,
          profile: profile.id,
          attempt,
          totalAttempts
        });
        const parsedMessage = adapter.parseResponse(response.data).trim();
        const transformedMessage = input.transformMessage ? input.transformMessage(parsedMessage).trim() : parsedMessage;
        const latencyMs = Date.now() - startedAt;

        logger.log({
          level: "trace",
          message: "provider_message_transform",
          meta: {
            provider: profile.kind,
            profile: profile.id,
            endpoint,
            attempt,
            parsedMessage,
            transformedMessage
          }
        });

        if (!transformedMessage) {
          throw new Error("AI 返回为空或格式不合法。");
        }

        logger.log({
          level: "info",
          message: "provider_success",
          meta: {
            provider: profile.kind,
            profile: profile.id,
            endpoint,
            status: response.status,
            latencyMs,
            attempt
          }
        });

        return {
          success: {
            profileId: profile.id,
            provider: profile.kind,
            endpoint,
            latencyMs,
            message: transformedMessage
          },
          failures
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const normalized = normalizeError(error);
        const failure: ProviderFailure = {
          profileId: profile.id,
          provider: profile.kind,
          endpoint,
          status: normalized.status,
          retryable: normalized.retryable,
          attempt,
          error: normalized.message,
          latencyMs
        };
        failures.push(failure);

        logger.log({
          level: "warn",
          message: "provider_failure",
          meta: {
            provider: profile.kind,
            profile: profile.id,
            endpoint,
            attempt,
            totalAttempts,
            status: normalized.status,
            retryable: normalized.retryable,
            latencyMs,
            error: normalized.message,
            responseBody: normalized.responseBody
          }
        });

        if (normalized.retryable && attempt < totalAttempts) {
          const waitMs = backoffMs(attempt);
          logger.log({
            level: "debug",
            message: "provider_retry_scheduled",
            meta: {
              provider: profile.kind,
              profile: profile.id,
              endpoint,
              attempt,
              waitMs
            }
          });
          await sleep(waitMs);
          continue;
        }

        break;
      }
    }
  }

  return { failures };
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function normalizeError(error: unknown): {
  message: string;
  status?: number;
  retryable: boolean;
  responseBody?: string;
} {
  if (error instanceof HttpStatusError) {
    return {
      message: error.message,
      status: error.status,
      retryable: isRetryableStatus(error.status),
      responseBody: error.body
    };
  }

  if (error instanceof TimeoutRequestError || error instanceof NetworkRequestError) {
    return {
      message: error.message,
      retryable: true
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      retryable: false
    };
  }

  return {
    message: String(error),
    retryable: false
  };
}

async function postJson(
  request: AdapterRequest,
  timeoutMs: number,
  logger: StructuredLogger,
  traceContext: RequestTraceContext
): Promise<HttpSuccess> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      logger.log({
        level: "trace",
        message: "provider_http_timeout",
        meta: {
          ...traceContext,
          endpoint: request.endpoint,
          timeoutMs
        }
      });
      throw new TimeoutRequestError(`请求超时（${timeoutMs}ms）。`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    logger.log({
      level: "trace",
      message: "provider_http_network_error",
      meta: {
        ...traceContext,
        endpoint: request.endpoint,
        error: detail
      }
    });
    throw new NetworkRequestError(`网络请求失败：${detail}`);
  } finally {
    clearTimeout(timer);
  }

  const responseText = await response.text();
  const parsedData = tryParseJson(responseText);
  const responseHeaders = headersToRecord(response.headers);

  logger.log({
    level: "trace",
    message: "provider_http_response",
    meta: {
      ...traceContext,
      endpoint: request.endpoint,
      status: response.status,
      ok: response.ok,
      headers: responseHeaders,
      bodyText: responseText
    }
  });

  if (!response.ok) {
    const message = extractErrorMessage(parsedData) || responseText || `HTTP ${response.status}`;
    throw new HttpStatusError(response.status, responseText, message.trim());
  }

  return {
    status: response.status,
    data: parsedData,
    bodyText: responseText,
    headers: responseHeaders
  };
}

function tryParseJson(value: string): unknown {
  if (!value || value.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function extractErrorMessage(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message;
  }

  const errorNode = record.error;
  if (errorNode && typeof errorNode === "object") {
    const detail = errorNode as Record<string, unknown>;
    if (typeof detail.message === "string" && detail.message.trim().length > 0) {
      return detail.message;
    }
    if (typeof detail.code === "string" && detail.code.trim().length > 0) {
      return detail.code;
    }
  }

  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return record.error;
  }

  return "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function backoffMs(attempt: number): number {
  return Math.min(2000, 300 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatFailureReason(failure: ProviderFailure): string {
  const status = typeof failure.status === "number" ? ` status=${failure.status}` : "";
  return `${failure.provider}/${failure.profileId}${status} attempt=${failure.attempt} retryable=${failure.retryable} error=${failure.error}`;
}

export function summarizeFailures(failures: ProviderFailure[]): string {
  return failures.map((failure) => formatFailureReason(failure)).join("; ");
}

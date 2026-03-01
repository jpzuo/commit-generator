const test = require("node:test");
const assert = require("node:assert/strict");

const {
  executeProviderChain,
  formatFailureReason,
  isRetryableStatus,
  summarizeFailures
} = require("../out/ai/executor");

test("isRetryableStatus follows retry policy", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
});

test("summarizeFailures includes status and provider profile", () => {
  const message = summarizeFailures([
    {
      profileId: "primary",
      provider: "openaiCompat",
      endpoint: "https://api.openai.com/v1/chat/completions",
      status: 429,
      retryable: true,
      attempt: 1,
      error: "rate limit",
      latencyMs: 120
    }
  ]);

  assert.match(message, /openaiCompat\/primary/);
  assert.match(message, /status=429/);
  assert.match(message, /retryable=true/);
});

test("formatFailureReason is deterministic", () => {
  const reason = formatFailureReason({
    profileId: "fallback",
    provider: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    retryable: false,
    attempt: 2,
    error: "invalid request",
    latencyMs: 98
  });

  assert.equal(
    reason,
    "anthropic/fallback attempt=2 retryable=false error=invalid request"
  );
});

test("executeProviderChain retries retryable errors then switches to fallback profile", async () => {
  const originalFetch = global.fetch;
  let provider1Calls = 0;
  let provider2Calls = 0;

  global.fetch = async (url) => {
    const endpoint = String(url);
    if (endpoint.startsWith("https://provider1.test")) {
      provider1Calls += 1;
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 500 });
    }
    provider2Calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "feat: 增加回退链路测试" } }]
      }),
      { status: 200 }
    );
  };

  try {
    const result = await executeProviderChain(
      {
        prompt: "test",
        transformMessage: (value) => value,
        profiles: [
          {
            id: "primary",
            kind: "openaiCompat",
            model: "gpt-4.1-mini",
            baseUrl: "https://provider1.test",
            apiKey: "k1",
            envKey: "OPENAI_API_KEY",
            enabled: true,
            timeoutMs: 1000,
            maxRetries: 1,
            extraHeaders: {},
            azureApiVersion: "2024-10-21",
            geminiApiVersion: "v1beta"
          },
          {
            id: "fallback",
            kind: "openaiCompat",
            model: "gpt-4.1-mini",
            baseUrl: "https://provider2.test",
            apiKey: "k2",
            envKey: "OPENAI_API_KEY",
            enabled: true,
            timeoutMs: 1000,
            maxRetries: 0,
            extraHeaders: {},
            azureApiVersion: "2024-10-21",
            geminiApiVersion: "v1beta"
          }
        ]
      },
      { log() {} }
    );

    assert.equal(provider1Calls, 2);
    assert.equal(provider2Calls, 1);
    assert.equal(result.success.profileId, "fallback");
    assert.equal(result.failures.length, 2);
    assert.equal(result.failures[0].retryable, true);
  } finally {
    global.fetch = originalFetch;
  }
});

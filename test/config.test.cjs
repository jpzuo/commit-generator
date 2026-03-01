const test = require("node:test");
const assert = require("node:assert/strict");

const { buildExecutionOrder, resolveExtensionSettings } = require("../out/config/settings");

test("resolveExtensionSettings builds provider order with active + fallback + remaining", () => {
  const settings = resolveExtensionSettings(
    {
      providerProfiles: [
        { id: "openai", kind: "openaiCompat", model: "gpt-4.1-mini", enabled: true },
        { id: "gemini", kind: "gemini", model: "gemini-1.5-flash", enabled: true },
        { id: "ollama", kind: "ollama", model: "qwen2.5-coder:7b", enabled: true }
      ],
      activeProfile: "gemini",
      fallbackProfiles: ["openai"]
    },
    {}
  );

  assert.deepEqual(
    settings.executionOrder.map((profile) => profile.id),
    ["gemini", "openai", "ollama"]
  );
});

test("resolveExtensionSettings maps legacy fields when providerProfiles is empty", () => {
  const settings = resolveExtensionSettings(
    {
      apiProtocol: "anthropicMessages",
      apiKey: "sk-ant-legacy",
      openaiModel: "claude-3-5-sonnet-latest"
    },
    {}
  );

  assert.equal(settings.profiles.length, 1);
  assert.equal(settings.profiles[0].id, "legacy-default");
  assert.equal(settings.profiles[0].kind, "anthropic");
  assert.equal(settings.profiles[0].apiKey, "sk-ant-legacy");
  assert.equal(settings.usedLegacyConfig, true);
});

test("anthropic profile falls back to Claude-style env vars", () => {
  const settings = resolveExtensionSettings(
    {
      providerProfiles: [
        {
          id: "anthropic-env",
          kind: "anthropic",
          enabled: true
        }
      ]
    },
    {
      ANTHROPIC_AUTH_TOKEN: "token-from-env",
      ANTHROPIC_BASE_URL: "https://example-anthropic-gateway.test:60443",
      ANTHROPIC_MODEL: "GLM"
    }
  );

  assert.equal(settings.profiles.length, 1);
  assert.equal(settings.profiles[0].apiKey, "token-from-env");
  assert.equal(settings.profiles[0].baseUrl, "https://example-anthropic-gateway.test:60443");
  assert.equal(settings.profiles[0].model, "GLM");
});

test("request timeout supports API_TIMEOUT_MS env fallback", () => {
  const settings = resolveExtensionSettings(
    {
      providerProfiles: [{ id: "openai", kind: "openaiCompat", model: "gpt-4.1-mini", enabled: true }]
    },
    {
      OPENAI_API_KEY: "env-key",
      API_TIMEOUT_MS: "3000000"
    }
  );

  assert.equal(settings.requestTimeoutMs, 3000000);
  assert.equal(settings.profiles[0].timeoutMs, 3000000);
});

test("supports trace log level and disabling redaction", () => {
  const settings = resolveExtensionSettings(
    {
      providerProfiles: [{ id: "openai", kind: "openaiCompat", model: "gpt-4.1-mini", enabled: true }],
      logLevel: "trace",
      logRedactSensitive: false
    },
    {
      OPENAI_API_KEY: "env-key"
    }
  );

  assert.equal(settings.logLevel, "trace");
  assert.equal(settings.logRedactSensitive, false);
});

test("shows friendly model hint for obvious kind/model mismatch", () => {
  const settings = resolveExtensionSettings(
    {
      providerProfiles: [
        {
          id: "anthropic-main",
          kind: "anthropic",
          model: "GLM",
          baseUrl: "https://api.anthropic.com",
          apiKey: "sk-ant-xxx"
        }
      ]
    },
    {}
  );

  assert.match(settings.warnings.join("\n"), /推荐模型示例/);
});

test("buildExecutionOrder keeps original order when active/fallback not found", () => {
  const profiles = [
    { id: "a", enabled: true },
    { id: "b", enabled: true },
    { id: "c", enabled: true }
  ];

  const ordered = buildExecutionOrder(profiles, "not-exists", ["none"]);
  assert.deepEqual(
    ordered.map((profile) => profile.id),
    ["a", "b", "c"]
  );
});

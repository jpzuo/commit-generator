const test = require("node:test");
const assert = require("node:assert/strict");

const { anthropicAdapter } = require("../out/ai/adapters/anthropic");
const { azureOpenaiAdapter } = require("../out/ai/adapters/azureOpenai");
const { geminiAdapter } = require("../out/ai/adapters/gemini");
const { ollamaAdapter } = require("../out/ai/adapters/ollama");
const { openaiCompatAdapter } = require("../out/ai/adapters/openaiCompat");
const { openaiResponsesAdapter } = require("../out/ai/adapters/openaiResponses");

test("openaiCompat builds chat completions request and parses message", () => {
  const request = openaiCompatAdapter.buildRequest({
    profile: {
      id: "openai",
      kind: "openaiCompat",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      enabled: true,
      timeoutMs: 20000,
      maxRetries: 2,
      extraHeaders: {},
      azureApiVersion: "2024-10-21",
      geminiApiVersion: "v1beta"
    },
    prompt: "hello",
    temperature: 0.2
  });

  assert.equal(request.endpoint, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.headers.Authorization, "Bearer sk-test");
  assert.equal(openaiCompatAdapter.parseResponse({ choices: [{ message: { content: "ok" } }] }), "ok");
});

test("openaiCompat avoids duplicated v1 when baseUrl already includes version", () => {
  const request = openaiCompatAdapter.buildRequest({
    profile: {
      id: "openai-v1",
      kind: "openaiCompat",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      enabled: true,
      timeoutMs: 20000,
      maxRetries: 2,
      extraHeaders: {},
      azureApiVersion: "2024-10-21",
      geminiApiVersion: "v1beta"
    },
    prompt: "hello",
    temperature: 0.2
  });

  assert.equal(request.endpoint, "https://api.openai.com/v1/chat/completions");
});

test("openaiResponses parses output_text and fallback content chunk", () => {
  assert.equal(openaiResponsesAdapter.parseResponse({ output_text: "hello" }), "hello");
  assert.equal(
    openaiResponsesAdapter.parseResponse({
      output: [{ content: [{ type: "output_text", text: "from-content" }] }]
    }),
    "from-content"
  );
});

test("anthropic parses text blocks", () => {
  assert.equal(anthropicAdapter.parseResponse({ content: [{ type: "text", text: "anthropic-ok" }] }), "anthropic-ok");
});

test("anthropic sends both x-api-key and Authorization for gateway compatibility", () => {
  const request = anthropicAdapter.buildRequest({
    profile: {
      id: "anthropic",
      kind: "anthropic",
      model: "claude-3-5-sonnet-latest",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      enabled: true,
      timeoutMs: 20000,
      maxRetries: 2,
      extraHeaders: {},
      azureApiVersion: "2024-10-21",
      geminiApiVersion: "v1beta"
    },
    prompt: "hello",
    temperature: 0.2
  });

  assert.equal(request.headers["x-api-key"], "sk-ant-test");
  assert.equal(request.headers.Authorization, "Bearer sk-ant-test");
});

test("azureOpenai builds deployment endpoint", () => {
  const request = azureOpenaiAdapter.buildRequest({
    profile: {
      id: "azure",
      kind: "azureOpenai",
      model: "gpt-4o-mini",
      baseUrl: "https://demo.openai.azure.com",
      apiKey: "azure-key",
      enabled: true,
      timeoutMs: 20000,
      maxRetries: 2,
      extraHeaders: {},
      azureDeployment: "chat-prod",
      azureApiVersion: "2024-10-21",
      geminiApiVersion: "v1beta"
    },
    prompt: "hello",
    temperature: 0.2
  });

  assert.match(
    request.endpoint,
    /^https:\/\/demo\.openai\.azure\.com\/openai\/deployments\/chat-prod\/chat\/completions\?api-version=2024-10-21$/
  );
  assert.equal(request.headers["api-key"], "azure-key");
});

test("gemini builds endpoint with key and parses candidates", () => {
  const request = geminiAdapter.buildRequest({
    profile: {
      id: "gemini",
      kind: "gemini",
      model: "gemini-1.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
      enabled: true,
      timeoutMs: 20000,
      maxRetries: 2,
      extraHeaders: {},
      azureApiVersion: "2024-10-21",
      geminiApiVersion: "v1beta"
    },
    prompt: "hello",
    temperature: 0.2
  });

  assert.match(
    request.endpoint,
    /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-1\.5-flash:generateContent\?key=gemini-key$/
  );

  assert.equal(
    geminiAdapter.parseResponse({
      candidates: [{ content: { parts: [{ text: "line1" }, { text: "line2" }] } }]
    }),
    "line1\nline2"
  );
});

test("gemini avoids duplicated api version segment in baseUrl", () => {
  const request = geminiAdapter.buildRequest({
    profile: {
      id: "gemini-v1beta",
      kind: "gemini",
      model: "gemini-1.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gemini-key",
      enabled: true,
      timeoutMs: 20000,
      maxRetries: 2,
      extraHeaders: {},
      azureApiVersion: "2024-10-21",
      geminiApiVersion: "v1beta"
    },
    prompt: "hello",
    temperature: 0.2
  });

  assert.equal(
    request.endpoint,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=gemini-key"
  );
});

test("ollama request and parser", () => {
  const request = ollamaAdapter.buildRequest({
    profile: {
      id: "ollama",
      kind: "ollama",
      model: "qwen2.5-coder:7b",
      baseUrl: "http://127.0.0.1:11434",
      enabled: true,
      timeoutMs: 20000,
      maxRetries: 2,
      extraHeaders: {},
      azureApiVersion: "2024-10-21",
      geminiApiVersion: "v1beta"
    },
    prompt: "hello",
    temperature: 0.2
  });

  assert.equal(request.endpoint, "http://127.0.0.1:11434/api/chat");
  assert.equal(ollamaAdapter.parseResponse({ message: { content: "ollama-ok" } }), "ollama-ok");
});

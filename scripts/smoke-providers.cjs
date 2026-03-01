#!/usr/bin/env node

const COMMIT_HEADER_PATTERN =
  /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([a-zA-Z0-9_-]+\))?:\s.+/m;

async function main() {
  const checks = buildChecks();
  let executed = 0;
  let failed = 0;

  for (const check of checks) {
    if (!check.enabled) {
      console.log(`[skip] ${check.name}: ${check.skipReason}`);
      continue;
    }

    executed += 1;
    try {
      const output = await check.run();
      validateCommitMessage(output, check.name);
      console.log(`[pass] ${check.name}: ${output.split(/\r?\n/)[0]}`);
    } catch (error) {
      failed += 1;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[fail] ${check.name}: ${detail}`);
    }
  }

  if (executed === 0) {
    console.log("没有可执行的 provider 烟测。请先配置对应环境变量。");
    return;
  }

  if (failed > 0) {
    process.exitCode = 1;
    console.error(`烟测结束：${executed - failed}/${executed} 通过。`);
    return;
  }

  console.log(`烟测结束：${executed}/${executed} 通过。`);
}

function buildChecks() {
  const prompt = [
    "你是一名资深工程师。",
    "请输出一个符合 Conventional Commits 的中文提交信息，必须仅输出一行标题。",
    "示例格式：feat: 增加烟测命令",
    "不要输出解释。"
  ].join("\n");

  const checks = [
    {
      name: "openaiCompat",
      enabled: Boolean(process.env.OPENAI_API_KEY),
      skipReason: "缺少 OPENAI_API_KEY",
      run: async () => {
        const endpoint = `${normalizeBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com")}/v1/chat/completions`;
        const data = await postJson(
          endpoint,
          {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          {
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            temperature: 0.2,
            messages: [{ role: "user", content: prompt }]
          }
        );
        return extractOpenAIChat(data);
      }
    },
    {
      name: "openaiResponses",
      enabled: Boolean(process.env.OPENAI_API_KEY),
      skipReason: "缺少 OPENAI_API_KEY",
      run: async () => {
        const endpoint = `${normalizeBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com")}/v1/responses`;
        const data = await postJson(
          endpoint,
          {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          {
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            temperature: 0.2,
            input: prompt
          }
        );
        return extractOpenAIResponses(data);
      }
    },
    {
      name: "anthropic",
      enabled: Boolean(process.env.ANTHROPIC_API_KEY),
      skipReason: "缺少 ANTHROPIC_API_KEY",
      run: async () => {
        const endpoint = `${normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com")}/v1/messages`;
        const data = await postJson(
          endpoint,
          {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          {
            model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
            max_tokens: 256,
            temperature: 0.2,
            messages: [{ role: "user", content: prompt }]
          }
        );
        return extractAnthropic(data);
      }
    },
    {
      name: "azureOpenai",
      enabled: Boolean(
        process.env.AZURE_OPENAI_API_KEY &&
          process.env.AZURE_OPENAI_BASE_URL &&
          process.env.AZURE_OPENAI_DEPLOYMENT
      ),
      skipReason: "缺少 AZURE_OPENAI_API_KEY / AZURE_OPENAI_BASE_URL / AZURE_OPENAI_DEPLOYMENT",
      run: async () => {
        const version = process.env.AZURE_OPENAI_API_VERSION || "2024-10-21";
        const endpoint = `${normalizeBaseUrl(
          process.env.AZURE_OPENAI_BASE_URL
        )}/openai/deployments/${encodeURIComponent(
          process.env.AZURE_OPENAI_DEPLOYMENT
        )}/chat/completions?api-version=${encodeURIComponent(version)}`;
        const data = await postJson(
          endpoint,
          {
            "api-key": process.env.AZURE_OPENAI_API_KEY,
            "Content-Type": "application/json"
          },
          {
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
          }
        );
        return extractOpenAIChat(data);
      }
    },
    {
      name: "gemini",
      enabled: Boolean(process.env.GEMINI_API_KEY),
      skipReason: "缺少 GEMINI_API_KEY",
      run: async () => {
        const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";
        const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
        const endpoint = `${normalizeBaseUrl(
          process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
        )}/${apiVersion}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
          process.env.GEMINI_API_KEY
        )}`;
        const data = await postJson(
          endpoint,
          {
            "Content-Type": "application/json"
          },
          {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
          }
        );
        return extractGemini(data);
      }
    },
    {
      name: "ollama",
      enabled: process.env.OLLAMA_SMOKE === "1",
      skipReason: "未设置 OLLAMA_SMOKE=1（默认跳过本地模型）",
      run: async () => {
        const endpoint = `${normalizeBaseUrl(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434")}/api/chat`;
        const data = await postJson(
          endpoint,
          {
            "Content-Type": "application/json"
          },
          {
            model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
            stream: false,
            options: { temperature: 0.2 },
            messages: [{ role: "user", content: prompt }]
          }
        );
        return extractOllama(data);
      }
    }
  ];

  return checks;
}

async function postJson(endpoint, headers, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok) {
    const detail = extractError(json) || text || `HTTP ${response.status}`;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  return json;
}

function extractOpenAIChat(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    for (const chunk of content) {
      if (chunk && typeof chunk.text === "string" && chunk.text) {
        return chunk.text;
      }
    }
  }
  return "";
}

function extractOpenAIResponses(data) {
  if (typeof data?.output_text === "string" && data.output_text) {
    return data.output_text;
  }
  for (const item of data?.output || []) {
    for (const chunk of item?.content || []) {
      if (typeof chunk?.text === "string" && chunk.text) {
        return chunk.text;
      }
    }
  }
  return "";
}

function extractAnthropic(data) {
  for (const chunk of data?.content || []) {
    if (typeof chunk?.text === "string" && chunk.text) {
      return chunk.text;
    }
  }
  return "";
}

function extractGemini(data) {
  const lines = [];
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (typeof part?.text === "string" && part.text) {
      lines.push(part.text);
    }
  }
  return lines.join("\n");
}

function extractOllama(data) {
  if (typeof data?.message?.content === "string") {
    return data.message.content;
  }
  return "";
}

function validateCommitMessage(message, providerName) {
  const text = String(message || "").trim();
  if (!text) {
    throw new Error("响应内容为空");
  }
  if (!COMMIT_HEADER_PATTERN.test(text)) {
    throw new Error(`不符合 Conventional Commit 标题格式: ${JSON.stringify(text.slice(0, 120))}`);
  }
  if (!/[\u4e00-\u9fff]/.test(text)) {
    throw new Error(`标题未包含中文内容: ${JSON.stringify(text.slice(0, 120))}`);
  }
  if (providerName === "ollama" && text.length < 6) {
    throw new Error("ollama 输出过短，疑似模型未按提示返回");
  }
}

function extractError(json) {
  if (json && typeof json.message === "string" && json.message) {
    return json.message;
  }
  if (json && json.error && typeof json.error.message === "string" && json.error.message) {
    return json.error.message;
  }
  if (json && typeof json.error === "string" && json.error) {
    return json.error;
  }
  return "";
}

function parseJson(text) {
  if (!text || !text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exit(1);
});

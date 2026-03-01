# Commit Generator

一个 VS Code 扩展：在 Source Control（源代码管理）视图中，根据当前 Git 暂存区变更自动生成中文 Conventional Commit 提交信息。

开源地址：https://github.com/jpzuo/commit-generator

## 功能概览

- 输出格式固定为：`标题 + 空行 + 详细正文`
- 标题格式固定为：`type(scope): subject` 或 `type: subject`
- `type` 限定为 Conventional Commits 常见类型（`feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert`）
- `subject` 要求简体中文、单行
- 中文表达固定为偏技术改动表达模板
- 支持 6 类接口：`openaiCompat`、`openaiResponses`、`anthropic`、`azureOpenai`、`gemini`、`ollama`
- 支持多配置回退链：`activeProfile -> fallbackProfiles -> 其他 enabled profile`
- 支持从已有配置下拉选择当前使用配置（命令面板 + 状态栏入口）
- AI 不可用时自动回退本地规则生成，保证不中断提交流程

## 快速开始

1. 打开一个 Git 仓库工作区。
2. 将改动加入暂存区（`git add`）。
3. 在 `settings.json` 配置 `commitGenerator.providerProfiles`（参考下方示例）。
4. 在 Source Control 页面点击 `生成 Commit 信息`，或执行命令 `commitGenerator.generate`。
5. 如需切换当前配置，执行命令 `commitGenerator.switchProviderProfile`，或点击状态栏中的 `Commit AI: <profile>`。

入口示意图：

![功能入口示意图](https://commit-generator.oss-cn-beijing.aliyuncs.com/Snipaste_2026-02-15_17-49-04.png)

## 配置说明

### 全局配置（`commitGenerator.*`）

- `providerProfiles`: provider 配置列表（核心配置）
- `activeProfile`（默认 `default`）: 当前优先使用的 profile id
- `fallbackProfiles`（默认 `[]`）: 回退链 profile id 顺序；为空时自动使用其余 enabled profile
- `requestTimeoutMs`（默认 `20000`）: 全局请求超时（毫秒）
- `maxRetries`（默认 `2`）: 可重试错误（429/5xx/超时）的重试次数
- `logLevel`（默认 `normal`）: `off | normal | debug | trace`
- `logRedactSensitive`（默认 `true`）: 是否对日志中的密钥/鉴权字段做脱敏

说明：

- `requestTimeoutMs` 未配置时会回退读取环境变量 `API_TIMEOUT_MS`
- `commitGenerator.chineseStyle` 已移除，不再需要配置

### `providerProfiles` 字段

每个 profile 支持以下字段：

- `id`（必填）: 配置唯一标识
- `kind`（必填）: `openaiCompat | openaiResponses | anthropic | azureOpenai | gemini | ollama`
- `model`（建议填写）: 模型名
- `baseUrl`（建议填写）: 接口基础地址
- `apiKey`（可选）: API Key；为空时回退环境变量
- `envKey`（可选）: 自定义环境变量名
- `enabled`（可选，默认 `true`）: 是否启用该 profile
- `timeoutMs`（可选）: 覆盖全局超时
- `maxRetries`（可选）: 覆盖全局重试次数
- `extraHeaders`（可选）: 额外请求头（常用于中转网关）
- `azureDeployment`（`azureOpenai` 必填）
- `azureApiVersion`（可选，默认 `2024-10-21`）
- `geminiApiVersion`（可选，默认 `v1beta`）

### `kind` 与模型建议

插件在检测到明显不匹配时，会在 `Output -> Commit Generator` 给出友好提示（推荐模型示例）。

- `openaiCompat`: 推荐 `gpt-4.1-mini / gpt-4o-mini / o3-mini`
- `openaiResponses`: 推荐 `gpt-4.1-mini / gpt-4o-mini / o3-mini`
- `anthropic`: 推荐 `claude-3-5-sonnet-latest / claude-3-7-sonnet-latest`
- `azureOpenai`: 推荐 `gpt-4o-mini / gpt-4.1-mini`
- `gemini`: 推荐 `gemini-1.5-flash / gemini-1.5-pro`
- `ollama`: 推荐 `qwen2.5-coder:7b / llama3.1:8b`

说明：推荐值不是强制值。使用第三方中转时，模型名可能是自定义名称。

## 配置示例

### 示例 1：OpenAI 主用 + Anthropic/Gemini/Ollama 回退

```json
{
  "commitGenerator.providerProfiles": [
    {
      "id": "openai-main",
      "kind": "openaiCompat",
      "model": "gpt-4.1-mini",
      "baseUrl": "https://api.openai.com",
      "apiKey": "sk-xxxx"
    },
    {
      "id": "claude-fallback",
      "kind": "anthropic",
      "model": "claude-3-5-sonnet-latest",
      "baseUrl": "https://api.anthropic.com",
      "envKey": "ANTHROPIC_AUTH_TOKEN"
    },
    {
      "id": "gemini-fallback",
      "kind": "gemini",
      "model": "gemini-1.5-flash",
      "baseUrl": "https://generativelanguage.googleapis.com",
      "envKey": "GEMINI_API_KEY"
    },
    {
      "id": "local-ollama",
      "kind": "ollama",
      "model": "qwen2.5-coder:7b",
      "baseUrl": "http://127.0.0.1:11434",
      "enabled": true
    }
  ],
  "commitGenerator.activeProfile": "openai-main",
  "commitGenerator.fallbackProfiles": ["claude-fallback", "gemini-fallback", "local-ollama"],
  "commitGenerator.requestTimeoutMs": 20000,
  "commitGenerator.maxRetries": 2,
  "commitGenerator.logLevel": "normal",
  "commitGenerator.logRedactSensitive": true
}
```

### 示例 2：Anthropic 网关（兼容 Claude Code 常见环境变量）

```json
{
  "commitGenerator.providerProfiles": [
    {
      "id": "anthropic-gateway",
      "kind": "anthropic",
      "model": "GLM",
      "baseUrl": "https://your-gateway.example.com",
      "envKey": "ANTHROPIC_AUTH_TOKEN"
    }
  ],
  "commitGenerator.activeProfile": "anthropic-gateway"
}
```

### 示例 3：Azure OpenAI

```json
{
  "commitGenerator.providerProfiles": [
    {
      "id": "azure-main",
      "kind": "azureOpenai",
      "model": "gpt-4o-mini",
      "baseUrl": "https://<your-resource>.openai.azure.com",
      "apiKey": "<azure-api-key>",
      "azureDeployment": "<deployment-name>",
      "azureApiVersion": "2024-10-21"
    }
  ],
  "commitGenerator.activeProfile": "azure-main"
}
```

## 日志与排障

查看路径：`View -> Output -> Commit Generator`

- `normal`: 关键运行日志（默认）
- `debug`: 更多调试信息
- `trace`: 完整请求/响应日志（包含请求体与响应体）

完整排障建议（临时开启）：

```json
{
  "commitGenerator.logLevel": "trace",
  "commitGenerator.logRedactSensitive": false
}
```

注意：`logRedactSensitive=false` 会输出完整敏感信息，仅建议在本机短时调试，结束后改回 `true`。

## 环境变量回退规则

常用环境变量：

- OpenAI: `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`
- Anthropic: `ANTHROPIC_AUTH_TOKEN`（优先）、`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`
- Azure OpenAI: `AZURE_OPENAI_API_KEY`、`AZURE_OPENAI_BASE_URL`、`AZURE_OPENAI_DEPLOYMENT`、`AZURE_OPENAI_MODEL`
- Gemini: `GEMINI_API_KEY`、`GEMINI_BASE_URL`、`GEMINI_MODEL`
- Ollama: `OLLAMA_BASE_URL`、`OLLAMA_MODEL`
- 全局超时回退: `API_TIMEOUT_MS`

## 旧配置兼容

旧键 `apiKey/openaiApiKey/apiBaseUrl/apiProtocol/openaiModel` 仍可读取。  
当 `providerProfiles` 为空时，插件会自动把旧键映射为兼容 profile。  
建议逐步迁移到 `providerProfiles`，以使用回退链和下拉切换能力。

## 测试与打包

运行单元测试：

```bash
npm test
```

运行 provider 真实接口烟测（按环境变量自动跳过未配置 provider）：

```bash
npm run smoke:providers
```

打包：

```powershell
npm run release
```

## 问题反馈

- 邮箱：`zuojinpu@qq.com`

建议反馈时附带：

- 操作步骤与期望结果
- 实际报错信息（建议附 Output 面板日志）
- VS Code 版本、插件版本、操作系统
- `commitGenerator.*` 配置（请隐藏密钥）

## 图标来源

- Extension Icon: ["Magic Wand Icon 229981 Color Flipped" by videoplasty.com](https://commons.wikimedia.org/wiki/File:Magic_Wand_Icon_229981_Color_Flipped.svg)
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

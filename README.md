# Commit Generator

一个 VS Code 扩展：在 Source Control（源代码管理） 视图和状态栏提供入口，根据当前 Git 变更自动生成中文 Conventional Commit 提交信息。

开源地址：https://github.com/jpzuo/commit-generator

## 功能说明

- 输出为“标题 + 空行 + 详细正文”
- 标题格式固定为 `type(scope): subject` 或 `type: subject`
- `type` 限定为 Conventional Commits 常见类型（`feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert`）
- `subject` 要求简体中文、单行
- 中文表达固定为“偏技术改动表达”模板
- 默认优先调用 AI 生成；AI 不可用时自动回退本地规则生成
- 仅基于当前暂存区（staged）变更生成（即已 `git add` 的内容）
- 变更 diff 最多取前 12000 个字符参与生成，超出部分会截断
- 详细正文中的“变更文件”最多展示前 3 个文件名，其余以“等 N 个文件”概括

## 使用方式

1. 打开一个 Git 仓库工作区。
2. 打开 Source Control 视图。
3. 先将要提交的改动加入暂存区（`git add`）。
4. 点击 Source Control 标题栏按钮 `生成提交信息`。
5. 插件会生成并覆盖写入当前仓库的提交输入框。

也可在命令面板执行命令 ID：`commitGenerator.generate`。

入口位置示意图：

![功能入口示意图](https://commit-generator.oss-cn-beijing.aliyuncs.com/Snipaste_2026-02-15_17-49-04.png)

## 配置项

在 VS Code 设置（`commitGenerator.*`）中配置：

- `commitGenerator.providerProfiles`
  - Provider 配置数组；每项结构：
  - `id`：唯一标识
  - `kind`：`openaiCompat` / `openaiResponses` / `anthropic` / `azureOpenai` / `gemini` / `ollama`
  - `kind` 决定请求协议与解析方式，设置时会给出模型建议提示
  - `model`：模型名
  - `baseUrl`：接口地址（不同 provider 默认值不同）
  - `apiKey`：API Key（可为空，回退环境变量）
  - `envKey`：自定义环境变量名（可选）
  - `enabled`：是否启用（默认 `true`）
  - `timeoutMs`、`maxRetries`：可覆盖全局超时与重试
  - `extraHeaders`：自定义请求头（用于网关/中转）
  - `azureDeployment`、`azureApiVersion`：Azure OpenAI 专用
  - `geminiApiVersion`：Gemini 专用
- `commitGenerator.activeProfile`（默认：`default`）
  - 首选 profile id
- `commitGenerator.fallbackProfiles`（默认：`[]`）
  - 回退链 profile id 顺序；为空时自动使用其余 enabled profile
- `commitGenerator.requestTimeoutMs`（默认：`20000`）
  - 全局请求超时（毫秒）
  - 若未配置，会回退读取环境变量 `API_TIMEOUT_MS`
- `commitGenerator.maxRetries`（默认：`2`）
  - 可重试错误（429/5xx/超时）重试次数
- `commitGenerator.logLevel`（默认：`normal`）
  - `off`：关闭日志
  - `normal`：结构化日志（脱敏）
  - `debug`：额外输出请求调试信息（脱敏）
  - `trace`：输出完整请求与响应日志
- `commitGenerator.logRedactSensitive`（默认：`true`）
  - 是否对日志中的密钥/鉴权字段做脱敏
  - 需要完整排障时可临时设为 `false`

可通过命令面板执行 `commitGenerator.switchProviderProfile`，从已有配置中下拉选择当前 active profile。
状态栏也会显示当前配置，点击即可下拉切换。

### Provider Profiles 示例（`settings.json`）

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

Azure OpenAI 示例：

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

### 旧配置兼容与迁移

- 旧键 `apiKey/openaiApiKey/apiBaseUrl/apiProtocol/openaiModel` 仍可使用。
- 当 `providerProfiles` 为空时，插件会自动把旧键映射为一个兼容 profile。
- 建议逐步迁移到 `providerProfiles`，以获得多 provider 回退和快速切换能力。

## 打包

一键升级补丁版本并打包：

```powershell
npm run release
```

指定升级类型（`patch/minor/major`）：

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/release.ps1 -ReleaseType minor
```

执行后会在项目根目录生成 `*.vsix` 安装包。

## 测试

- 运行单元测试：

```bash
npm test
```

- 运行 provider 真实接口烟测（按环境变量自动跳过未配置 provider）：

```bash
npm run smoke:providers
```

常用环境变量：

- `OPENAI_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`（Anthropic 网关优先）
- `ANTHROPIC_API_KEY`（Anthropic 兼容）
- `ANTHROPIC_BASE_URL`（Anthropic 默认 baseUrl）
- `ANTHROPIC_MODEL`（Anthropic 默认模型）
- `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_BASE_URL` + `AZURE_OPENAI_DEPLOYMENT`
- `GEMINI_API_KEY`
- `API_TIMEOUT_MS`（全局超时回退）
- `OLLAMA_SMOKE=1`（可选，默认跳过本地 Ollama）

完整流量日志排障建议（Output -> Commit Generator）：

```json
{
  "commitGenerator.logLevel": "trace",
  "commitGenerator.logRedactSensitive": false
}
```

## 问题反馈

如果你在使用中遇到问题，可通过邮箱反馈：

- 邮箱：`zuojinpu@qq.com`

为便于快速定位问题，建议尽量提供以下信息（越详细越好）：

- 问题描述：你做了什么操作、期望结果是什么、实际结果是什么
- 问题贴图：报错弹窗、控制台日志、界面状态截图
- 复现步骤：按步骤写出如何稳定复现
- 环境信息：操作系统、VS Code 版本、插件版本
- 配置信息：`commitGenerator.*` 相关配置（注意隐藏密钥等敏感信息）

## 图标来源

- Extension Icon: ["Magic Wand Icon 229981 Color Flipped" by videoplasty.com](https://commons.wikimedia.org/wiki/File:Magic_Wand_Icon_229981_Color_Flipped.svg)
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

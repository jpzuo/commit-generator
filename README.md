# Commit Generator

一个 VS Code 扩展：在 Source Control（源代码管理） 视图和状态栏提供入口，根据当前 Git 变更自动生成中文 Conventional Commit 提交信息。

开源地址：https://github.com/jpzuo/commit-generator

## 功能说明

- 生成格式固定为 `type(scope): subject` 或 `type: subject`
- `type` 限定为 Conventional Commits 常见类型（`feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert`）
- `subject` 要求简体中文、单行
- 默认优先调用 AI 生成；AI 不可用时自动回退本地规则生成
- 会综合以下变更内容生成提交信息：
  - staged diff
  - unstaged diff
  - untracked 文件（最多预览前 5 个文件内容）

## 使用方式

1. 打开一个 Git 仓库工作区。
2. 打开 Source Control 视图。
3. 点击 Source Control 标题栏按钮，或状态栏按钮 `生成提交信息`。
4. 插件会生成并覆盖写入当前仓库的提交输入框。

也可在命令面板执行命令 ID：`commitGenerator.generate`。

入口位置示意图：

![功能入口示意图](https://commit-generator.oss-cn-beijing.aliyuncs.com/Snipaste_2026-02-15_17-49-04.png)

## 配置项

在 VS Code 设置（`commitGenerator.*`）中配置：

- `commitGenerator.apiKey`
  - OpenAI 兼容中转服务的 API Key
  - 若为空，回退到 `commitGenerator.openaiApiKey`，再回退到环境变量 `OPENAI_API_KEY`
- `commitGenerator.openaiApiKey`
  - OpenAI API Key（兼容老配置）
- `commitGenerator.apiBaseUrl`（默认：`https://api.openai.com`）
  - OpenAI 兼容接口地址
- `commitGenerator.apiProtocol`（默认：`chatCompletions`）
  - 可选：`chatCompletions` 或 `responses`
- `commitGenerator.openaiModel`（默认：`gpt-4.1-mini`）
  - 生成提交信息使用的模型名
- `commitGenerator.chineseStyle`（默认：`engineering`）
  - `engineering`：偏技术表达
  - `business`：偏业务价值表达
  - `concise`：偏简洁表达

配置示例（`settings.json`）：

```json
{
  // 我用的是这家的目前（2026-2-15）免费，有GLM和Qwen模型，只是生成描述的话够用 -> https://pureai.shop/dashboard.html
  "commitGenerator.apiBaseUrl": "https://sym-tenant-24992923-a800code-ingress-cn-xibei1.eks.ebcloud.com:60443", 
  "commitGenerator.apiKey": "sk-xxxx",
  "commitGenerator.apiProtocol": "chatCompletions",
  "commitGenerator.openaiModel": "GLM",
  "commitGenerator.chineseStyle": "engineering",
}
```

## 图标来源

- Extension Icon: ["Magic Wand Icon 229981 Color Flipped" by videoplasty.com](https://commons.wikimedia.org/wiki/File:Magic_Wand_Icon_229981_Color_Flipped.svg)
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

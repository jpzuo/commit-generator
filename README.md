# Commit Generator

一个 VS Code 扩展：在 Source Control（源代码管理） 视图和状态栏提供入口，根据当前 Git 变更自动生成中文 Conventional Commit 提交信息。

开源地址：https://github.com/jpzuo/commit-generator

## 功能说明

- 输出为“标题 + 空行 + 详细正文”
- 标题格式固定为 `type(scope): subject` 或 `type: subject`
- `type` 限定为 Conventional Commits 常见类型（`feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert`）
- `subject` 要求简体中文、单行
- 默认优先调用 AI 生成；AI 不可用时自动回退本地规则生成
- 仅基于当前暂存区（staged）变更生成（即已 `git add` 的内容）
- 变更 diff 最多取前 12000 个字符参与生成，超出部分会截断
- 详细正文中的“变更文件”最多展示前 3 个文件名，其余以“等 N 个文件”概括

## 使用方式

1. 打开一个 Git 仓库工作区。
2. 打开 Source Control 视图。
3. 先将要提交的改动加入暂存区（`git add`）。
4. 点击 Source Control 标题栏按钮，或状态栏按钮 `生成提交信息`。
5. 插件会生成并覆盖写入当前仓库的提交输入框。

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
  // 可替换为你的 OpenAI 兼容服务地址，兼容任何第三方openAI格式
  "commitGenerator.apiBaseUrl": "https://api.openai.com",
  "commitGenerator.apiKey": "sk-xxxx",
  "commitGenerator.apiProtocol": "chatCompletions",
  "commitGenerator.openaiModel": "GLM",
  "commitGenerator.chineseStyle": "engineering",
}
```

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

## 图标来源

- Extension Icon: ["Magic Wand Icon 229981 Color Flipped" by videoplasty.com](https://commons.wikimedia.org/wiki/File:Magic_Wand_Icon_229981_Color_Flipped.svg)
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

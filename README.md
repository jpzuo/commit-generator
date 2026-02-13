# Commit Generator

一个 VSCode 扩展：在源代码管理（Source Control）工具栏中提供按钮，一键根据当前 Git 变更自动生成提交信息。

生成结果始终为中文，并符合 Conventional Commits 规范。

## 使用方式

1. 打开一个 Git 仓库工作区。
2. 进入 VSCode 的源代码管理面板（Source Control）。
3. 点击源代码管理标题栏上的魔棒图标，或点击状态栏按钮“生成提交信息”。
4. 插件会自动生成提交信息，并直接覆盖写入提交输入框。

也可以在命令面板中执行：`生成 Commit 信息`。

## OpenAI 配置

可任选其一配置 API Key：

1. VSCode 设置项：`commitGenerator.openaiApiKey`
2. 环境变量：`OPENAI_API_KEY`

可选配置：

- `commitGenerator.openaiModel`（默认：`gpt-4.1-mini`）
- `commitGenerator.chineseStyle`
  - `engineering`（默认）：偏技术表达
  - `business`：偏业务价值表达
  - `concise`：偏精简表达

如果未配置 API Key，插件会自动回退到本地规则生成模式。

## 开发调试

```bash
npm install
npm run compile
```

在 VSCode 中按 `F5` 启动 Extension Development Host 进行调试。

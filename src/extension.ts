import * as cp from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: {
    value: string;
  };
}

interface GitApi {
  repositories: GitRepository[];
}

interface CommitContext {
  files: string[];
  diff: string;
}

type ChineseStyle = "business" | "engineering" | "concise";
type MessageSource = "ai" | "fallback";
type ApiProtocol = "chatCompletions" | "responses";

interface BuildResult {
  message: string;
  source: MessageSource;
  reason?: string;
}

const MAX_DIFF_CHARS = 12000;
const output = vscode.window.createOutputChannel("Commit Generator");
const STATUS_IDLE_TEXT = "$(sparkle) 生成提交信息";
const STATUS_BUSY_TEXT = "$(sync~spin) 正在生成提交信息...";

export function activate(context: vscode.ExtensionContext): void {
  vscode.window.showInformationMessage("Commit Generator 已激活。可在状态栏点击“生成提交信息”。");
  let isGenerating = false;

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = STATUS_IDLE_TEXT;
  statusBarItem.tooltip = "根据当前 Git 变更生成中文规范 Commit Message";
  statusBarItem.command = "commitGenerator.generate";
  statusBarItem.show();

  const disposable = vscode.commands.registerCommand("commitGenerator.generate", async () => {
    if (isGenerating) {
      vscode.window.showInformationMessage("正在生成提交信息，请稍候...");
      return;
    }

    isGenerating = true;
    statusBarItem.text = STATUS_BUSY_TEXT;
    statusBarItem.tooltip = "正在生成中，请稍候...";

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在生成提交信息",
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: "正在读取暂存区变更..." });

          const git = await getGitApi();
          if (!git || git.repositories.length === 0) {
            vscode.window.showErrorMessage("当前工作区未检测到 Git 仓库。");
            return;
          }

          const repo = pickRepository(git.repositories);
          progress.report({ message: "正在调用生成接口..." });
          const result = await buildCommitMessage(repo.rootUri.fsPath);

          if (!result.message) {
            vscode.window.showWarningMessage("暂存区无变更，未生成提交信息。");
            return;
          }

          progress.report({ message: "正在写入提交输入框..." });
          repo.inputBox.value = result.message;
          const sourceText = result.source === "ai" ? "AI" : "本地规则";
          vscode.window.showInformationMessage(`已生成提交信息并覆盖输入框（来源：${sourceText}）。`);

          output.appendLine(`[result] source=${result.source} message="${result.message}"`);
          if (result.reason) {
            output.appendLine(`[fallback-reason] ${result.reason}`);
          }
        }
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`生成提交信息失败：${detail}`);
      output.appendLine(`[error] ${detail}`);
    } finally {
      isGenerating = false;
      statusBarItem.text = STATUS_IDLE_TEXT;
      statusBarItem.tooltip = "根据当前 Git 变更生成中文规范 Commit Message";
    }
  });

  context.subscriptions.push(disposable, statusBarItem, output);
}

export function deactivate(): void {
  // No resources to dispose.
}

async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension("vscode.git");
  if (!extension) {
    return undefined;
  }

  if (!extension.isActive) {
    await extension.activate();
  }

  const apiHost = extension.exports as { getAPI(version: number): GitApi };
  return apiHost.getAPI(1);
}

function pickRepository(repositories: GitRepository[]): GitRepository {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return repositories[0];
  }

  const currentFolder = folders[0].uri.fsPath;
  const match = repositories.find((repo) => repo.rootUri.fsPath === currentFolder);
  return match ?? repositories[0];
}

async function buildCommitMessage(repoPath: string): Promise<BuildResult> {
  const style = getChineseStyle();
  const context = await collectCommitContext(repoPath);
  if (context.files.length === 0) {
    return { message: "", source: "fallback", reason: "no_changes" };
  }

  try {
    let aiMessage = await generateWithOpenAI(context, style);
    if (aiMessage) {
      if (!hasCommitBody(aiMessage)) {
        aiMessage = `${aiMessage}\n\n${buildDetailedBody(context.files, context.diff)}`;
      }
      return { message: aiMessage, source: "ai" };
    }

    return {
      message: buildRuleBasedMessage(context.files, context.diff, style),
      source: "fallback",
      reason: "ai_empty_or_invalid"
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      message: buildRuleBasedMessage(context.files, context.diff, style),
      source: "fallback",
      reason: `ai_error: ${detail}`
    };
  }
}

async function collectCommitContext(repoPath: string): Promise<CommitContext> {
  const stagedFiles = await runGit(repoPath, ["diff", "--cached", "--name-only"]);
  const stagedList = toLines(stagedFiles);
  if (stagedList.length === 0) {
    return { files: [], diff: "" };
  }

  const diff = await runGit(repoPath, ["diff", "--cached", "--", ...stagedList]);

  return {
    files: stagedList,
    diff: truncateMultiline(diff, MAX_DIFF_CHARS)
  };
}

async function generateWithOpenAI(context: CommitContext, style: ChineseStyle): Promise<string> {
  const config = vscode.workspace.getConfiguration("commitGenerator");
  const apiKey =
    String(config.get<string>("apiKey", "")).trim() ||
    String(config.get<string>("openaiApiKey", "")).trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("未配置 API Key（commitGenerator.apiKey / commitGenerator.openaiApiKey / OPENAI_API_KEY）。");
  }

  const baseUrl = normalizeBaseUrl(String(config.get<string>("apiBaseUrl", "https://api.openai.com")).trim());
  const apiProtocol = getApiProtocol();
  const model = String(config.get<string>("openaiModel", "gpt-4.1-mini")).trim() || "gpt-4.1-mini";
  const prompt = createPrompt(context, style);
  const endpoint = apiProtocol === "responses" ? `${baseUrl}/v1/responses` : `${baseUrl}/v1/chat/completions`;

  const body =
    apiProtocol === "responses"
      ? {
          model,
          input: prompt,
          temperature: 0.2
        }
      : {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2
        };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${response.status}) [${endpoint}]: ${errorText}`);
  }

  if (apiProtocol === "responses") {
    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    return normalizeMessage(extractResponseText(data));
  }

  const chatData = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  return normalizeMessage(extractChatCompletionsText(chatData));
}

function createPrompt(context: CommitContext, style: ChineseStyle): string {
  const styleInstruction = getStyleInstruction(style);
  return [
    "你是一名资深工程师，负责生成 git 提交信息。",
    "输出格式必须是：第一行标题 + 空行 + 详细正文。",
    "标题必须符合 Conventional Commits：type(scope): subject 或 type: subject。",
    "描述具体改动，改动按分类以 - 开头。",// 、影响范围和注意事项
    "type 必须是英文小写（feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert）。",
    "subject 必须是简体中文，使用动宾短语，禁止英文句子、禁止句号。",
    `中文风格要求：${styleInstruction}`,
    "",
    "变更文件：",
    context.files.join("\n"),
    "",
    "代码差异：",
    context.diff
  ].join("\n");
}

function extractResponseText(data: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  if (data.output_text && data.output_text.trim().length > 0) {
    return data.output_text;
  }

  for (const item of data.output ?? []) {
    for (const chunk of item.content ?? []) {
      if (chunk.type === "output_text" && chunk.text) {
        return chunk.text;
      }
      if (chunk.text) {
        return chunk.text;
      }
    }
  }

  return "";
}

function extractChatCompletionsText(data: {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
}): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    for (const chunk of content) {
      if (chunk.text) {
        return chunk.text;
      }
    }
  }

  return "";
}

function normalizeMessage(value: string): string {
  const normalizedLines = value
    .replace(/[`"'*]/g, "")
    .replace(/：/g, ":")
    .split(/\r?\n/)
    .map((line) => sanitizeCandidateLine(line))
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) {
    return "";
  }

  const headerIndex = normalizedLines.findIndex((line) => isValidConventionalCommit(line));
  if (headerIndex < 0) {
    return "";
  }

  const header = truncateInline(normalizedLines[headerIndex], 72);
  const bodyLines = normalizedLines
    .filter((line, index) => index !== headerIndex)
    .filter((line) => !isValidConventionalCommit(line))
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .slice(0, 6);

  if (bodyLines.length === 0) {
    return header;
  }

  return `${header}\n\n${bodyLines.join("\n")}`;
}

function sanitizeCandidateLine(line: string): string {
  let value = line.trim();
  if (!value) {
    return "";
  }

  value = value
    .replace(/^(commit message|message|建议提交信息|提交信息|推荐提交信息)\s*[:：]\s*/i, "")
    .replace(/^\d+[\).\s]+/, "")
    .trim();

  const conventionalMatch = value.match(
    /(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([a-zA-Z0-9_-]+\))?\s*:\s*.+/i
  );
  if (conventionalMatch) {
    value = conventionalMatch[0];
  }

  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) {
    const left = value.slice(0, colonIndex).trim();
    const right = value.slice(colonIndex + 1).trim();
    value = `${left}: ${right}`;
  }

  return value;
}

function hasCommitBody(message: string): boolean {
  const parts = message.split(/\r?\n\r?\n/);
  return parts.length > 1 && parts[1].trim().length > 0;
}

function buildRuleBasedMessage(files: string[], patch: string, style: ChineseStyle): string {
  const type = inferType(files, patch);
  const scope = inferScope(files);
  const subject = inferSubject(files, patch, style);
  const header = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;
  const body = buildDetailedBody(files, patch);

  return `${header}\n\n${body}`;
}

function truncateInline(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 3)}...`;
}

function truncateMultiline(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n...[truncated]`;
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile("git", args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function toLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

function inferType(files: string[], patch: string): string {
  const lowerFiles = files.map((file) => file.toLowerCase());

  if (lowerFiles.every((file) => file.includes("test") || file.endsWith(".snap"))) {
    return "test";
  }

  if (lowerFiles.every((file) => file.includes("readme") || file.startsWith("docs/"))) {
    return "docs";
  }

  if (lowerFiles.some((file) => file.endsWith("package.json") || file.endsWith("pnpm-lock.yaml") || file.endsWith("package-lock.json"))) {
    return "chore";
  }

  const patchLower = patch.toLowerCase();
  if (patchLower.includes("fix") || patchLower.includes("bug") || patchLower.includes("error")) {
    return "fix";
  }

  return "feat";
}

function inferScope(files: string[]): string {
  const first = files[0];
  const dir = path.dirname(first).replace(/\\/g, "/");

  if (!dir || dir === ".") {
    return "";
  }

  const segment = dir.split("/")[0];
  return sanitizeScope(segment);
}

function sanitizeScope(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function inferSubject(files: string[], patch: string, style: ChineseStyle): string {
  const semanticSubject = inferSemanticSubject(files, patch, style);
  if (semanticSubject) {
    return semanticSubject;
  }

  if (files.length === 1) {
    return formatSubject(style, path.basename(files[0]), 1, "");
  }

  const dirs = uniq(
    files
      .map((file) => path.dirname(file).replace(/\\/g, "/"))
      .filter((dir) => dir && dir !== ".")
      .map((dir) => dir.split("/")[0])
  );

  if (dirs.length === 1) {
    return formatSubject(style, "", files.length, dirs[0]);
  }

  return formatSubject(style, "", files.length, "");
}

function inferSemanticSubject(files: string[], patch: string, style: ChineseStyle): string {
  const text = `${files.join("\n")}\n${patch}`.toLowerCase();
  const uniqueTargets = collectSemanticTargets(text, files).slice(0, 2);
  if (uniqueTargets.length === 0) {
    return "";
  }

  const action = inferAction(text, style);
  return style === "concise" ? `${action}${uniqueTargets.join("和")}` : `${action}${uniqueTargets.join("并")}`;
}

function inferAction(text: string, style: ChineseStyle): string {
  if (text.includes("fix") || text.includes("bug") || text.includes("error") || text.includes("异常")) {
    return style === "business" ? "修复" : "修正";
  }
  if (text.includes("add") || text.includes("new file") || text.includes("+++")) {
    return style === "business" ? "新增" : "增加";
  }
  if (text.includes("refactor")) {
    return style === "business" ? "优化" : "重构";
  }

  return style === "business" ? "优化" : "调整";
}

function buildDetailedBody(files: string[], patch: string): string {
  const text = `${files.join("\n")}\n${patch}`.toLowerCase();
  const targets = collectSemanticTargets(text, files);
  const filePreview = files.slice(0, 3).join("、");
  const suffix = files.length > 3 ? ` 等 ${files.length} 个文件` : "";
  const stats = countPatchStats(patch);

  const lines = [
    `- 变更文件：${filePreview}${suffix}`.trim(),
    `- 代码变更：新增 ${stats.added} 行，删除 ${stats.deleted} 行`,
    `- 主要内容：${targets.length > 0 ? targets.slice(0, 3).join("、") : "调整实现细节并完善相关逻辑"}`,
    "- 影响范围：仅基于当前暂存区变更生成"
  ];

  return lines.join("\n");
}

function collectSemanticTargets(text: string, files: string[]): string[] {
  const targets: string[] = [];

  if (text.includes("statusbar") || text.includes("createstatusbaritem")) {
    targets.push("状态栏入口");
  }
  if (text.includes("scm/title") || text.includes("commandpalette") || text.includes("\"menus\"")) {
    targets.push("命令入口展示");
  }
  if (text.includes("activationevents") || text.includes("onstartupfinished") || text.includes("activate(")) {
    targets.push("扩展激活逻辑");
  }
  if (text.includes("readme") || files.some((file) => /readme/i.test(file))) {
    targets.push("使用文档");
  }
  if (text.includes("configuration") || text.includes("\"settings\"") || text.includes(".json")) {
    targets.push("配置项");
  }
  if (text.includes("test") || files.some((file) => /test/i.test(file))) {
    targets.push("测试用例");
  }

  return uniq(targets);
}

function countPatchStats(patch: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deleted += 1;
    }
  }

  return { added, deleted };
}

function isValidConventionalCommit(message: string): boolean {
  const pattern = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([a-zA-Z0-9_-]+\))?:\s.+$/;
  if (!pattern.test(message)) {
    return false;
  }

  const subject = message.split(":").slice(1).join(":").trim();
  if (subject.length === 0) {
    return false;
  }

  const hasChinese = /[\u4e00-\u9fff]/.test(subject);
  return hasChinese;
}

function getChineseStyle(): ChineseStyle {
  const config = vscode.workspace.getConfiguration("commitGenerator");
  const value = String(config.get<string>("chineseStyle", "engineering")).trim();
  if (value === "business" || value === "engineering" || value === "concise") {
    return value;
  }
  return "engineering";
}

function getApiProtocol(): ApiProtocol {
  const config = vscode.workspace.getConfiguration("commitGenerator");
  const value = String(config.get<string>("apiProtocol", "chatCompletions")).trim();
  return value === "responses" ? "responses" : "chatCompletions";
}

function normalizeBaseUrl(url: string): string {
  if (!url) {
    return "https://api.openai.com";
  }
  return url.replace(/\/+$/, "");
}

function getStyleInstruction(style: ChineseStyle): string {
  if (style === "business") {
    return "突出业务价值和用户收益，例如“新增”“优化”“修复某场景问题”";
  }
  if (style === "concise") {
    return "用词尽量精炼，控制在 8-16 个汉字";
  }
  return "突出技术改动本身，例如“重构”“调整”“完善”“补充”";
}

function formatSubject(style: ChineseStyle, fileName: string, fileCount: number, dir: string): string {
  if (style === "business") {
    if (fileName) {
      return `优化 ${fileName} 相关功能`;
    }
    if (dir) {
      return `完善 ${dir} 模块功能实现`;
    }
    return "优化多处功能实现";
  }

  if (style === "concise") {
    if (fileName) {
      return `更新 ${fileName}`;
    }
    if (dir) {
      return `更新 ${dir} 模块`;
    }
    return `更新 ${fileCount} 个文件`;
  }

  if (fileName) {
    return `更新 ${fileName} 实现`;
  }
  if (dir) {
    return `调整 ${dir} 下的 ${fileCount} 个文件`;
  }
  return `更新 ${fileCount} 个文件实现`;
}

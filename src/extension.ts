import * as cp from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { executeProviderChain, summarizeFailures } from "./ai/executor";
import { LogLevel, StructuredLogEntry, StructuredLogger } from "./ai/types";
import { RawExtensionSettings, ResolvedExtensionSettings, resolveExtensionSettings } from "./config/settings";

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

type MessageSource = "ai" | "fallback";

interface BuildResult {
  message: string;
  source: MessageSource;
  reason?: string;
}

const MAX_DIFF_CHARS = 12000;
const output = vscode.window.createOutputChannel("Commit Generator");
const INFO_TIMEOUT_MS = 3000;
const WARN_TIMEOUT_MS = 5000;
const ERROR_TIMEOUT_MS = 8000;
const STATUS_BAR_PRIORITY = 100;
let hasShownLegacyConfigWarning = false;
const IGNORED_COMMIT_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "npm-shrinkwrap.json"
]);

function notifyStatus(message: string, level: "info" | "warn" | "error" = "info"): void {
  const timeout =
    level === "error" ? ERROR_TIMEOUT_MS : level === "warn" ? WARN_TIMEOUT_MS : INFO_TIMEOUT_MS;
  vscode.window.setStatusBarMessage(message, timeout);
  if (level === "warn") {
    output.appendLine(`[warn] ${message}`);
  }
  if (level === "error") {
    output.appendLine(`[error] ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  let isGenerating = false;
  const profileStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, STATUS_BAR_PRIORITY);
  profileStatusBar.command = "commitGenerator.switchProviderProfile";
  profileStatusBar.show();
  updateActiveProfileStatusBar(profileStatusBar);

  const generateDisposable = vscode.commands.registerCommand("commitGenerator.generate", async () => {
    if (isGenerating) {
      notifyStatus("正在生成提交信息，请稍候...");
      return;
    }

    isGenerating = true;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "正在生成提交信息",
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: "正在读取暂存区变更..." });

          const git = await getGitApi();
          if (!git || git.repositories.length === 0) {
            notifyStatus("当前工作区未检测到 Git 仓库。", "error");
            return;
          }

          const repo = pickRepository(git.repositories);
          progress.report({ message: "正在调用生成接口..." });
          const result = await buildCommitMessage(repo.rootUri.fsPath);

          if (!result.message) {
            notifyStatus("暂存区无变更，未生成提交信息。", "warn");
            return;
          }

          progress.report({ message: "正在写入提交输入框..." });
          repo.inputBox.value = result.message;
          if (result.source === "ai") {
            notifyStatus("已生成提交信息并覆盖输入框（来源：AI）。");
          } else {
            notifyStatus("AI 不可用，已回退本地规则生成。可在输出面板查看失败原因。", "warn");
          }

          output.appendLine(`[result] source=${result.source} message="${result.message}"`);
          if (result.reason) {
            output.appendLine(`[fallback-reason] ${result.reason}`);
          }
        }
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notifyStatus(`生成提交信息失败：${detail}`, "error");
    } finally {
      isGenerating = false;
    }
  });

  const switchProfileDisposable = vscode.commands.registerCommand("commitGenerator.switchProviderProfile", async () => {
    try {
      const switched = await switchProviderProfile();
      if (switched) {
        updateActiveProfileStatusBar(profileStatusBar);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notifyStatus(`切换 Provider 配置失败：${detail}`, "error");
    }
  });

  const settingsChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("commitGenerator.providerProfiles") || event.affectsConfiguration("commitGenerator.activeProfile")) {
      updateActiveProfileStatusBar(profileStatusBar);
    }
  });

  context.subscriptions.push(generateDisposable, switchProfileDisposable, settingsChangeDisposable, profileStatusBar, output);
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

async function switchProviderProfile(): Promise<boolean> {
  const settings = loadResolvedSettings();
  const candidates = settings.profiles.filter((profile) => profile.enabled);
  if (candidates.length === 0) {
    notifyStatus("当前没有可用的 Provider Profile。", "warn");
    return false;
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((profile) => ({
      label: profile.id,
      description: profile.id === settings.activeProfile ? `${profile.kind} (当前)` : profile.kind,
      detail: `model=${profile.model} | baseUrl=${profile.baseUrl}`,
      profile
    })),
    {
      title: "切换 AI Provider 配置",
      placeHolder: `当前 activeProfile：${settings.activeProfile || "未设置"}`
    }
  );

  if (!picked) {
    return false;
  }

  const config = vscode.workspace.getConfiguration("commitGenerator");
  const target =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

  await config.update("activeProfile", picked.profile.id, target);
  notifyStatus(`已切换 Provider 配置：${picked.profile.id}`);
  output.appendLine(`[config] activeProfile=${picked.profile.id}`);
  return true;
}

function updateActiveProfileStatusBar(statusBar: vscode.StatusBarItem): void {
  const settings = loadResolvedSettings();
  const activeProfile = settings.activeProfile || "未设置";
  const enabledCount = settings.profiles.filter((profile) => profile.enabled).length;

  if (enabledCount === 0) {
    statusBar.text = "$(warning) Commit AI: 无可用配置";
    statusBar.tooltip = "未检测到可用 providerProfiles，点击可尝试从已有配置中选择。";
    return;
  }

  statusBar.text = `$(list-selection) Commit AI: ${activeProfile}`;
  statusBar.tooltip = `当前配置：${activeProfile}\n点击从已有配置中下拉选择。`;
}

async function buildCommitMessage(repoPath: string): Promise<BuildResult> {
  const context = await collectCommitContext(repoPath);
  if (context.files.length === 0) {
    return { message: "", source: "fallback", reason: "no_changes" };
  }

  try {
    const aiResult = await generateWithProviders(context);
    let aiMessage = aiResult.message;
    if (aiMessage) {
      if (!hasCommitBody(aiMessage)) {
        aiMessage = `${aiMessage}\n\n${buildDetailedBody(context.files, context.diff)}`;
      }
      return { message: aiMessage, source: "ai" };
    }

    return {
      message: buildRuleBasedMessage(context.files, context.diff),
      source: "fallback",
      reason: aiResult.reason ?? "ai_empty_or_invalid"
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      message: buildRuleBasedMessage(context.files, context.diff),
      source: "fallback",
      reason: `ai_error: ${detail}`
    };
  }
}

async function collectCommitContext(repoPath: string): Promise<CommitContext> {
  const stagedFiles = await runGit(repoPath, ["diff", "--cached", "--name-only"]);
  const stagedList = toLines(stagedFiles).filter((file) => !isIgnoredCommitFile(file));
  if (stagedList.length === 0) {
    return { files: [], diff: "" };
  }

  const diff = await runGit(repoPath, ["diff", "--cached", "--", ...stagedList]);

  return {
    files: stagedList,
    diff: truncateMultiline(diff, MAX_DIFF_CHARS)
  };
}

function isIgnoredCommitFile(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return IGNORED_COMMIT_FILES.has(name);
}

async function generateWithProviders(context: CommitContext): Promise<{ message: string; reason?: string }> {
  const settings = loadResolvedSettings();
  logSettingsDiagnostics(settings);

  if (settings.executionOrder.length === 0) {
    return {
      message: "",
      reason: "no_enabled_profiles"
    };
  }

  const prompt = createPrompt(context);
  const logger = createStructuredLogger(settings.logLevel, settings.logRedactSensitive);
  const result = await executeProviderChain(
    {
      profiles: settings.executionOrder,
      prompt,
      transformMessage: normalizeMessage
    },
    logger
  );

  if (result.success) {
    output.appendLine(
      `[ai-success] provider=${result.success.provider} profile=${result.success.profileId} endpoint=${result.success.endpoint} latencyMs=${result.success.latencyMs}`
    );
    return { message: result.success.message };
  }

  return {
    message: "",
    reason: summarizeFailures(result.failures) || "all_providers_failed"
  };
}

function loadResolvedSettings(): ResolvedExtensionSettings {
  return resolveExtensionSettings(readRawExtensionSettings(), process.env);
}

function readRawExtensionSettings(): RawExtensionSettings {
  const config = vscode.workspace.getConfiguration("commitGenerator");
  return {
    providerProfiles: config.get<unknown>("providerProfiles"),
    activeProfile: config.get<unknown>("activeProfile"),
    fallbackProfiles: config.get<unknown>("fallbackProfiles"),
    requestTimeoutMs: config.get<unknown>("requestTimeoutMs"),
    maxRetries: config.get<unknown>("maxRetries"),
    logLevel: config.get<unknown>("logLevel"),
    logRedactSensitive: config.get<unknown>("logRedactSensitive"),
    apiKey: config.get<unknown>("apiKey"),
    openaiApiKey: config.get<unknown>("openaiApiKey"),
    apiBaseUrl: config.get<unknown>("apiBaseUrl"),
    apiProtocol: config.get<unknown>("apiProtocol"),
    openaiModel: config.get<unknown>("openaiModel")
  };
}

function logSettingsDiagnostics(settings: ResolvedExtensionSettings): void {
  if (settings.usedLegacyConfig && !hasShownLegacyConfigWarning) {
    hasShownLegacyConfigWarning = true;
    output.appendLine(
      "[warn] 检测到旧配置键，当前已自动兼容映射。建议迁移到 commitGenerator.providerProfiles。"
    );
  }

  for (const warning of settings.warnings) {
    output.appendLine(`[warn] [config] ${warning}`);
  }

  output.appendLine(
    `[config] active=${settings.activeProfile || "none"} order=${settings.executionOrder.map((profile) => profile.id).join(" -> ")}`
  );
  output.appendLine(
    `[config] logLevel=${settings.logLevel} logRedactSensitive=${String(settings.logRedactSensitive)}`
  );
}

function createStructuredLogger(logLevel: LogLevel, redactSensitive: boolean): StructuredLogger {
  return {
    log(entry: StructuredLogEntry): void {
      if (!shouldWriteLog(logLevel, entry.level)) {
        return;
      }
      const payload = entry.meta ? (redactSensitive ? redactMeta(entry.meta) : entry.meta) : undefined;
      const serializedMeta = payload ? ` ${JSON.stringify(payload)}` : "";
      output.appendLine(`[${entry.level}] ${entry.message}${serializedMeta}`);
    }
  };
}

function shouldWriteLog(logLevel: LogLevel, level: StructuredLogEntry["level"]): boolean {
  if (logLevel === "off") {
    return false;
  }
  if (logLevel === "normal" && (level === "debug" || level === "trace")) {
    return false;
  }
  if (logLevel === "debug" && level === "trace") {
    return false;
  }
  return true;
}

function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    result[key] = redactUnknown(value, key);
  }
  return result;
}

function redactUnknown(value: unknown, keyHint: string): unknown {
  if (isSensitiveKey(keyHint)) {
    return "***";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, ""));
  }

  if (isRecord(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = redactUnknown(item, key);
    }
    return redacted;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  return /api[-_]?key|authorization|token|secret|password/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createPrompt(context: CommitContext): string {
  return [
    "你是一名资深工程师，负责生成 git 提交信息。",
    "输出格式必须是：第一行标题 + 空行 + 详细正文。",
    "标题必须符合 Conventional Commits：type(scope): subject 或 type: subject。",
    "描述具体改动，改动按分类以 - 开头。",// 、影响范围和注意事项
    "type 必须是英文小写（feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert）。",
    "subject 必须是简体中文，使用动宾短语，禁止英文句子、禁止句号。",
    "中文风格要求：突出技术改动本身，例如“重构”“调整”“完善”“补充”。",
    "",
    "变更文件：",
    context.files.join("\n"),
    "",
    "代码差异：",
    context.diff
  ].join("\n");
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

function buildRuleBasedMessage(files: string[], patch: string): string {
  const type = inferType(files, patch);
  const scope = inferScope(files);
  const subject = inferSubject(files, patch);
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

function inferSubject(files: string[], patch: string): string {
  const semanticSubject = inferSemanticSubject(files, patch);
  if (semanticSubject) {
    return semanticSubject;
  }

  if (files.length === 1) {
    return formatSubject(path.basename(files[0]), 1, "");
  }

  const dirs = uniq(
    files
      .map((file) => path.dirname(file).replace(/\\/g, "/"))
      .filter((dir) => dir && dir !== ".")
      .map((dir) => dir.split("/")[0])
  );

  if (dirs.length === 1) {
    return formatSubject("", files.length, dirs[0]);
  }

  return formatSubject("", files.length, "");
}

function inferSemanticSubject(files: string[], patch: string): string {
  const text = `${files.join("\n")}\n${patch}`.toLowerCase();
  const uniqueTargets = collectSemanticTargets(text, files).slice(0, 2);
  if (uniqueTargets.length === 0) {
    return "";
  }

  const action = inferAction(text);
  return `${action}${uniqueTargets.join("并")}`;
}

function inferAction(text: string): string {
  if (text.includes("fix") || text.includes("bug") || text.includes("error") || text.includes("异常")) {
    return "修正";
  }
  if (text.includes("add") || text.includes("new file") || text.includes("+++")) {
    return "增加";
  }
  if (text.includes("refactor")) {
    return "重构";
  }

  return "调整";
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

function formatSubject(fileName: string, fileCount: number, dir: string): string {
  if (fileName) {
    return `更新 ${fileName} 实现`;
  }
  if (dir) {
    return `调整 ${dir} 下的 ${fileCount} 个文件`;
  }
  return `更新 ${fileCount} 个文件实现`;
}

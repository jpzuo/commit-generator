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

const MAX_DIFF_CHARS = 12000;

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("commitGenerator.generate", async () => {
    try {
      const git = await getGitApi();
      if (!git || git.repositories.length === 0) {
        vscode.window.showErrorMessage("No Git repository found in current workspace.");
        return;
      }

      const repo = pickRepository(git.repositories);
      const message = await buildCommitMessage(repo.rootUri.fsPath);

      if (!message) {
        vscode.window.showWarningMessage("No changes detected. Nothing to generate.");
        return;
      }

      repo.inputBox.value = message;
      vscode.window.showInformationMessage("Commit message generated.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to generate commit message: ${detail}`);
    }
  });

  context.subscriptions.push(disposable);
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

async function buildCommitMessage(repoPath: string): Promise<string> {
  const style = getChineseStyle();
  const context = await collectCommitContext(repoPath);
  if (context.files.length === 0) {
    return "";
  }

  const aiMessage = await generateWithOpenAI(context, style);
  if (aiMessage) {
    return aiMessage;
  }

  return buildRuleBasedMessage(context.files, context.diff, style);
}

async function collectCommitContext(repoPath: string): Promise<CommitContext> {
  const stagedFiles = await runGit(repoPath, ["diff", "--cached", "--name-only"]);
  const unstagedFiles = await runGit(repoPath, ["diff", "--name-only"]);
  const untrackedFiles = await runGit(repoPath, ["ls-files", "--others", "--exclude-standard"]);

  const stagedList = toLines(stagedFiles);
  const unstagedList = toLines(unstagedFiles);
  const untrackedList = toLines(untrackedFiles);

  const allFiles = uniq([...stagedList, ...unstagedList, ...untrackedList]);
  if (allFiles.length === 0) {
    return { files: [], diff: "" };
  }

  const stagedPatch = stagedList.length > 0 ? await runGit(repoPath, ["diff", "--cached", "--", ...stagedList]) : "";
  const unstagedPatch = unstagedList.length > 0 ? await runGit(repoPath, ["diff", "--", ...unstagedList]) : "";
  const untrackedPreview = await buildUntrackedPreview(repoPath, untrackedList);

  const diff = [stagedPatch, unstagedPatch, untrackedPreview].filter((value) => value.length > 0).join("\n\n");

  return {
    files: allFiles,
    diff: truncateMultiline(diff, MAX_DIFF_CHARS)
  };
}

async function buildUntrackedPreview(repoPath: string, files: string[]): Promise<string> {
  if (files.length === 0) {
    return "";
  }

  const previews = await Promise.all(
    files.slice(0, 5).map(async (file) => {
      try {
        const absolute = path.join(repoPath, file);
        const content = await fs.readFile(absolute, "utf8");
        return `# Untracked: ${file}\n${truncateMultiline(content, 1000)}`;
      } catch {
        return `# Untracked: ${file}`;
      }
    })
  );

  return previews.join("\n\n");
}

async function generateWithOpenAI(context: CommitContext, style: ChineseStyle): Promise<string> {
  const config = vscode.workspace.getConfiguration("commitGenerator");
  const apiKey = String(config.get<string>("openaiApiKey", "")).trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return "";
  }

  const model = String(config.get<string>("openaiModel", "gpt-4.1-mini")).trim() || "gpt-4.1-mini";
  const prompt = createPrompt(context, style);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  return normalizeMessage(extractResponseText(data));
}

function createPrompt(context: CommitContext, style: ChineseStyle): string {
  const styleInstruction = getStyleInstruction(style);
  return [
    "你是一名资深工程师，负责生成 git 提交信息。",
    "只返回一行，必须符合 Conventional Commits：type(scope): subject 或 type: subject。",
    "type 必须是英文小写（feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert）。",
    "subject 必须是简体中文，使用动宾短语，禁止英文句子、禁止句号、禁止多行、禁止 markdown。",
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

function normalizeMessage(value: string): string {
  const firstLine = value
    .replace(/[`"'*]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return "";
  }

  if (!isValidConventionalCommit(firstLine)) {
    return "";
  }

  return truncateInline(firstLine, 72);
}

function buildRuleBasedMessage(files: string[], patch: string, style: ChineseStyle): string {
  const type = inferType(files, patch);
  const scope = inferScope(files);
  const subject = inferSubject(files, style);

  return scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;
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

function inferSubject(files: string[], style: ChineseStyle): string {
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
    return `优化多处功能实现`;
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

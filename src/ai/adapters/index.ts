import { anthropicAdapter } from "./anthropic";
import { azureOpenaiAdapter } from "./azureOpenai";
import { geminiAdapter } from "./gemini";
import { ollamaAdapter } from "./ollama";
import { openaiCompatAdapter } from "./openaiCompat";
import { openaiResponsesAdapter } from "./openaiResponses";
import { ProviderAdapter, ProviderKind } from "../types";

const ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  openaiCompat: openaiCompatAdapter,
  openaiResponses: openaiResponsesAdapter,
  anthropic: anthropicAdapter,
  azureOpenai: azureOpenaiAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter
};

export function getProviderAdapter(kind: ProviderKind): ProviderAdapter {
  return ADAPTERS[kind];
}

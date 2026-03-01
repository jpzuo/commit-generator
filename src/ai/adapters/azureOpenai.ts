import { asArray, asRecord, asString } from "../json";
import { AdapterRequestInput, ProviderAdapter } from "../types";
import { normalizeBaseUrl } from "../url";

function requireApiKey(profileId: string, apiKey: string | undefined): string {
  if (apiKey && apiKey.trim().length > 0) {
    return apiKey.trim();
  }
  throw new Error(`Profile "${profileId}" (azureOpenai) 未配置 API Key。`);
}

function requireDeployment(profileId: string, deployment: string | undefined): string {
  if (deployment && deployment.trim().length > 0) {
    return deployment.trim();
  }
  throw new Error(`Profile "${profileId}" (azureOpenai) 缺少 azureDeployment。`);
}

export const azureOpenaiAdapter: ProviderAdapter = {
  kind: "azureOpenai",
  buildRequest(input: AdapterRequestInput) {
    const { profile, prompt, temperature } = input;
    const apiKey = requireApiKey(profile.id, profile.apiKey);
    const deployment = requireDeployment(profile.id, profile.azureDeployment);
    const baseUrl = normalizeBaseUrl(profile.baseUrl);
    const azureBase = baseUrl.toLowerCase().endsWith("/openai") ? baseUrl : `${baseUrl}/openai`;
    const endpoint = `${azureBase}/deployments/${encodeURIComponent(
      deployment
    )}/chat/completions?api-version=${encodeURIComponent(profile.azureApiVersion)}`;

    return {
      endpoint,
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        ...profile.extraHeaders
      },
      body: {
        messages: [{ role: "user", content: prompt }],
        temperature
      }
    };
  },
  parseResponse(data: unknown): string {
    const root = asRecord(data);
    const choices = asArray(root?.choices);
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice?.message);
    const content = message?.content;

    if (typeof content === "string") {
      return content;
    }

    for (const chunk of asArray(content)) {
      const item = asRecord(chunk);
      const text = asString(item?.text);
      if (text) {
        return text;
      }
    }

    return "";
  }
};

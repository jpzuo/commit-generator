import { asArray, asRecord, asString } from "../json";
import { AdapterRequestInput, ProviderAdapter } from "../types";
import { joinVersionedPath } from "../url";

function requireApiKey(profileId: string, apiKey: string | undefined): string {
  if (apiKey && apiKey.trim().length > 0) {
    return apiKey.trim();
  }
  throw new Error(`Profile "${profileId}" (anthropic) 未配置 API Key。`);
}

export const anthropicAdapter: ProviderAdapter = {
  kind: "anthropic",
  buildRequest(input: AdapterRequestInput) {
    const { profile, prompt, temperature } = input;
    const apiKey = requireApiKey(profile.id, profile.apiKey);
    return {
      endpoint: joinVersionedPath(profile.baseUrl, "v1", "messages"),
      headers: {
        "x-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        ...profile.extraHeaders
      },
      body: {
        model: profile.model,
        max_tokens: 1024,
        temperature,
        messages: [{ role: "user", content: prompt }]
      }
    };
  },
  parseResponse(data: unknown): string {
    const root = asRecord(data);
    for (const item of asArray(root?.content)) {
      const chunk = asRecord(item);
      const text = asString(chunk?.text);
      if (text) {
        return text;
      }
    }
    return "";
  }
};

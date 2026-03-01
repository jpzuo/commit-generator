import { asArray, asRecord, asString } from "../json";
import { AdapterRequestInput, ProviderAdapter } from "../types";
import { joinVersionedPath } from "../url";

function requireApiKey(profileId: string, apiKey: string | undefined, provider: string): string {
  if (apiKey && apiKey.trim().length > 0) {
    return apiKey.trim();
  }
  throw new Error(`Profile "${profileId}" (${provider}) 未配置 API Key。`);
}

export const openaiCompatAdapter: ProviderAdapter = {
  kind: "openaiCompat",
  buildRequest(input: AdapterRequestInput) {
    const { profile, prompt, temperature } = input;
    const apiKey = requireApiKey(profile.id, profile.apiKey, "openaiCompat");
    return {
      endpoint: joinVersionedPath(profile.baseUrl, "v1", "chat/completions"),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...profile.extraHeaders
      },
      body: {
        model: profile.model,
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

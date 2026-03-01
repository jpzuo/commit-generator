import { asArray, asRecord, asString } from "../json";
import { AdapterRequestInput, ProviderAdapter } from "../types";
import { joinVersionedPath } from "../url";

function requireApiKey(profileId: string, apiKey: string | undefined): string {
  if (apiKey && apiKey.trim().length > 0) {
    return apiKey.trim();
  }
  throw new Error(`Profile "${profileId}" (gemini) 未配置 API Key。`);
}

export const geminiAdapter: ProviderAdapter = {
  kind: "gemini",
  buildRequest(input: AdapterRequestInput) {
    const { profile, prompt, temperature } = input;
    const apiKey = requireApiKey(profile.id, profile.apiKey);
    const endpoint = `${joinVersionedPath(
      profile.baseUrl,
      profile.geminiApiVersion,
      `models/${encodeURIComponent(profile.model)}:generateContent`
    )}?key=${encodeURIComponent(apiKey)}`;

    return {
      endpoint,
      headers: {
        "Content-Type": "application/json",
        ...profile.extraHeaders
      },
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature
        }
      }
    };
  },
  parseResponse(data: unknown): string {
    const root = asRecord(data);
    const candidates = asArray(root?.candidates);
    const firstCandidate = asRecord(candidates[0]);
    const content = asRecord(firstCandidate?.content);
    const parts = asArray(content?.parts);

    const lines: string[] = [];
    for (const part of parts) {
      const item = asRecord(part);
      const text = asString(item?.text);
      if (text) {
        lines.push(text);
      }
    }

    return lines.join("\n").trim();
  }
};

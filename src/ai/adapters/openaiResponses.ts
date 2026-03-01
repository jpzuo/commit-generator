import { asArray, asRecord, asString } from "../json";
import { AdapterRequestInput, ProviderAdapter } from "../types";
import { joinVersionedPath } from "../url";

function requireApiKey(profileId: string, apiKey: string | undefined): string {
  if (apiKey && apiKey.trim().length > 0) {
    return apiKey.trim();
  }
  throw new Error(`Profile "${profileId}" (openaiResponses) 未配置 API Key。`);
}

export const openaiResponsesAdapter: ProviderAdapter = {
  kind: "openaiResponses",
  buildRequest(input: AdapterRequestInput) {
    const { profile, prompt, temperature } = input;
    const apiKey = requireApiKey(profile.id, profile.apiKey);
    return {
      endpoint: joinVersionedPath(profile.baseUrl, "v1", "responses"),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...profile.extraHeaders
      },
      body: {
        model: profile.model,
        input: prompt,
        temperature
      }
    };
  },
  parseResponse(data: unknown): string {
    const root = asRecord(data);
    const outputText = asString(root?.output_text);
    if (outputText) {
      return outputText;
    }

    for (const item of asArray(root?.output)) {
      const outputItem = asRecord(item);
      for (const contentChunk of asArray(outputItem?.content)) {
        const chunk = asRecord(contentChunk);
        const text = asString(chunk?.text);
        if (text) {
          return text;
        }
      }
    }

    return "";
  }
};

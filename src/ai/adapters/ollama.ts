import { asRecord, asString } from "../json";
import { AdapterRequestInput, ProviderAdapter } from "../types";
import { joinUrl } from "../url";

export const ollamaAdapter: ProviderAdapter = {
  kind: "ollama",
  buildRequest(input: AdapterRequestInput) {
    const { profile, prompt, temperature } = input;
    return {
      endpoint: joinUrl(profile.baseUrl, "/api/chat"),
      headers: {
        "Content-Type": "application/json",
        ...profile.extraHeaders
      },
      body: {
        model: profile.model,
        stream: false,
        options: { temperature },
        messages: [{ role: "user", content: prompt }]
      }
    };
  },
  parseResponse(data: unknown): string {
    const root = asRecord(data);
    const message = asRecord(root?.message);
    return asString(message?.content);
  }
};

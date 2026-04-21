export const googleProvider = {
  id: "google",
  labelKey: "providers.google.label",
  source: "api",
  binary: "node",
  defaultModel: "gemini-2.5-pro",

  getAuthRequirements(resolvedConfig) {
    return resolvedConfig.auth.google;
  },

  async fetchModels(resolvedConfig = null) {
    const envKey = resolvedConfig?.auth?.google?.env_key ?? "GEMINI_API_KEY";
    const i18n = resolvedConfig?.i18n ?? null;
    const apiKey = process.env[envKey];
    if (!apiKey) {
      const message = i18n
        ? i18n.t("providers.google.missingEnv", { envKey })
        : `Environment variable ${envKey} is not set`;
      throw new Error(message);
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    }

    const { models } = await res.json();

    return models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => {
        const id = m.name.replace("models/", "");
        return { value: id, label: id };
      });
  },

  async exec(resolvedConfig, prompt, runtimeOverrides = {}, signal = null, options = {}) {
    const model = runtimeOverrides.model ?? resolvedConfig.activeModel;
    const envKey = resolvedConfig.auth.google.env_key;
    const apiKey = process.env[envKey];
    if (!apiKey) {
      throw new Error(
        resolvedConfig.i18n.t("providers.google.missingEnv", { envKey }),
      );
    }

    const stream = typeof options.onToken === "function";
    const method = stream ? "streamGenerateContent" : "generateContent";
    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`,
    );
    url.searchParams.set("key", apiKey);
    if (stream) url.searchParams.set("alt", "sse");

    const parts = [];
    if (resolvedConfig.promptStack?.text) {
      parts.push({ text: resolvedConfig.promptStack.text });
    }
    parts.push({ text: prompt });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `Google Gemini: HTTP ${res.status}`);
    }

    if (!stream) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? "";
      return { text, usage: data.usageMetadata ?? null };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage = null;

    function readEvent(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;

      const payload = trimmed.slice("data:".length).trim();
      if (!payload) return;

      const event = JSON.parse(payload);
      const token = event.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? "";
      if (token) {
        text += token;
        options.onToken(token);
      }
      usage = event.usageMetadata ?? usage;
    }

    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          readEvent(line);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        readEvent(buffer);
      }
    } catch (err) {
      if (err.name === "AbortError") throw new Error("cancelled");
      throw err;
    }

    return { text, usage };
  },
};

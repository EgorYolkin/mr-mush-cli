const decoder = new TextDecoder();

function buildMessages(promptStack, prompt) {
  const messages = [];
  if (promptStack?.text) {
    messages.push({ role: "system", content: promptStack.text });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

function parseStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;

  const data = trimmed.slice("data:".length).trim();
  if (!data || data === "[DONE]") return null;

  return JSON.parse(data);
}

export async function openAiCompatibleChat({
  baseUrl,
  providerName,
  model,
  prompt,
  promptStack = null,
  signal = null,
  onToken = null,
}) {
  const stream = typeof onToken === "function";
  const abortCtrl = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => abortCtrl.abort(), { once: true });
  }

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: buildMessages(promptStack, prompt),
      stream,
    }),
    signal: abortCtrl.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${providerName}: ${res.status} ${body}`);
  }

  if (!stream) {
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage ?? null,
    };
  }

  let text = "";
  let usage = null;
  let buffer = "";

  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (!event) continue;

        const token = event.choices?.[0]?.delta?.content ?? "";
        if (token) {
          text += token;
          onToken(token);
        }
        usage = event.usage ?? usage;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseStreamLine(buffer);
      const token = event?.choices?.[0]?.delta?.content ?? "";
      if (token) {
        text += token;
        onToken(token);
      }
      usage = event?.usage ?? usage;
    }
  } catch (err) {
    if (err.name === "AbortError") throw new Error("cancelled");
    throw err;
  }

  return { text, usage };
}

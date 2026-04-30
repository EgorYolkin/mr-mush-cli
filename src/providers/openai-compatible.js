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

/**
 * Accumulate streaming tool_calls deltas into a complete array.
 * OpenAI sends arguments as incremental string chunks across multiple deltas.
 *
 * @param {object[]} accumulated - Current state (mutated in place)
 * @param {object[]} deltas - tool_calls array from a delta chunk
 */
function accumulateToolCallDeltas(accumulated, deltas) {
  for (const delta of deltas) {
    const idx = delta.index ?? 0;
    if (!accumulated[idx]) {
      accumulated[idx] = {
        id: delta.id ?? "",
        type: delta.type ?? "function",
        function: { name: "", arguments: "" },
      };
    }
    const entry = accumulated[idx];
    if (delta.id) entry.id = delta.id;
    if (delta.type) entry.type = delta.type;
    if (delta.function?.name) entry.function.name += delta.function.name;
    if (delta.function?.arguments) entry.function.arguments += delta.function.arguments;
  }
}

/**
 * @typedef {{ name: string, description: string, parameters: object }} ToolDefinition
 */

export async function openAiCompatibleChat({
  baseUrl,
  providerName,
  apiKey = null,
  headers = {},
  model,
  prompt,
  promptStack = null,
  messages = null,
  signal = null,
  onToken = null,
  tools = null,
  requestBodyExtras = null,
}) {
  const stream = typeof onToken === "function";
  const abortCtrl = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => abortCtrl.abort(), { once: true });
  }

  const body = {
    model,
    messages: messages ?? buildMessages(promptStack, prompt),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    ...(requestBodyExtras ?? {}),
  };

  const MAX_RETRIES = 2;
  const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

  let res;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      });
    } catch (fetchError) {
      // Retry on network errors (ECONNRESET, ETIMEDOUT, etc.)
      if (attempt < MAX_RETRIES && fetchError.name !== "AbortError") {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw fetchError;
    }

    if (res.ok) break;

    if (attempt < MAX_RETRIES && RETRYABLE_STATUSES.has(res.status)) {
      const retryAfter = res.headers.get("retry-after");
      const delayMs = retryAfter
        ? Math.min(Number(retryAfter) * 1000, 10_000)
        : 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    const bodyText = await res.text();
    throw new Error(`${providerName}: ${res.status} ${bodyText}`);
  }

  if (!stream) {
    const data = await res.json();
    const message = data.choices?.[0]?.message ?? {};
    const assistantMessage = {
      role: message.role ?? "assistant",
      content: message.content ?? "",
      ...(message.reasoning_content
        ? { reasoning_content: message.reasoning_content }
        : {}),
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
    return {
      text: message.content ?? "",
      usage: data.usage ?? null,
      toolCalls: message.tool_calls ?? [],
      assistantMessage,
    };
  }

  let text = "";
  let reasoningContent = "";
  let usage = null;
  let buffer = "";
  const accumulatedToolCalls = [];

  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (!event) continue;

        const delta = event.choices?.[0]?.delta ?? {};
        const token = delta.content ?? "";
        if (token) {
          text += token;
          onToken(token);
        }
        if (delta.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }
        if (delta.tool_calls?.length) {
          accumulateToolCallDeltas(accumulatedToolCalls, delta.tool_calls);
        }
        usage = event.usage ?? usage;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseStreamLine(buffer);
      const delta = event?.choices?.[0]?.delta ?? {};
      const token = delta.content ?? "";
      if (token) {
        text += token;
        onToken(token);
      }
      if (delta.reasoning_content) {
        reasoningContent += delta.reasoning_content;
      }
      if (delta.tool_calls?.length) {
        accumulateToolCallDeltas(accumulatedToolCalls, delta.tool_calls);
      }
      usage = event?.usage ?? usage;
    }
  } catch (err) {
    if (err.name === "AbortError") throw new Error("cancelled");
    throw err;
  }

  const assistantMessage = {
    role: "assistant",
    content: text,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(accumulatedToolCalls.length ? { tool_calls: accumulatedToolCalls } : {}),
  };

  return {
    text,
    usage,
    toolCalls: accumulatedToolCalls,
    assistantMessage,
  };
}

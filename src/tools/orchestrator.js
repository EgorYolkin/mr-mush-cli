import { approveCommand, isCommandApproved } from "./approvals.js";
import { requestBashApproval, requestWriteApproval } from "./approval-ui.js";
import { runBashCommand } from "./bash.js";
import { evaluateWritePolicy, readExistingFile, writeFile } from "./file-write.js";
import { formatToolResultForModel, parseToolCall } from "./parser.js";
import { evaluateBashPolicy } from "./policy.js";
import { runWithNativeTools } from "./native-loop.js";

function toolErrorResult(call, message) {
  if (call?.name === "write_file") {
    return {
      tool: "write_file",
      path: call.args.path,
      written: 0,
      error: message,
      blocked: true,
    };
  }

  return {
    tool: "bash",
    cmd: call?.args?.cmd ?? "",
    exit_code: null,
    stdout: "",
    stderr: message,
    truncated: false,
    blocked: true,
  };
}

function buildFollowupPrompt({ originalPrompt, assistantText, toolResult }) {
  return [
    "Original user request:",
    originalPrompt,
    "",
    "Assistant requested this tool call:",
    assistantText,
    "",
    formatToolResultForModel(toolResult),
    "",
    "Use the tool result to answer the original user request. Do not repeat the agents-tool block unless another tool call is strictly necessary.",
  ].join("\n");
}

function markerSuffixLength(value, marker) {
  const maxLength = Math.min(value.length, marker.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (marker.startsWith(value.slice(-length))) return length;
  }
  return 0;
}

/**
 * Execute a single tool call through policy checks, approval, and execution.
 * Shared between markdown and native tool calling loops.
 *
 * @param {{ name: string, args: object }} call
 * @param {{ bash?: object, files?: object }} toolConfig
 * @param {{ cwd: string }} context
 * @param {{ beforeApproval?: Function|null, afterApproval?: Function|null }} callbacks
 * @returns {Promise<object>} Tool result
 */
export async function executeToolCall(call, toolConfig, context, callbacks = {}) {
  const bashToolConfig = toolConfig?.bash ?? {};
  const fileToolConfig = toolConfig?.files ?? {};
  const { beforeApproval = null, afterApproval = null } = callbacks;

  if (call.name === "bash") {
    if (!bashToolConfig.enabled) {
      return toolErrorResult(call, "bash tool is disabled");
    }
    const cmd = call.args.cmd;
    const policy = evaluateBashPolicy(cmd, bashToolConfig);
    if (!policy.ok) {
      return toolErrorResult(call, policy.error);
    }
    const approved = await isCommandApproved(context.cwd, cmd);
    if (!approved && beforeApproval) beforeApproval();
    const approval = approved ? "always" : await requestBashApproval(cmd);
    if (!approved && afterApproval) afterApproval();
    if (approval === "always" && !approved) {
      await approveCommand(context.cwd, cmd);
    }
    if (approval === "reject") {
      return toolErrorResult(call, "User rejected tool execution");
    }
    return runBashCommand({
      argv: policy.argv,
      cmd,
      cwd: context.cwd,
      timeoutMs: bashToolConfig.timeout_ms ?? 30_000,
      maxOutputChars: bashToolConfig.max_output_chars ?? 20_000,
    });
  }

  if (call.name === "write_file") {
    if (!fileToolConfig.write_enabled) {
      return toolErrorResult(call, "write_file tool is disabled");
    }
    const policy = evaluateWritePolicy(call.args.path, context.cwd, {
      ...fileToolConfig,
      content: call.args.content,
    });
    if (!policy.ok) {
      return toolErrorResult(call, policy.error);
    }
    const existingContent = await readExistingFile(policy.resolved);
    if (beforeApproval) beforeApproval();
    const approval = await requestWriteApproval({ ...call.args, existingContent });
    if (afterApproval) afterApproval();
    if (approval === "reject") {
      return toolErrorResult(call, "User rejected write");
    }
    return writeFile({ ...call.args, cwd: context.cwd });
  }

  return toolErrorResult(call, `Unsupported tool: ${call.name}`);
}

/**
 * Determine whether the provider supports native tool calling for the given config.
 *
 * @param {object} provider
 * @param {object} config
 * @returns {Promise<boolean>}
 */
async function resolveToolCallCapability(provider, config, runtimeOverrides = {}) {
  if (config.tools?.force_markdown) return false;

  const capability = provider.capabilities?.toolCalling;
  if (capability === true) return true;
  if (capability === false || capability == null) return false;

  // 'dynamic' — ask the provider (e.g. Ollama model detection)
  if (typeof provider.supportsToolCalling === "function") {
    const model =
      runtimeOverrides.model ?? config.activeModel ?? config.active_model;
    return provider.supportsToolCalling(model).catch(() => false);
  }

  return false;
}

/**
 * Markdown-based tool calling loop (original implementation).
 */
async function runWithMarkdownTools({
  provider,
  config,
  prompt,
  messages = null,
  runtimeOverrides,
  signal,
  context,
  onToken,
  beforeApproval = null,
  afterApproval = null,
  beforeToolCall = null,
  onAssistantToolIntent = null,
  onToolResult = null,
}) {
  const bashToolConfig = config.tools?.bash ?? {};
  const maxCalls = bashToolConfig.max_calls ?? 8;
  let currentPrompt = prompt;
  let lastResponse = null;

  for (let callIndex = 0; callIndex <= maxCalls; callIndex += 1) {
    let tokenBuffer = "";
    let suppressStreaming = false;
    const marker = "```agents-tool";
    const tokenHandler = callIndex === 0 && onToken
      ? (token) => {
          if (suppressStreaming) return;
          tokenBuffer += token;
          const markerIndex = tokenBuffer.indexOf(marker);
          if (markerIndex >= 0) {
            const visibleText = tokenBuffer.slice(0, markerIndex);
            if (visibleText) onToken(visibleText);
            suppressStreaming = true;
            tokenBuffer = "";
            return;
          }
          const holdLength = markerSuffixLength(tokenBuffer, marker);
          const visibleText = tokenBuffer.slice(0, tokenBuffer.length - holdLength);
          if (visibleText) onToken(visibleText);
          tokenBuffer = tokenBuffer.slice(tokenBuffer.length - holdLength);
        }
      : null;

    const response = await provider.exec(
      { ...config, i18n: context.i18n },
      currentPrompt,
      runtimeOverrides,
      signal,
      callIndex === 0 ? { onToken: tokenHandler, messages } : {},
    );
    lastResponse = response;

    const parsed = parseToolCall(response.text ?? "");
    if (!parsed) {
      if (tokenBuffer && onToken) onToken(tokenBuffer);
      return response;
    }
    tokenBuffer = "";
    if (beforeToolCall) beforeToolCall();
    if (parsed.ok && onAssistantToolIntent) {
      await onAssistantToolIntent({
        assistantText: parsed.before ?? "",
        toolCall: parsed.call,
      });
    }

    let toolResult;
    if (!parsed.ok) {
      toolResult = toolErrorResult(null, parsed.error);
    } else if (callIndex >= maxCalls) {
      toolResult = toolErrorResult(parsed.call, `tool call limit exceeded (${maxCalls})`);
    } else {
      toolResult = await executeToolCall(parsed.call, config.tools, context, {
        beforeApproval,
        afterApproval,
      });
    }

    currentPrompt = buildFollowupPrompt({
      originalPrompt: prompt,
      assistantText: response.text ?? "",
      toolResult,
    });
    if (onToolResult && parsed.ok) {
      await onToolResult({
        assistantText: parsed.before ?? "",
        toolCall: parsed.call,
        toolResult,
      });
    }
  }

  return lastResponse ?? { text: "", usage: null };
}

/**
 * Run a provider with tool calling support.
 * Automatically selects native or markdown strategy based on provider capabilities.
 *
 * @param {object} params
 * @param {object} params.provider
 * @param {object} params.config
 * @param {string} params.prompt
 * @param {object[]|null} params.messages
 * @param {object} params.runtimeOverrides
 * @param {AbortSignal|null} params.signal
 * @param {object} params.context
 * @param {Function|null} params.onToken
 * @param {Function|null} params.beforeApproval
 * @param {Function|null} params.afterApproval
 * @param {Function|null} params.beforeToolCall
 * @param {Function|null} params.onAssistantToolIntent
 * @param {Function|null} params.onToolResult
 * @returns {Promise<{ text: string, usage: object|null }>}
 */
export async function runProviderWithTools({
  provider,
  config,
  prompt,
  messages = null,
  runtimeOverrides,
  signal,
  context,
  onToken,
  beforeApproval = null,
  afterApproval = null,
  beforeToolCall = null,
  onAssistantToolIntent = null,
  onToolResult = null,
}) {
  const useNative = await resolveToolCallCapability(
    provider,
    config,
    runtimeOverrides,
  );

  if (context) context.toolMode = useNative ? "native" : "markdown";

  if (process.env.MRMUSH_DEBUG) {
    process.stderr.write(`[tool-strategy] ${useNative ? "native" : "markdown"} (provider: ${provider.id})\n`);
  }

  if (useNative) {
    return runWithNativeTools({
      provider,
      config,
      prompt,
      messages,
      runtimeOverrides,
      signal,
      context,
      onToken,
      beforeApproval,
      afterApproval,
      beforeToolCall,
      onAssistantToolIntent,
      onToolResult,
      executeToolCall,
    });
  }

  return runWithMarkdownTools({
    provider,
    config,
    prompt,
    messages,
    runtimeOverrides,
    signal,
    context,
    onToken,
    beforeApproval,
    afterApproval,
    beforeToolCall,
    onAssistantToolIntent,
    onToolResult,
  });
}

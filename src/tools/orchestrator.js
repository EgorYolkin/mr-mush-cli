import { approveCommand, isCommandApproved } from "./approvals.js";
import { requestBashApproval } from "./approval-ui.js";
import { runBashCommand } from "./bash.js";
import { formatToolResultForModel, parseToolCall } from "./parser.js";
import { evaluateBashPolicy } from "./policy.js";

function toolErrorResult(cmd, message) {
  return {
    tool: "bash",
    cmd,
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

export async function runProviderWithTools({
  provider,
  config,
  prompt,
  runtimeOverrides,
  signal,
  context,
  onToken,
  beforeApproval = null,
  afterApproval = null,
  beforeToolCall = null,
}) {
  const toolConfig = config.tools?.bash ?? {};
  const maxCalls = toolConfig.max_calls ?? 3;
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
          const trimmed = tokenBuffer.trimStart();
          if (marker.startsWith(trimmed) && trimmed.length < marker.length) return;
          if (trimmed.startsWith(marker)) {
            suppressStreaming = true;
            tokenBuffer = "";
            return;
          }
          onToken(tokenBuffer);
          tokenBuffer = "";
        }
      : null;

    const response = await provider.exec(
      { ...config, i18n: context.i18n },
      currentPrompt,
      runtimeOverrides,
      signal,
      callIndex === 0 ? { onToken: tokenHandler } : {},
    );
    lastResponse = response;

    const parsed = parseToolCall(response.text ?? "");
    if (!parsed) {
      if (tokenBuffer && onToken) onToken(tokenBuffer);
      return response;
    }
    if (beforeToolCall) beforeToolCall();

    let toolResult;
    if (!parsed.ok) {
      toolResult = toolErrorResult("", parsed.error);
    } else if (!toolConfig.enabled) {
      toolResult = toolErrorResult(parsed.call.args.cmd, "bash tool is disabled");
    } else if (callIndex >= maxCalls) {
      toolResult = toolErrorResult(parsed.call.args.cmd, `tool call limit exceeded (${maxCalls})`);
    } else {
      const cmd = parsed.call.args.cmd;
      const policy = evaluateBashPolicy(cmd);
      if (!policy.ok) {
        toolResult = toolErrorResult(cmd, policy.error);
      } else {
        const approved = await isCommandApproved(context.cwd, cmd);
        if (!approved && beforeApproval) beforeApproval();
        let approval = approved ? "always" : await requestBashApproval(cmd);
        if (!approved && afterApproval) afterApproval();
        if (approval === "always" && !approved) {
          await approveCommand(context.cwd, cmd);
        }
        if (approval === "reject") {
          toolResult = toolErrorResult(cmd, "User rejected tool execution");
        } else {
          toolResult = await runBashCommand({
            argv: policy.argv,
            cmd,
            cwd: context.cwd,
            timeoutMs: toolConfig.timeout_ms ?? 30_000,
            maxOutputChars: toolConfig.max_output_chars ?? 20_000,
          });
        }
      }
    }

    currentPrompt = buildFollowupPrompt({
      originalPrompt: prompt,
      assistantText: response.text ?? "",
      toolResult,
    });
  }

  return lastResponse ?? { text: "", usage: null };
}

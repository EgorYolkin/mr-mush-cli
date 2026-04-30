const DOMAIN_KEYWORDS = Object.freeze({
  devops: ["deploy", "ci", "docker", "k8s", "infra"],
  backend: ["api", "server", "database", "migration", "auth"],
  frontend: ["ui", "component", "css", "build", "react"],
  analysis: ["explain", "review", "summarize", "debug"],
  general: ["*"],
});

export const DOMAINS = Object.freeze(DOMAIN_KEYWORDS);

const TRIVIAL_GENERAL_PATTERNS = [
  /^(hi|hello|hey|yo|sup|hola)$/i,
  /^(thanks|thank you|thx)$/i,
  /^(ok|okay)$/i,
  /^(bye|goodbye)$/i,
];

const REPO_MAP_PATTERNS = [
  /repo\s*map/i,
  /repository\s+map/i,
  /repo\s+structure/i,
  /repository\s+structure/i,
  /what\s+is\s+this\s+project/i,
  /what\s+project\s+is\s+this/i,
  /describe\s+this\s+project/i,
];

function normalizePrompt(prompt) {
  return String(prompt ?? "").trim();
}

function scoreDomain(prompt, keywords) {
  if (keywords.includes("*")) return 0.05;

  const lowerPrompt = prompt.toLowerCase();
  return keywords.reduce((score, keyword) => {
    if (!lowerPrompt.includes(keyword)) return score;
    return score + 1;
  }, 0);
}

function inferAction(prompt, domain) {
  const lowerPrompt = prompt.toLowerCase();
  const actionMatchers = [
    ["review", ["review", "audit", "inspect"]],
    ["debug", ["debug", "fix", "repair", "investigate"]],
    ["explain", ["explain", "summarize", "analyze"]],
    ["build", ["build", "create", "implement"]],
    ["deploy", ["deploy", "release", "ship"]],
    ["configure", ["configure", "setup", "install", "wire"]],
  ];

  const matched = actionMatchers.find(([, keywords]) => keywords.some((keyword) => lowerPrompt.includes(keyword)));
  if (matched) return matched[0];

  switch (domain) {
    case "devops":
      return "configure";
    case "backend":
    case "frontend":
      return "build";
    case "analysis":
      return "analyze";
    default:
      return "respond";
  }
}

export function classifyPrompt(prompt) {
  const normalizedPrompt = normalizePrompt(prompt);
  if (isTrivialGeneralPrompt(normalizedPrompt)) {
    return {
      domain: "general",
      action: "respond",
      confidence: 0.99,
      source: "heuristic",
    };
  }
  if (isRepoMapPrompt(normalizedPrompt)) {
    return {
      domain: "analysis",
      action: "explain",
      confidence: 0.97,
      source: "heuristic",
    };
  }
  const scores = Object.entries(DOMAINS)
    .map(([domain, keywords]) => ({
      domain,
      score: scoreDomain(normalizedPrompt, keywords),
    }))
    .sort((left, right) => right.score - left.score);

  const winner = scores[0] ?? { domain: "general", score: 0 };
  const runnerUp = scores[1] ?? { score: 0 };
  const bestScore = winner.score;

  if (bestScore <= 0.05) {
    return {
      domain: "general",
      action: "respond",
      confidence: 0.35,
      source: "taxonomy",
    };
  }

  const margin = Math.max(0, bestScore - runnerUp.score);
  const confidence = Math.min(0.99, 0.55 + margin * 0.15 + bestScore * 0.08);

  return {
    domain: winner.domain,
    action: inferAction(normalizedPrompt, winner.domain),
    confidence: Number(confidence.toFixed(2)),
    source: "taxonomy",
  };
}

function isTrivialGeneralPrompt(prompt) {
  if (!prompt) return true;
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (TRIVIAL_GENERAL_PATTERNS.some((pattern) => pattern.test(compact))) {
    return true;
  }

  const wordCount = compact.split(" ").filter(Boolean).length;
  return compact.length <= 16 && wordCount <= 3 && !/[!?.,:;]/.test(compact);
}

function isRepoMapPrompt(prompt) {
  return REPO_MAP_PATTERNS.some((pattern) => pattern.test(prompt));
}

function extractJsonObject(text) {
  const normalized = String(text ?? "").trim();
  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ?? normalized;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return candidate.slice(firstBrace, lastBrace + 1);
}

function normalizeSelection(rawSelection, fallback) {
  const domain = Object.hasOwn(DOMAINS, rawSelection?.domain)
    ? rawSelection.domain
    : fallback.domain;
  const action = typeof rawSelection?.action === "string" && rawSelection.action.trim()
    ? rawSelection.action.trim()
    : fallback.action;
  const confidence = Number.isFinite(rawSelection?.confidence)
    ? Math.max(0, Math.min(1, rawSelection.confidence))
    : fallback.confidence;

  return {
    domain,
    action,
    confidence: Number(confidence.toFixed(2)),
    source: "llm",
  };
}

function buildRoutingPrompt(prompt) {
  return [
    "Classify the user request for task routing.",
    "Return strict JSON only with keys: domain, action, confidence.",
    `Allowed domains: ${Object.keys(DOMAINS).join(", ")}.`,
    "confidence must be a number between 0 and 1.",
    "",
    "User request:",
    prompt,
  ].join("\n");
}

function emitDebug(hooks, message) {
  if (typeof hooks?.onDebugEvent === "function") {
    hooks.onDebugEvent(message);
  }
}

function buildScoreSummary(prompt) {
  return Object.entries(DOMAINS)
    .map(([domain, keywords]) => ({
      domain,
      score: scoreDomain(normalizePrompt(prompt), keywords),
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ domain, score }) => `${domain}:${score}`)
    .join(" ");
}

function previewPrompt(prompt, maxLength = 96) {
  const normalized = normalizePrompt(prompt).replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export async function selectAction(prompt, provider, config, hooks = null) {
  const heuristic = classifyPrompt(prompt);
  emitDebug(
    hooks,
    `router: prompt="${previewPrompt(prompt)}" heuristic domain=${heuristic.domain} action=${heuristic.action} confidence=${heuristic.confidence} scores=${buildScoreSummary(prompt)}`,
  );
  if (!provider || heuristic.confidence >= 0.85) {
    emitDebug(
      hooks,
      `router: using heuristic result source=${heuristic.source} domain=${heuristic.domain} action=${heuristic.action} confidence=${heuristic.confidence}`,
    );
    return heuristic;
  }

  const routerModel = config.orchestrator?.router_model ?? config.activeModel;
  const routingPrompt = buildRoutingPrompt(prompt);
  const routingConfig = {
    ...config,
    activeProvider: provider.id,
    activeModel: routerModel,
    promptStack: {
      layers: [],
      text: "",
    },
  };
  emitDebug(
    hooks,
    `router: escalating to provider=${provider.id} model=${routerModel} because heuristic confidence=${heuristic.confidence} < 0.85`,
  );

  try {
    const response = await provider.exec(
      routingConfig,
      routingPrompt,
      {
        model: routerModel,
        thinkingLevel: "minimal",
      },
      null,
      {
        messages: [
          {
            role: "user",
            content: routingPrompt,
          },
        ],
      },
    );
    emitDebug(
      hooks,
      `router: raw response ${String(response.text ?? "").replace(/\s+/g, " ").slice(0, 240) || "<empty>"}`,
    );
    const json = extractJsonObject(response.text);
    if (!json) {
      emitDebug(hooks, "router: no JSON found in router response, falling back to heuristic");
      return heuristic;
    }

    const parsed = JSON.parse(json);
    const selection = normalizeSelection(parsed, heuristic);
    emitDebug(
      hooks,
      `router: selected source=${selection.source} domain=${selection.domain} action=${selection.action} confidence=${selection.confidence}`,
    );
    return selection;
  } catch {
    emitDebug(hooks, "router: provider routing failed, falling back to heuristic");
    return heuristic;
  }
}

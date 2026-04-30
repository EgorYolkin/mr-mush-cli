```text
      ▄▄███▄▄
    ▄███▀█▀███▄
    ▀█████████▀
       █████
        █ █
      ▀▀▀▀▀▀▀
```

# mush

Minimal local AI CLI focused on terminal UI, streaming, tool calling, and context engineering.

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-111111?style=flat-square)
![runtime](https://img.shields.io/badge/runtime-Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![ui](https://img.shields.io/badge/interface-terminal-a855f7?style=flat-square)
![streaming](https://img.shields.io/badge/streaming-enabled-7c3aed?style=flat-square)
![tools](https://img.shields.io/badge/tools-bash%20approval-6d28d9?style=flat-square)
![providers](https://img.shields.io/badge/providers-openai%20%7C%20anthropic%20%7C%20ollama-1f2937?style=flat-square)
![status](https://img.shields.io/badge/status-active-10b981?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-2563eb?style=flat-square)

![preview](resources/preview.gif)

## Overview

`mush` runs local and remote models in a single interface:

- Chat UI directly in the terminal
- Streaming responses
- Project prompts via `MRMUSH.md` and `AGENTS.md`
- Bash tool calls with approval
- Session history and project-scoped approvals
- Custom themes, status bar, and message markers

## Run

```bash
npm install
node bin/mr-mush.js
```

For a global command:

```bash
npm link
mr-mush
```

For Harbor / Terminal-Bench 2.0:

```bash
mr-mush-harbor --instruction "inspect the repo and fix the failing test" --provider ollama --model qwen2.5-coder:7b
```

## Config

Global config:

```text
~/.mrmush/config.toml
```

Project files:

```text
.mrmush/config.toml
MRMUSH.md
AGENTS.md
```

Environment variables:

```text
MRMUSH_PROVIDER
MRMUSH_MODEL
MRMUSH_PROFILE
MRMUSH_THINKING
MRMUSH_LOCALE
```

## Features

- OpenAI, Anthropic, Gemini, Ollama, and LM Studio
- Streaming output outside CLI mode
- Project-level prompt stack: `MRMUSH.md`, `AGENTS.md`, and project prompt files
- Conversation history and session restore
- Approval flow for bash tool calls
- Project-scoped approvals in `.mrmush/`
- Theme, message marker, and status bar customization
- Multiline input with history and text navigation

## Commands

### Model and mode

```text
/think off|minimal|low|medium|high|xhigh
/provider use ...
/model use ...
/profile use ...
```

### Interface

```text
/dot <symbol>
/statusbar <prompt>
/card
```

### Prompts and config

```text
/prompt show [system|profile|provider|project]
/prompt edit [system|profile|provider|project]
/prompt reset [system|profile|provider|project]
/config show
/config set <path> <value>
/config save
```

### History

```text
/resume
```

## Input and navigation

```text
Enter              send message
Shift+Enter        insert newline
← / →              move by character
Opt+← / Opt+→      move by word
Ctrl+← / Ctrl+→    move by word on Windows/Linux
Cmd+← / Cmd+→      start / end of line
Home / End         start / end of line on Windows/Linux
↑ / ↓              move by line, and history at boundaries
```

## Tool calling

`mush` can run bash commands on behalf of the model through the approval flow. The allowlist is configured in TOML:

```toml
[tools.bash]
allowed_commands = ["pwd", "ls", "rg", "cat", "tree"]
allowed_git_subcommands = ["status", "diff", "log", "show"]
```

If the model requests a command outside the allowlist, the policy layer blocks it before execution.

## Development

Quick checks:

```bash
node --check src/ui/scenes/chat.js
node --check src/ui/input.js
```

### Harbor adapter

The repository includes a Harbor adapter for Terminal-Bench 2.0:

```text
integrations/harbor/mr_mush_agent.py
```

Example local run with Docker and local Ollama:

```bash
harbor run \
  --dataset terminal-bench@2.0 \
  --agent-import-path integrations.harbor.mr_mush_agent:MrMushHarborAgent \
  --model ollama/qwen2.5-coder:7b \
  --agent-kwarg source_path=/absolute/path/to/agents-engine-cli \
  --agent-kwarg ollama_base_url=http://host.docker.internal:11434 \
  --n-concurrent 1
```

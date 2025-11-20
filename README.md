# Dynamic Context Pruning Plugin

[![npm version](https://img.shields.io/npm/v/@tarquinen/opencode-dcp.svg)](https://www.npmjs.com/package/@tarquinen/opencode-dcp)

OpenCode plugin that optimizes token usage by analyzing conversation history and pruning obsolete tool outputs from requests.

## Features

- **Zero Configuration**: Uses the free `opencode/big-pickle` model - no API keys required
- **Automatic Optimization**: Runs in the background when sessions become idle
- **Smart Analysis**: Uses AI to identify truly obsolete context
- **Debug Logging**: Optional file-based logging for troubleshooting

## How It Works

1. When a session becomes idle, the Janitor analyzes the conversation using shadow inference
2. It identifies tool call outputs that are no longer relevant to the conversation
3. These IDs are stored in memory for that session
4. On subsequent requests, a custom fetch function filters out the obsolete tool responses
5. Result: Fewer tokens sent to the LLM, lower costs, faster responses

## Installation

### Via NPM (Recommended)

Add the plugin to your OpenCode configuration:

**Global:** `~/.config/opencode/opencode.json`  
**Project:** `.opencode/opencode.json`

```json
{
  "plugin": [
    "@tarquinen/opencode-dcp"
  ]
}
```

Then restart OpenCode. The plugin will automatically:
- Analyze conversations when sessions become idle
- Identify obsolete tool outputs
- Prune them from future requests
- Save you tokens and money!

### Local Development

If you want to modify the plugin, you can clone this repository and use a local path:

```json
{
  "plugin": [
    "./plugin/dynamic-context-pruning"
  ]
}
```

## Configuration

No configuration required! The plugin works out of the box with:
- Zero-config setup using `opencode/big-pickle` model
- Automatic background optimization
- Smart AI-powered analysis

### Debug Logging (Optional)

To enable debug logging, set the `OPENCODE_DCP_DEBUG` environment variable:

```bash
# Enable debug logging for one session
OPENCODE_DCP_DEBUG=1 opencode

# Or export it to enable for all sessions
export OPENCODE_DCP_DEBUG=1
opencode
```

Debug logs will be written to `~/.config/opencode/logs/dcp/YYYY-MM-DD.log`.

You can watch logs in real-time:

```bash
tail -f ~/.config/opencode/logs/dcp/$(date +%Y-%m-%d).log
```

## Architecture

- **Janitor**: Background process that analyzes sessions using opencode/big-pickle model
- **State Manager**: In-memory store for pruned tool call IDs per session
- **Fetch Injector**: Injects custom fetch via `chat.params` hook
- **Pruning Fetch Wrapper**: Filters request bodies based on session state
- **Logger**: File-based debug logging system

## Development Status

Current implementation status: **Step 1 - Project Scaffolding** ✅

See `@notes/dynamic-context-pruning/IMPLEMENTATION-PLAN.md` for full implementation details.

## License

MIT

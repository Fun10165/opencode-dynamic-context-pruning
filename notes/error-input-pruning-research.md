# Error-Based Tool Input Pruning - Research & Implementation Plan

## Feature Overview

Prune **tool inputs** (not outputs) when the tool execution resulted in an error, provided:
1. The tool is older than the last N tools

---

## Research Findings

### 1. OpenCode Tool Error Formats

**Error State Structure:** Tool errors are stored with `status: "error"` and an `error` string field in the message schema (`MessageV2.ToolStateError`).

**Common error message patterns by tool:**

| Tool | Error Patterns |
|------|----------------|
| **Edit** | `"oldString not found in content"`, `"File ${filePath} not found"`, `"Found multiple matches for oldString..."`, `"oldString and newString must be different"` |
| **Write** | `"File ${filepath} is not in the current working directory"` |
| **Read** | `"File not found: ${filepath}"`, `"Cannot read binary file: ${filepath}"`, `"The user has blocked you from reading..."` |
| **Bash** | `"Command terminated after exceeding timeout"`, `"Command aborted by user"`, `"Tool execution aborted"` |
| **Grep** | `"pattern is required"`, `"ripgrep failed: ${errorOutput}"` |
| **Patch** | `"Failed to parse patch"`, `"Failed to find context..."`, `"No files were modified"` |
| **Permission** | `"The user rejected permission to use this specific tool call..."` |

**Error Categories:**
1. **Permission Errors** - User rejected permission or access denied
2. **File System Errors** - File not found, binary file, wrong path
3. **Validation Errors** - Invalid arguments, missing required parameters
4. **Network Errors** - Request failed, timeout, too large
5. **Parse Errors** - Failed to parse patch, command, etc.
6. **State Errors** - File modified, doom loop detected

### 2. DCP Codebase Architecture

**Fetch wrapper flow:**
1. Intercepts `globalThis.fetch` → detects API format → calls `handleFormat()`
2. `handleFormat()` caches tool parameters, injects synthetic instructions, replaces pruned outputs
3. Runs automatic deduplication strategy via `runStrategies()`

**Current data structures:**
- `state.toolParameters: Map<callId, { tool, parameters }>` - stores tool INPUTS only
- `state.prunedIds: Map<sessionId, string[]>` - tracks pruned IDs
- Tool OUTPUTS are extracted via `format.extractToolOutputs()` but not cached

**Gap identified:** The system caches tool **inputs** but not tool **outputs**. To detect errored tools, we need to cache output/error information.

**Strategy Interface:**
```typescript
interface PruningStrategy {
    name: string
    detect(
        toolMetadata: Map<string, ToolMetadata>,
        unprunedIds: string[],
        protectedTools: string[]
    ): StrategyResult
}
```

**Deduplication pattern (reference):**
- Creates signatures from tool name + sorted parameters
- Groups duplicate tool calls by signature
- Keeps most recent occurrence, prunes older ones
- Runs automatically without AI analysis

---

## Architecture Changes Required

### 1. Enhance State Types (`lib/state/index.ts`)

Add error tracking to `ToolParameterEntry`:

```typescript
interface ToolParameterEntry {
    tool: string
    parameters: any
    hasError?: boolean        // NEW: true if tool output indicates error
    errorContent?: string     // NEW: optional error message for classification
}
```

### 2. Enhance `cacheToolParameters()` to Also Cache Error Status

The existing `cacheToolParameters()` already iterates through messages. Extend it to also check tool outputs for error status in the same pass:

```typescript
// In cacheToolParameters() - after caching tool inputs from assistant messages,
// also check tool result messages for errors
for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) {
        const entry = state.toolParameters.get(m.tool_call_id.toLowerCase())
        if (entry && isErrorOutput(m.content)) {
            entry.hasError = true
        }
    }
}
```

### 3. Extend FormatDescriptor Interface (`lib/fetch-wrapper/types.ts`)

Add method to replace tool inputs:

```typescript
interface FormatDescriptor<T> {
    // ... existing methods
    
    // NEW: Replace tool INPUT (assistant's tool_call) with pruned message
    replaceToolInput(data: T, toolCallId: string, replacement: string, state: PluginState): boolean
}
```

### 4. Implement `replaceToolInput()` in Format Files

For each format (`openai-chat.ts`, `openai-responses.ts`, `bedrock.ts`, `gemini.ts`):

**`replaceToolInput()`** - Replace assistant's tool_call arguments:
```typescript
// Find assistant message with tool_calls containing this ID
// Replace the arguments with a pruned message
for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
            if (tc.id.toLowerCase() === toolCallId.toLowerCase()) {
                tc.function.arguments = JSON.stringify({ 
                    _pruned: "Input removed - tool execution failed" 
                })
                return true
            }
        }
    }
}
```

### 5. Create Error Pruning Strategy (`lib/core/strategies/error-pruning.ts`)

New strategy following the deduplication pattern:

```typescript
export const errorPruningStrategy: PruningStrategy = {
    name: 'error-pruning',
    
    detect(
        toolMetadata: Map<string, ToolMetadata>,
        unprunedIds: string[],
        protectedTools: string[],
        config: { minAge: number }  // e.g., last N=5 tools are protected
    ): StrategyResult {
        const prunedIds: string[] = []
        const recentN = config.minAge ?? 5
        
        // Don't prune the last N tool calls
        const pruneableIds = unprunedIds.slice(0, -recentN)
        
        for (const id of pruneableIds) {
            const meta = toolMetadata.get(id)
            if (!meta) continue
            
            // Skip protected tools
            if (protectedTools.includes(meta.tool.toLowerCase())) continue
            
            // Check if this tool errored
            if (meta.hasError) {
                prunedIds.push(id)
            }
        }
        
        return { prunedIds }
    }
}
```

### 6. Register Strategy (`lib/core/strategies/index.ts`)

Add to strategy list and runner:

```typescript
import { errorPruningStrategy } from './error-pruning'

const ALL_STRATEGIES: PruningStrategy[] = [
    deduplicationStrategy,
    errorPruningStrategy,  // NEW
]
```

### 7. Extend Handler for Input Replacement (`lib/fetch-wrapper/handler.ts`)

After output replacement loop, add input replacement:

```typescript
// Replace pruned tool OUTPUTS (existing)
for (const output of toolOutputs) {
    if (allPrunedIds.has(output.id)) {
        format.replaceToolOutput(data, output.id, PRUNED_CONTENT_MESSAGE, state)
    }
}

// NEW: Replace pruned tool INPUTS (for error-pruned tools)
for (const prunedId of inputPrunedIds) {
    format.replaceToolInput(data, prunedId, PRUNED_INPUT_MESSAGE, state)
}
```

### 8. Configuration (`lib/config.ts`)

Add config options:

```typescript
interface PluginConfig {
    // ... existing
    errorPruning: {
        enabled: boolean
        minAge: number           // Don't prune last N tools (default: 5)
        protectedTools: string[] // Additional tools to never error-prune
    }
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `lib/state/index.ts` | Add `hasError`, `errorContent` to `ToolParameterEntry` |
| `lib/fetch-wrapper/types.ts` | Add `replaceToolInput` to interface |
| `lib/fetch-wrapper/formats/openai-chat.ts` | Enhance `cacheToolParameters()` for error status, implement `replaceToolInput()` |
| `lib/fetch-wrapper/formats/openai-responses.ts` | Enhance `cacheToolParameters()` for error status, implement `replaceToolInput()` |
| `lib/fetch-wrapper/formats/bedrock.ts` | Enhance `cacheToolParameters()` for error status, implement `replaceToolInput()` |
| `lib/fetch-wrapper/formats/gemini.ts` | Enhance `cacheToolParameters()` for error status, implement `replaceToolInput()` |
| `lib/fetch-wrapper/handler.ts` | Add input replacement loop |
| `lib/core/strategies/error-pruning.ts` | **NEW** - Error pruning strategy |
| `lib/core/strategies/index.ts` | Register new strategy |
| `lib/core/strategies/types.ts` | Add `hasError` to `ToolMetadata` |
| `lib/config.ts` | Add error pruning config options |

---

## Key Considerations

1. **Age threshold:** Don't prune recent errors - the model may still be iterating on them. Only prune errors older than last N (configurable, default 5) tool calls.

2. **Input vs Output:** This feature prunes the INPUT (arguments sent to the tool), not the output. The output replacement already happens via deduplication. Input pruning removes the potentially large parameters (like `oldString`/`newString` in edit).

3. **State persistence:** Error status should be persisted so it survives session restores.

4. **Error detection is simple:** Tools with `status: "error"` are failures. No content parsing needed - the error state is explicit in the tool result schema.

---

## Implementation Order

1. Start with state types (`hasError` field)
2. Implement OpenAI Chat format methods first (most common)
3. Add strategy and register it
4. Extend handler for input replacement
5. Add configuration options
6. Implement remaining format methods (Bedrock, Gemini, OpenAI Responses)
7. Test with various error scenarios

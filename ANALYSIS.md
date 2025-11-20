# Dynamic Context Pruning - UI Token Count Analysis

## How OpenCode Calculates Context Usage

### Token Calculation Flow

1. **AI Provider Response** → Contains `usage` object with token counts
2. **Session.getUsage()** → Processes usage into standardized format:
   - `input`: Input tokens (excluding cached)
   - `output`: Output tokens  
   - `reasoning`: Reasoning tokens (for models with thinking)
   - `cache.read`: Cached tokens read from cache
   - `cache.write`: Cached tokens written to cache
3. **Saved to AssistantMessage** → `assistantMessage.tokens = usage.tokens`
4. **UI Reads Message** → Sums all token types for display
5. **Percentage Calculated** → `(total_tokens / model_limit) * 100`

### UI Display Locations

- **TUI**: `/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:54-59`
- **Desktop**: `/packages/desktop/src/pages/session.tsx:300-308`

### Token Total Formula

```typescript
total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
```

## How The Plugin Works

### Pruning Flow

1. **Session idle** → `event` hook triggers
2. **Janitor runs** → Analyzes tool calls, identifies obsolete ones
3. **Stores pruned IDs** → In StateManager
4. **Next request** → `chat.params` hook intercepts
5. **Filters messages** → Removes tool messages with pruned IDs from request body
6. **Provider sees reduced context** → Only unpruned messages sent

### Expected Behavior

✅ **What Should Happen:**
- Provider receives fewer messages
- Provider returns token counts based on what it received
- UI shows reduced token count automatically

❌ **What Might NOT Work:**
- If provider uses prompt caching, cached tokens might still count
- UI updates only after next assistant response (not immediately)
- The pruning effect only shows in the NEXT request after janitor runs

## The Issue

### Current Problem

The UI token count may not reflect pruning because:

1. **Prompt Caching**: Provider may have cached the original messages
   - `tokens.cache.read` will be high even after pruning
   - Cache hit means tokens "charged" but not sent
   
2. **Timing**: UI shows tokens from the current response
   - Pruning happens AFTER response
   - Next response will show the benefit

3. **No Response Hook**: No way to intercept and adjust reported tokens
   - Can't modify `usage` object from provider
   - UI directly reads from provider's reported usage

### Available Hooks

From `/packages/plugin/src/index.ts`:

```typescript
export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: { ... }
  "chat.message"?: (...) => Promise<void>
  "chat.params"?: (...) => Promise<void>  // ✅ We use this
  "permission.ask"?: (...) => Promise<void>
  "tool.execute.before"?: (...) => Promise<void>
  "tool.execute.after"?: (...) => Promise<void>
}
```

❌ **No `chat.response` hook available** to modify token counts after provider response

## Solutions

### Solution 1: Log Token Savings (Simplest)

Add logging to show pruning impact without modifying UI:

```typescript
logger.info("pruning-stats", "Context reduced", {
  sessionId,
  prunedToolCount: prunedThisRequest,
  estimatedTokensSaved: prunedThisRequest * 500, // rough estimate
  message: `Removed ${prunedThisRequest} tool responses from context`
})
```

**Pros:**
- Simple to implement
- No UI changes needed
- Visible in debug logs

**Cons:**
- User doesn't see impact in UI
- Only visible in logs

### Solution 2: Custom Event Emission (Better)

Emit custom events that could be displayed in UI:

```typescript
// After pruning messages
await ctx.client.event.create({
  body: {
    type: "custom",
    properties: {
      category: "context-pruning",
      data: {
        sessionID: sessionId,
        prunedCount: prunedThisRequest,
        estimatedSavings: prunedThisRequest * 500
      }
    }
  }
})
```

**Pros:**
- Visible to user
- Could be displayed in UI if OpenCode adds support
- Structured data

**Cons:**
- Requires UI changes to display
- Event API might not support custom events

### Solution 3: Modify OpenCode Core (Best, Most Complex)

Add a new hook `chat.response` to the plugin system:

```typescript
"chat.response"?: (
  input: { sessionID: string; agent: string; model: Model },
  output: { 
    usage: {
      inputTokens: number
      outputTokens: number
      reasoningTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }
  }
) => Promise<void>
```

**Pros:**
- Can directly adjust reported token counts
- Clean plugin API
- Most accurate

**Cons:**
- Requires modifying OpenCode core
- Needs PR to upstream
- More complex

### Solution 4: Wait and Verify (Current Approach)

The plugin might already work correctly because:

1. Pruned messages aren't sent to provider
2. Provider only counts tokens for what it receives
3. UI automatically shows correct counts

**To Verify:**
- Send several messages with tool calls
- Wait for pruning to occur
- Send a new message
- Check if token count is lower than expected

**Note:** Prompt caching might mask the effect if provider uses caching.

## Recommendations

### Immediate Actions

1. **Add detailed logging** to track token counts:
   ```typescript
   logger.info("token-tracking", "Request sent", {
     sessionId,
     messageCount: body.messages.length,
     prunedCount: prunedThisRequest
   })
   ```

2. **Verify pruning is working** by checking request body in logs

3. **Test with a new session** to see if counts are lower than expected

### Long-term Solutions

1. **Add metrics display** - Show "X tools pruned" in UI
2. **Contribute `chat.response` hook** to OpenCode core
3. **Track token savings** in StateManager and expose via API

## Testing Checklist

- [ ] Verify messages are actually removed from request body
- [ ] Check provider's response usage object
- [ ] Compare token counts before/after pruning
- [ [ Verify UI updates after next message
- [ ] Test with prompt caching enabled/disabled
- [ ] Check if `tokens.cache.read` is masking savings

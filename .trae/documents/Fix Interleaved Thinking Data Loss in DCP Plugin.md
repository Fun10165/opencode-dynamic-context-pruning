I have investigated the codebase and the issue.

**Diagnosis:**
The `opencode-dynamic-context-pruning` plugin intercepts chat messages using the `experimental.chat.messages.transform` hook. It receives messages as `WithParts[]`. The issue is likely that while the underlying AI SDK (`ai` and `@opencode-ai/sdk`) normalizes DeepSeek's `reasoning_content` into a `Part` with `type: 'reasoning'`, the plugin's internal type definitions or processing logic (specifically in `prune.ts` and `hooks.ts`) may not be explicitly accounting for this part type.

Although `lib/messages/prune.ts` technically ignores non-tool parts (which *should* preserve reasoning), the fact that it is being discarded suggests that either:
1.  The `Part` type definition used by the plugin is incomplete, causing TypeScript or runtime validation (if any) to drop it.
2.  The host system (OpenCode), when receiving the transformed messages back from the plugin, drops the `reasoning` parts because it expects the plugin to have handled or normalized them, or the plugin is inadvertently stripping them by not explicitly including them in a reconstructed object (though I see in-place modification, which mitigates this).

**Key Findings:**
- `lib/prompt.ts` contains a `minimizeMessages` function that *does* handle `part.type === 'reasoning'`, confirming the author is aware of it, but this is only used for the *OnIdle* analysis prompt, not the main chat loop.
- `lib/messages/prune.ts` (the main chat logic) *only* checks for `part.type === 'tool'`.
- The user's provided docs confirm DeepSeek uses `reasoning_content`, which the SDK normalizes to `type: 'reasoning'`.

**Proposed Fix (Linus Torvalds Style):**
"Bad programmers worry about the code. Good programmers worry about data structures."
We need to ensure the `reasoning` data structure is explicitly recognized and preserved throughout the pipeline.

1.  **Add Debug Logging**: First, we will add robust logging to `lib/hooks.ts` to inspect the incoming `output.messages` structure. We need to *see* if the `reasoning` part is even reaching the plugin. This aligns with the rule: "In case of error, add debug info."
2.  **Update Type Definitions**: We will verify and update `lib/state/types.ts` (or where `Part` is used) to ensure `reasoning` is a first-class citizen.
3.  **Explicit Preservation**: We will modify `lib/messages/prune.ts` to explicitly acknowledge `reasoning` parts. While `if (type !== 'tool') continue` *should* work, adding an explicit check `if (part.type === 'reasoning') continue` (with a comment) documents intent and ensures no future "cleanup" logic accidentally removes it.
4.  **Polyfill (Contingency)**: If the host is indeed dropping `reasoning` parts despite them being in the array, we may need to temporarily merge them into the `text` part (as `<thinking>...</thinking>`) for DeepSeek models, but we will start with the clean fix first.

**Step-by-Step Implementation Plan:**
1.  Modify `lib/hooks.ts` to log message parts structure.
2.  Modify `lib/messages/prune.ts` to explicitly handle `reasoning` parts.
3.  Verify the fix (User will need to run it, as I cannot simulate the DeepSeek API).

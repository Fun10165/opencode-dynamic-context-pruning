import { tool } from "@opencode-ai/plugin"
import type { Janitor } from "./janitor"
import type { PluginConfig } from "./config"
import type { ToolTracker } from "./synth-instruction"
import { resetToolTrackerCount } from "./synth-instruction"
import { loadPrompt } from "./prompt"

/** Tool description for the context_pruning tool, loaded from prompts/tool.txt */
export const CONTEXT_PRUNING_DESCRIPTION = loadPrompt("tool")

/**
 * Creates the context_pruning tool definition.
 * Returns a tool definition that can be passed to the plugin's tool registry.
 */
export function createPruningTool(janitor: Janitor, config: PluginConfig, toolTracker: ToolTracker): ReturnType<typeof tool> {
    return tool({
        description: CONTEXT_PRUNING_DESCRIPTION,
        args: {
            reason: tool.schema.string().optional().describe(
                "Brief reason for triggering pruning (e.g., 'task complete', 'switching focus')"
            ),
        },
        async execute(args, ctx) {
            const result = await janitor.runForTool(
                ctx.sessionID,
                config.strategies.onTool,
                args.reason
            )

            // Reset nudge counter to prevent immediate re-nudging after pruning
            if (config.nudge_freq > 0) {
                resetToolTrackerCount(toolTracker, config.nudge_freq)
            }

            if (!result || result.prunedCount === 0) {
                return "No prunable tool outputs found. Context is already optimized.\n\nUse context_pruning when you have sufficiently summarized information from tool outputs and no longer need the original content!"
            }

            return janitor.formatPruningResultForTool(result) + "\n\nKeep using context_pruning when you have sufficiently summarized information from tool outputs and no longer need the original content!"
        },
    })
}

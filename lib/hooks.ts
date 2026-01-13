import type { SessionState, WithParts } from "./state"
import type { Logger } from "./logger"
import type { PluginConfig } from "./config"
import { syncToolCache } from "./state/tool-cache"
import { deduplicate, supersedeWrites, purgeErrors } from "./strategies"
import { prune, insertPruneToolContext } from "./messages"
import { checkSession } from "./state"
import { loadPrompt } from "./prompts"

const INTERNAL_AGENT_SIGNATURES = [
    "You are a title generator",
    "You are a helpful AI assistant tasked with summarizing conversations",
    "Summarize what was done in this conversation",
]

export function createSystemPromptHandler(
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
) {
    return async (_input: unknown, output: { system: string[] }) => {
        if (state.isSubAgent) {
            return
        }

        const systemText = output.system.join("\n")
        if (INTERNAL_AGENT_SIGNATURES.some((sig) => systemText.includes(sig))) {
            logger.info("Skipping DCP system prompt injection for internal agent")
            return
        }

        const discardEnabled = config.tools.discard.enabled
        const extractEnabled = config.tools.extract.enabled

        let promptName: string
        if (discardEnabled && extractEnabled) {
            promptName = "system/system-prompt-both"
        } else if (discardEnabled) {
            promptName = "system/system-prompt-discard"
        } else if (extractEnabled) {
            promptName = "system/system-prompt-extract"
        } else {
            return
        }

        const syntheticPrompt = loadPrompt(promptName)
        output.system.push(syntheticPrompt)
    }
}

export function createChatMessageTransformHandler(
    client: any,
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
) {
    return async (input: {}, output: { messages: WithParts[] }) => {
        await checkSession(client, state, logger, output.messages)

        if (state.isSubAgent) {
            return
        }

        syncToolCache(state, config, logger, output.messages)

        deduplicate(state, logger, config, output.messages)
        supersedeWrites(state, logger, config, output.messages)
        purgeErrors(state, logger, config, output.messages)

        prune(state, logger, config, output.messages)

        insertPruneToolContext(state, config, logger, output.messages)

        if (state.sessionId) {
            await logger.saveContext(state.sessionId, output.messages)
        }
    }
}

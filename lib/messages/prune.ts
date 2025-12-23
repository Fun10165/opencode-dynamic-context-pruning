import type { SessionState, WithParts } from "../state"
import type { Logger } from "../logger"
import type { PluginConfig } from "../config"
import { loadPrompt } from "../prompt"
import { extractParameterKey, buildToolIdList, isReasoningPart } from "./utils"
import { getLastUserMessage, isMessageCompacted } from "../shared-utils"
import { UserMessage } from "@opencode-ai/sdk"

const PRUNED_TOOL_INPUT_REPLACEMENT = '[Input removed to save context]'
const PRUNED_TOOL_OUTPUT_REPLACEMENT = '[Output removed to save context - information superseded or no longer needed]'
const NUDGE_STRING = loadPrompt("nudge")

const buildPrunableToolsList = (
    state: SessionState,
    config: PluginConfig,
    logger: Logger,
    messages: WithParts[],
): string => {
    const lines: string[] = []
    const toolIdList: string[] = buildToolIdList(state, messages, logger)

    state.toolParameters.forEach((toolParameterEntry, toolCallId) => {
        if (state.prune.toolIds.includes(toolCallId)) {
            return
        }
        if (config.strategies.pruneTool.protectedTools.includes(toolParameterEntry.tool)) {
            return
        }
        const numericId = toolIdList.indexOf(toolCallId)
        if (numericId === -1) {
            logger.warn(`Tool in cache but not in toolIdList - possible stale entry`, { toolCallId, tool: toolParameterEntry.tool })
            return
        }
        const paramKey = extractParameterKey(toolParameterEntry.tool, toolParameterEntry.parameters)
        const description = paramKey ? `${toolParameterEntry.tool}, ${paramKey}` : toolParameterEntry.tool
        lines.push(`${numericId}: ${description}`)
        logger.debug(`Prunable tool found - ID: ${numericId}, Tool: ${toolParameterEntry.tool}, Call ID: ${toolCallId}`)
    })

    if (lines.length === 0) {
        return ""
    }

    return `<prunable-tools>\nThe following tools have been invoked and are available for pruning. This list does not mandate immediate action. Consider your current goals and the resources you need before discarding valuable tool inputs or outputs. Keep the context free of noise.\n${lines.join('\n')}\n</prunable-tools>`
}

export const insertPruneToolContext = (
    state: SessionState,
    config: PluginConfig,
    logger: Logger,
    messages: WithParts[]
): void => {
    if (!config.strategies.pruneTool.enabled) {
        return
    }

    const lastUserMessage = getLastUserMessage(messages)
    if (!lastUserMessage) {
        return
    }

    const prunableToolsList = buildPrunableToolsList(state, config, logger, messages)
    if (!prunableToolsList) {
        return
    }

    // Check if the last message indicates ongoing reasoning or tool execution
    // If the last message is an assistant message with reasoning but NO tool call, 
    // or if it ends with a tool result, we might be in the middle of a chain.
    const lastMessage = messages[messages.length - 1]
    if (lastMessage) {
        const hasReasoning = lastMessage.parts.some(p => p.type === 'reasoning' || (p as any).type === 'thinking')
        const hasToolCall = lastMessage.parts.some(p => p.type === 'tool')
        
        // If the model is thinking but hasn't called a tool yet, or just called a tool,
        // injecting a User message now might break the flow.
        // However, we usually run AFTER the tool result is added (which is a separate message or part).
        
        // Better heuristic: If the last part is reasoning, DO NOT inject.
        // Also skip if it's step-finish (tool call just happened)
        const lastPart = lastMessage.parts[lastMessage.parts.length - 1]
        if (isReasoningPart(lastPart) || lastPart.type === 'step-finish') {
            logger.debug("Skipping prune context injection: Model is thinking or stepping")
            return
        }
    }

    let nudgeString = ""
    if (state.nudgeCounter >= config.strategies.pruneTool.nudge.frequency) {
        logger.info("Inserting prune nudge message")
        nudgeString = "\n" + NUDGE_STRING
    }

    const userMessage: WithParts = {
        info: {
            id: "msg_01234567890123456789012345",
            sessionID: lastUserMessage.info.sessionID,
            role: "system" as any, // Use system role to avoid breaking reasoning flow
            time: { created: Date.now() },
            agent: (lastUserMessage.info as UserMessage).agent || "build",
            model: {
                providerID: (lastUserMessage.info as UserMessage).model.providerID,
                modelID: (lastUserMessage.info as UserMessage).model.modelID
            }
        },
        parts: [
            {
                id: "prt_01234567890123456789012345",
                sessionID: lastUserMessage.info.sessionID,
                messageID: "msg_01234567890123456789012345",
                type: "text",
                text: prunableToolsList + nudgeString,
            }
        ]
    }

    messages.push(userMessage)
}

export const prune = (
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    messages: WithParts[]
): void => {
    pruneToolOutputs(state, logger, messages)
    pruneToolInputs(state, logger, messages)
}

const pruneToolOutputs = (
    state: SessionState,
    logger: Logger,
    messages: WithParts[]
): void => {
    for (const msg of messages) {
        if (isMessageCompacted(state, msg)) {
            continue
        }

        for (const part of msg.parts) {
            // Explicitly preserve reasoning parts (DeepSeek/Claude thinking)
            if (isReasoningPart(part)) {
                continue
            }

            if (part.type !== 'tool') {
                continue
            }
            if (!state.prune.toolIds.includes(part.callID)) {
                continue
            }
            // Skip write and edit tools - their inputs are pruned instead
            if (part.tool === 'write' || part.tool === 'edit') {
                continue
            }
            if (part.state.status === 'completed') {
                part.state.output = PRUNED_TOOL_OUTPUT_REPLACEMENT
            }
        }
    }
}

const pruneToolInputs = (
    state: SessionState,
    logger: Logger,
    messages: WithParts[]
): void => {
    for (const msg of messages) {
        for (const part of msg.parts) {
            // Explicitly preserve reasoning parts
            if (isReasoningPart(part)) {
                continue
            }

            if (part.type !== 'tool') {
                continue
            }
            if (!state.prune.toolIds.includes(part.callID)) {
                continue
            }
            // Only prune inputs for write and edit tools
            if (part.tool !== 'write' && part.tool !== 'edit') {
                continue
            }
            // Don't prune yet if tool is still pending or running
            if (part.state.status === "pending" || part.state.status === "running") {
                continue
            }

            if (part.state.input?.content !== undefined) {
                part.state.input.content = PRUNED_TOOL_INPUT_REPLACEMENT
            }
        }
    }
}

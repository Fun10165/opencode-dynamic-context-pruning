import type { FormatDescriptor, ToolOutput, ToolTracker } from "../types"
import type { PluginState } from "../../state"
import type { Logger } from "../../logger"
import { cacheToolParametersFromMessages } from "../../state/tool-cache"

function isNudgeMessage(msg: any, nudgeText: string): boolean {
    if (typeof msg.content === 'string') {
        return msg.content === nudgeText
    }
    return false
}

function injectSynth(messages: any[], instruction: string, nudgeText: string): boolean {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === 'user') {
            if (isNudgeMessage(msg, nudgeText)) continue
            
            if (typeof msg.content === 'string') {
                if (msg.content.includes(instruction)) return false
                msg.content = msg.content + '\n\n' + instruction
            } else if (Array.isArray(msg.content)) {
                const alreadyInjected = msg.content.some(
                    (part: any) => part?.type === 'text' && typeof part.text === 'string' && part.text.includes(instruction)
                )
                if (alreadyInjected) return false
                msg.content.push({ type: 'text', text: instruction })
            }
            return true
        }
    }
    return false
}

function trackNewToolResults(messages: any[], tracker: ToolTracker, protectedTools: Set<string>): number {
    let newCount = 0
    for (const m of messages) {
        if (m.role === 'tool' && m.tool_call_id) {
            if (!tracker.seenToolResultIds.has(m.tool_call_id)) {
                tracker.seenToolResultIds.add(m.tool_call_id)
                const toolName = tracker.getToolName?.(m.tool_call_id)
                if (!toolName || !protectedTools.has(toolName)) {
                    tracker.toolResultCount++
                    newCount++
                }
            }
        } else if (m.role === 'user' && Array.isArray(m.content)) {
            for (const part of m.content) {
                if (part.type === 'tool_result' && part.tool_use_id) {
                    if (!tracker.seenToolResultIds.has(part.tool_use_id)) {
                        tracker.seenToolResultIds.add(part.tool_use_id)
                        const toolName = tracker.getToolName?.(part.tool_use_id)
                        if (!toolName || !protectedTools.has(toolName)) {
                            tracker.toolResultCount++
                            newCount++
                        }
                    }
                }
            }
        }
    }
    return newCount
}

function injectPrunableList(messages: any[], injection: string): boolean {
    if (!injection) return false
    messages.push({ role: 'user', content: injection })
    return true
}

/**
 * Bedrock uses top-level `system` array + `inferenceConfig` (distinguishes from OpenAI/Anthropic).
 * Tool calls: `toolUse` blocks in assistant content with `toolUseId`
 * Tool results: `toolResult` blocks in user content with `toolUseId`
 */
export const bedrockFormat: FormatDescriptor = {
    name: 'bedrock',

    detect(body: any): boolean {
        return (
            Array.isArray(body.system) &&
            body.inferenceConfig !== undefined &&
            Array.isArray(body.messages)
        )
    },

    getDataArray(body: any): any[] | undefined {
        return body.messages
    },

    cacheToolParameters(data: any[], state: PluginState, logger?: Logger): void {
        // Extract toolUseId and tool name from assistant toolUse blocks
        for (const m of data) {
            if (m.role === 'assistant' && Array.isArray(m.content)) {
                for (const block of m.content) {
                    if (block.toolUse && block.toolUse.toolUseId) {
                        const toolUseId = block.toolUse.toolUseId.toLowerCase()
                        state.toolParameters.set(toolUseId, {
                            tool: block.toolUse.name,
                            parameters: block.toolUse.input
                        })
                        logger?.debug("bedrock", "Cached tool parameters", {
                            toolUseId,
                            toolName: block.toolUse.name
                        })
                    }
                }
            }
        }
        cacheToolParametersFromMessages(data, state, logger)
    },

    injectSynth(data: any[], instruction: string, nudgeText: string): boolean {
        return injectSynth(data, instruction, nudgeText)
    },

    trackNewToolResults(data: any[], tracker: ToolTracker, protectedTools: Set<string>): number {
        return trackNewToolResults(data, tracker, protectedTools)
    },

    injectPrunableList(data: any[], injection: string): boolean {
        return injectPrunableList(data, injection)
    },

    extractToolOutputs(data: any[], state: PluginState): ToolOutput[] {
        const outputs: ToolOutput[] = []

        for (const m of data) {
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const block of m.content) {
                    if (block.toolResult && block.toolResult.toolUseId) {
                        const toolUseId = block.toolResult.toolUseId.toLowerCase()
                        const metadata = state.toolParameters.get(toolUseId)
                        outputs.push({
                            id: toolUseId,
                            toolName: metadata?.tool
                        })
                    }
                }
            }
        }

        return outputs
    },

    replaceToolOutput(data: any[], toolId: string, prunedMessage: string, _state: PluginState): boolean {
        const toolIdLower = toolId.toLowerCase()
        let replaced = false

        for (let i = 0; i < data.length; i++) {
            const m = data[i]

            if (m.role === 'user' && Array.isArray(m.content)) {
                let messageModified = false
                const newContent = m.content.map((block: any) => {
                    if (block.toolResult && block.toolResult.toolUseId?.toLowerCase() === toolIdLower) {
                        messageModified = true
                        return {
                            ...block,
                            toolResult: {
                                ...block.toolResult,
                                content: [{ text: prunedMessage }]
                            }
                        }
                    }
                    return block
                })
                if (messageModified) {
                    data[i] = { ...m, content: newContent }
                    replaced = true
                }
            }
        }

        return replaced
    },

    hasToolOutputs(data: any[]): boolean {
        for (const m of data) {
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const block of m.content) {
                    if (block.toolResult) return true
                }
            }
        }
        return false
    },

    getLogMetadata(data: any[], replacedCount: number, inputUrl: string): Record<string, any> {
        return {
            url: inputUrl,
            replacedCount,
            totalMessages: data.length,
            format: 'bedrock'
        }
    }
}

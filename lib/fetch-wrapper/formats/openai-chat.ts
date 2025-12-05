import type { FormatDescriptor, ToolOutput, ToolTracker } from "../types"
import type { PluginState } from "../../state"
import type { Logger } from "../../logger"
import { cacheToolParametersFromMessages } from "../../state/tool-cache"

// ============================================================================
// Format-specific injection helpers
// ============================================================================

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
            // Skip nudge messages - find real user message
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

// ============================================================================
// Format Descriptor
// ============================================================================

/**
 * Format descriptor for OpenAI Chat Completions and Anthropic APIs.
 * 
 * OpenAI Chat format:
 * - Messages with role='tool' and tool_call_id
 * - Assistant messages with tool_calls[] array
 * 
 * Anthropic format:
 * - Messages with role='user' containing content[].type='tool_result' and tool_use_id
 * - Assistant messages with content[].type='tool_use'
 */
export const openaiChatFormat: FormatDescriptor = {
    name: 'openai-chat',

    detect(body: any): boolean {
        return body.messages && Array.isArray(body.messages)
    },

    getDataArray(body: any): any[] | undefined {
        return body.messages
    },

    cacheToolParameters(data: any[], state: PluginState, logger?: Logger): void {
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
            if (m.role === 'tool' && m.tool_call_id) {
                const metadata = state.toolParameters.get(m.tool_call_id.toLowerCase())
                outputs.push({
                    id: m.tool_call_id.toLowerCase(),
                    toolName: metadata?.tool
                })
            }

            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const part of m.content) {
                    if (part.type === 'tool_result' && part.tool_use_id) {
                        const metadata = state.toolParameters.get(part.tool_use_id.toLowerCase())
                        outputs.push({
                            id: part.tool_use_id.toLowerCase(),
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

            if (m.role === 'tool' && m.tool_call_id?.toLowerCase() === toolIdLower) {
                data[i] = { ...m, content: prunedMessage }
                replaced = true
            }

            if (m.role === 'user' && Array.isArray(m.content)) {
                let messageModified = false
                const newContent = m.content.map((part: any) => {
                    if (part.type === 'tool_result' && part.tool_use_id?.toLowerCase() === toolIdLower) {
                        messageModified = true
                        return { ...part, content: prunedMessage }
                    }
                    return part
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
            if (m.role === 'tool') return true
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const part of m.content) {
                    if (part.type === 'tool_result') return true
                }
            }
        }
        return false
    },

    getLogMetadata(data: any[], replacedCount: number, inputUrl: string): Record<string, any> {
        return {
            url: inputUrl,
            replacedCount,
            totalMessages: data.length
        }
    }
}

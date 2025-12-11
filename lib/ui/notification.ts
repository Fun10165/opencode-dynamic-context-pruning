import type { Logger } from "../logger"
import type { SessionStats, GCStats } from "../state"
import { formatTokenCount } from "../tokenizer"
import { formatPrunedItemsList } from "./display-utils"
import { ToolParameterEntry } from "../state"
import { PluginConfig } from "../config"

export type PruneReason = "completion" | "noise" | "consolidation"
export const PRUNE_REASON_LABELS: Record<PruneReason, string> = {
    completion: "Task Complete",
    noise: "Noise Removal",
    consolidation: "Consolidation"
}

function calculateStats(
    tokensSaved: number,
    gcPending: GCStats | null,
    sessionStats: SessionStats
): {
    justNowTokens: number
    totalTokens: number
} {
    const justNowTokens = tokensSaved + (gcPending?.tokensCollected ?? 0)

    const totalTokens = sessionStats
        ? sessionStats.totalTokensSaved + sessionStats.totalGCTokens
        : justNowTokens

    return { justNowTokens, totalTokens }
}

function formatStatsHeader(
    totalTokens: number,
    justNowTokens: number
): string {
    const totalTokensStr = `~${formatTokenCount(totalTokens)}`
    const justNowTokensStr = `~${formatTokenCount(justNowTokens)}`

    const maxTokenLen = Math.max(totalTokensStr.length, justNowTokensStr.length)
    const totalTokensPadded = totalTokensStr.padStart(maxTokenLen)

    return [
        `▣ DCP | ${totalTokensPadded} saved total`,
    ].join('\n')
}

function buildMinimalMessage(
    tokensSaved: number,
    gcPending: GCStats | null,
    sessionStats: SessionStats,
    reason: PruneReason | undefined
): string {
    const { justNowTokens, totalTokens } = calculateStats(tokensSaved, gcPending, sessionStats)
    const reasonSuffix = reason ? ` [${PRUNE_REASON_LABELS[reason]}]` : ''
    return formatStatsHeader(totalTokens, justNowTokens) + reasonSuffix
}

function buildDetailedMessage(
    tokensSaved: number,
    gcPending: GCStats | null,
    sessionStats: SessionStats,
    reason: PruneReason | undefined,
    prunedIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    workingDirectory?: string
): string {
    const { justNowTokens, totalTokens } = calculateStats(tokensSaved, gcPending, sessionStats)

    let message = formatStatsHeader(totalTokens, justNowTokens)

    if (prunedIds.length > 0) {
        const justNowTokensStr = `~${formatTokenCount(justNowTokens)}`
        const reasonLabel = reason ? ` — ${PRUNE_REASON_LABELS[reason]}` : ''
        message += `\n\n▣ Pruned tools (${justNowTokensStr})${reasonLabel}`

        const itemLines = formatPrunedItemsList(prunedIds, toolMetadata, workingDirectory)
        message += '\n' + itemLines.join('\n')
    }

    return message.trim()
}

export async function sendUnifiedNotification(
    client: any,
    logger: Logger,
    config: PluginConfig,
    sessionId: string,
    prunedCount: number,
    tokensSaved: number,
    prunedIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    gcPending: GCStats | null,
    sessionStats: SessionStats,
    reason: PruneReason | undefined,
    agent: string | undefined,
    workingDirectory: string
): Promise<boolean> {
    const hasPruned = prunedCount > 0
    const hasGcActivity = gcPending && gcPending.toolsDeduped > 0

    if (!hasPruned && !hasGcActivity) {
        return false
    }

    if (config.pruningSummary === 'off') {
        return false
    }

    const message = config.pruningSummary === 'minimal'
        ? buildMinimalMessage(tokensSaved, gcPending, sessionStats, reason)
        : buildDetailedMessage(tokensSaved, gcPending, sessionStats, reason, prunedIds, toolMetadata, workingDirectory)

    await sendIgnoredMessage(client, logger, sessionId, message, agent)
    return true
}

export async function sendIgnoredMessage(
    client: any,
    logger: Logger,
    sessionID: string,
    text: string,
    agent?: string
): Promise<void> {
    try {
        await client.session.prompt({
            path: { id: sessionID },
            body: {
                noReply: true,
                agent: agent,
                parts: [{
                    type: 'text',
                    text: text,
                    ignored: true
                }]
            }
        })
    } catch (error: any) {
        logger.error("notification", "Failed to send notification", { error: error.message })
    }
}


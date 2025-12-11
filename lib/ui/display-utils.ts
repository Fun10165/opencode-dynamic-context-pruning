import { ToolParameterEntry } from "../state"

/**
 * Extracts a human-readable key from tool metadata for display purposes.
 * Used by both deduplication and AI analysis to show what was pruned.
 */
export function extractParameterKey(metadata: { tool: string, parameters?: any }): string {
    if (!metadata.parameters) return ''

    const { tool, parameters } = metadata

    if (tool === "read" && parameters.filePath) {
        return parameters.filePath
    }
    if (tool === "write" && parameters.filePath) {
        return parameters.filePath
    }
    if (tool === "edit" && parameters.filePath) {
        return parameters.filePath
    }

    if (tool === "list") {
        return parameters.path || '(current directory)'
    }
    if (tool === "glob") {
        if (parameters.pattern) {
            const pathInfo = parameters.path ? ` in ${parameters.path}` : ""
            return `"${parameters.pattern}"${pathInfo}`
        }
        return '(unknown pattern)'
    }
    if (tool === "grep") {
        if (parameters.pattern) {
            const pathInfo = parameters.path ? ` in ${parameters.path}` : ""
            return `"${parameters.pattern}"${pathInfo}`
        }
        return '(unknown pattern)'
    }

    if (tool === "bash") {
        if (parameters.description) return parameters.description
        if (parameters.command) {
            return parameters.command.length > 50
                ? parameters.command.substring(0, 50) + "..."
                : parameters.command
        }
    }

    if (tool === "webfetch" && parameters.url) {
        return parameters.url
    }
    if (tool === "websearch" && parameters.query) {
        return `"${parameters.query}"`
    }
    if (tool === "codesearch" && parameters.query) {
        return `"${parameters.query}"`
    }

    if (tool === "todowrite") {
        return `${parameters.todos?.length || 0} todos`
    }
    if (tool === "todoread") {
        return "read todo list"
    }

    if (tool === "task" && parameters.description) {
        return parameters.description
    }

    const paramStr = JSON.stringify(parameters)
    if (paramStr === '{}' || paramStr === '[]' || paramStr === 'null') {
        return ''
    }
    return paramStr.substring(0, 50)
}

export function truncate(str: string, maxLen: number = 60): string {
    if (str.length <= maxLen) return str
    return str.slice(0, maxLen - 3) + '...'
}

export function shortenPath(input: string, workingDirectory?: string): string {
    const inPathMatch = input.match(/^(.+) in (.+)$/)
    if (inPathMatch) {
        const prefix = inPathMatch[1]
        const pathPart = inPathMatch[2]
        const shortenedPath = shortenSinglePath(pathPart, workingDirectory)
        return `${prefix} in ${shortenedPath}`
    }

    return shortenSinglePath(input, workingDirectory)
}

function shortenSinglePath(path: string, workingDirectory?: string): string {
    if (workingDirectory) {
        if (path.startsWith(workingDirectory + '/')) {
            return path.slice(workingDirectory.length + 1)
        }
        if (path === workingDirectory) {
            return '.'
        }
    }

    return path
}

/**
 * Formats a list of pruned items in the style: "→ tool: parameter"
 */
export function formatPrunedItemsList(
    prunedIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    workingDirectory?: string
): string[] {
    const lines: string[] = []

    for (const prunedId of prunedIds) {
        const normalizedId = prunedId.toLowerCase()
        const metadata = toolMetadata.get(normalizedId)

        if (metadata) {
            const paramKey = extractParameterKey(metadata)
            if (paramKey) {
                // Use 60 char limit to match notification style
                const displayKey = truncate(shortenPath(paramKey, workingDirectory), 60)
                lines.push(`→ ${metadata.tool}: ${displayKey}`)
            } else {
                lines.push(`→ ${metadata.tool}`)
            }
        }
    }

    const knownCount = prunedIds.filter(id =>
        toolMetadata.has(id.toLowerCase())
    ).length
    const unknownCount = prunedIds.length - knownCount

    if (unknownCount > 0) {
        lines.push(`→ (${unknownCount} tool${unknownCount > 1 ? 's' : ''} with unknown metadata)`)
    }

    return lines
}

/**
 * Formats a PruningResult into a human-readable string for the prune tool output.
 */
export function formatPruningResultForTool(
    prunedIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    workingDirectory?: string
): string {
    const lines: string[] = []
    lines.push(`Context pruning complete. Pruned ${prunedIds.length} tool outputs.`)
    lines.push('')

    if (prunedIds.length > 0) {
        lines.push(`Semantically pruned (${prunedIds.length}):`)
        lines.push(...formatPrunedItemsList(prunedIds, toolMetadata, workingDirectory))
    }

    return lines.join('\n').trim()
}

/**
 * Token counting utilities using gpt-tokenizer
 * 
 * Uses gpt-tokenizer to provide token counts for text content.
 * Works with any LLM provider - provides accurate counts for OpenAI models
 * and reasonable approximations for other providers.
 */

import { encode } from 'gpt-tokenizer'
import type { Logger } from './logger'

/**
 * Batch estimates tokens for multiple text samples
 * 
 * @param texts - Array of text strings to tokenize
 * @param logger - Optional logger instance
 * @returns Array of token counts
 */
export function estimateTokensBatch(
    texts: string[],
    logger?: Logger
): number[] {
    try {
        const results = texts.map(text => {
            const tokens = encode(text)
            return tokens.length
        })

        logger?.debug('tokenizer', 'Batch token estimation complete', {
            batchSize: texts.length,
            totalTokens: results.reduce((sum, count) => sum + count, 0),
            avgTokensPerText: Math.round(results.reduce((sum, count) => sum + count, 0) / results.length)
        })

        return results
    } catch (error: any) {
        logger?.warn('tokenizer', 'Batch tokenization failed, using fallback', {
            error: error.message
        })

        // Fallback to character-based estimation
        return texts.map(text => Math.round(text.length / 4))
    }
}

/**
 * Formats token count for display (e.g., 1500 -> "1.5K", 50 -> "50")
 * 
 * @param tokens - Number of tokens
 * @returns Formatted string
 */
export function formatTokenCount(tokens: number): string {
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`.replace('.0K', 'K')
    }
    return tokens.toString()
}

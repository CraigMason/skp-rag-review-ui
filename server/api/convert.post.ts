import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

type ConvertResponse = {
    success: boolean
    mode: 'local' | 'remote'
    scope: 'all' | 'source'
    source: string | null
    startedAt: string
    endedAt: string
    durationMs: number
    exitCode: number
    stdout: string
    stderr: string
    truncated: {
        stdout: boolean
        stderr: boolean
    }
}

let conversionInProgress = false

const MAX_LOG_CHARS = 24_000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function clampOutput(current: string, chunk: string): { value: string; truncated: boolean } {
    const next = `${current}${chunk}`
    if (next.length <= MAX_LOG_CHARS) {
        return { value: next, truncated: false }
    }

    return {
        value: next.slice(next.length - MAX_LOG_CHARS),
        truncated: true
    }
}

function normalizeRelativePath(input: string): string {
    return input.replaceAll('\\', '/').replace(/^\/+/, '')
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath)
        return true
    } catch {
        return false
    }
}

async function runLocalConversion(ingestWorkdir: string, timeoutMs: number): Promise<{
    exitCode: number
    stdout: string
    stderr: string
    truncated: { stdout: boolean; stderr: boolean }
}> {
    const ingestPath = path.resolve(process.cwd(), ingestWorkdir)
    if (!(await pathExists(ingestPath))) {
        throw createError({
            statusCode: 500,
            statusMessage: `Ingest workdir not found: ${ingestPath}`
        })
    }

    return await new Promise((resolve, reject) => {
        const child = spawn('uv', ['run', 'ai-ingest'], {
            cwd: ingestPath,
            env: process.env
        })

        let stdout = ''
        let stderr = ''
        let stdoutTruncated = false
        let stderrTruncated = false

        const timeout = setTimeout(() => {
            child.kill('SIGTERM')
            reject(createError({
                statusCode: 504,
                statusMessage: `Conversion timed out after ${timeoutMs}ms`
            }))
        }, timeoutMs)

        child.stdout.on('data', (chunk) => {
            const result = clampOutput(stdout, chunk.toString('utf-8'))
            stdout = result.value
            stdoutTruncated = stdoutTruncated || result.truncated
        })

        child.stderr.on('data', (chunk) => {
            const result = clampOutput(stderr, chunk.toString('utf-8'))
            stderr = result.value
            stderrTruncated = stderrTruncated || result.truncated
        })

        child.on('error', (error) => {
            clearTimeout(timeout)
            reject(createError({
                statusCode: 500,
                statusMessage: `Failed to start conversion: ${error.message}`
            }))
        })

        child.on('close', (code) => {
            clearTimeout(timeout)
            resolve({
                exitCode: code ?? 1,
                stdout,
                stderr,
                truncated: {
                    stdout: stdoutTruncated,
                    stderr: stderrTruncated
                }
            })
        })
    })
}

export default defineEventHandler(async (event): Promise<ConvertResponse> => {
    if (conversionInProgress) {
        throw createError({
            statusCode: 409,
            statusMessage: 'A conversion job is already running'
        })
    }

    conversionInProgress = true

    try {
        const config = useRuntimeConfig()
        const body = await readBody<{ source?: string }>(event)
        const source = typeof body?.source === 'string' && body.source.trim().length > 0
            ? normalizeRelativePath(body.source)
            : null

        const startedAt = new Date()
        const timeoutValue = Number.parseInt(
            process.env.SKP_CONVERT_TIMEOUT_MS || (config.skpConvertTimeoutMs as string) || '',
            10
        )
        const timeoutMs = Number.isFinite(timeoutValue) ? timeoutValue : DEFAULT_TIMEOUT_MS

        const ingestApiUrl = (process.env.SKP_INGEST_API_URL || config.skpIngestApiUrl || '') as string
        let result: {
            exitCode: number
            stdout: string
            stderr: string
            truncated: { stdout: boolean; stderr: boolean }
        }
        let mode: 'local' | 'remote' = 'local'

        if (ingestApiUrl) {
            mode = 'remote'
            const remoteResult = await $fetch<{
                success: boolean
                exitCode?: number
                stdout?: string
                stderr?: string
            }>(`${ingestApiUrl.replace(/\/$/, '')}/convert`, {
                method: 'POST',
                body: {
                    source
                }
            })

            result = {
                exitCode: remoteResult.exitCode ?? (remoteResult.success ? 0 : 1),
                stdout: remoteResult.stdout || '',
                stderr: remoteResult.stderr || '',
                truncated: {
                    stdout: false,
                    stderr: false
                }
            }
        } else {
            const ingestWorkdir = (process.env.SKP_INGEST_WORKDIR || config.skpIngestWorkdir || '../ai-doc-ingest') as string
            result = await runLocalConversion(ingestWorkdir, timeoutMs)
        }

        const endedAt = new Date()

        return {
            success: result.exitCode === 0,
            mode,
            scope: source ? 'source' : 'all',
            source,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: endedAt.getTime() - startedAt.getTime(),
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            truncated: result.truncated
        }
    } finally {
        conversionInProgress = false
    }
})

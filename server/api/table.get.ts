import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'

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

async function resolveOutputRoot(configuredPath?: string): Promise<string> {
    if (configuredPath) {
        return path.resolve(process.cwd(), configuredPath)
    }

    const candidates = [
        path.resolve(process.cwd(), '../data/docs/out'),
        path.resolve(process.cwd(), 'data/docs/out'),
        path.resolve(process.cwd(), '../ai-doc-ingest/var/out'),
        path.resolve(process.cwd(), 'ai-doc-ingest/var/out'),
        path.resolve(process.cwd(), 'var/out')
    ]

    for (const candidate of candidates) {
        if (await pathExists(candidate)) {
            return candidate
        }
    }

    return candidates[0]
}

function ensureSafePath(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath)
    const relative = path.relative(root, resolved)

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid table path'
        })
    }

    return resolved
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig()
    const outputRoot = await resolveOutputRoot(
        process.env.SKP_DOCS_OUT_DIR || (config.skpDocsOutDir as string | undefined)
    )

    const query = getQuery(event)
    const tablePath = typeof query.path === 'string' ? normalizeRelativePath(query.path) : ''
    const limitParam = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 500
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 5000) : 500

    if (!tablePath) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required query parameter: path'
        })
    }

    const absolutePath = ensureSafePath(outputRoot, tablePath)
    if (!(await pathExists(absolutePath))) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Table file not found'
        })
    }

    const raw = await fs.readFile(absolutePath, 'utf-8')
    const records = parse(raw, {
        columns: true,
        skip_empty_lines: true,
        bom: true
    }) as Record<string, string>[]

    const headers = records.length > 0 ? Object.keys(records[0]) : []
    const rows = records.slice(0, limit)

    return {
        path: tablePath,
        headers,
        rows,
        totalRows: records.length,
        returnedRows: rows.length,
        truncated: records.length > rows.length
    }
})

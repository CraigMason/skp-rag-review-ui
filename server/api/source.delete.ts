import { promises as fs } from 'node:fs'
import path from 'node:path'

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

function ensureSafePath(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath)
    const relative = path.relative(root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid source path' })
    }
    return resolved
}

async function resolveSourceRoot(configuredPath?: string): Promise<string> {
    if (configuredPath) return path.resolve(process.cwd(), configuredPath)

    const candidates = [
        path.resolve(process.cwd(), '../data/docs/in'),
        path.resolve(process.cwd(), 'data/docs/in'),
        path.resolve(process.cwd(), '../ai-doc-ingest/var/in'),
        path.resolve(process.cwd(), 'ai-doc-ingest/var/in'),
        path.resolve(process.cwd(), 'var/in')
    ]

    for (const candidate of candidates) {
        if (await pathExists(candidate)) return candidate
    }

    return candidates[0]
}

async function resolveOutputRoot(configuredPath?: string): Promise<string> {
    if (configuredPath) return path.resolve(process.cwd(), configuredPath)

    const candidates = [
        path.resolve(process.cwd(), '../data/docs/out'),
        path.resolve(process.cwd(), 'data/docs/out'),
        path.resolve(process.cwd(), '../ai-doc-ingest/var/out'),
        path.resolve(process.cwd(), 'ai-doc-ingest/var/out'),
        path.resolve(process.cwd(), 'var/out')
    ]

    for (const candidate of candidates) {
        if (await pathExists(candidate)) return candidate
    }

    return candidates[0]
}

function outputCandidates(sourcePath: string): string[] {
    const normalized = normalizeRelativePath(sourcePath)
    const base = path.parse(path.posix.basename(normalized)).name
    const dir = path.posix.dirname(normalized)
    const parent = dir === '.' ? '' : dir
    const mirrored = parent ? `${parent}/${base}/${base}.md` : `${base}/${base}.md`
    const flat = `${base}/${base}.md`
    return Array.from(new Set([mirrored, flat]))
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig()
    const sourceRoot = await resolveSourceRoot(
        process.env.SKP_DOCS_IN_DIR || (config.skpDocsInDir as string | undefined)
    )
    const outputRoot = await resolveOutputRoot(
        process.env.SKP_DOCS_OUT_DIR || (config.skpDocsOutDir as string | undefined)
    )

    const body = await readBody<{ source?: string }>(event)
    const source = body?.source ? normalizeRelativePath(body.source) : ''

    if (!source) {
        throw createError({ statusCode: 400, statusMessage: 'Missing source path' })
    }

    const sourceAbsPath = ensureSafePath(sourceRoot, source)
    if (!(await pathExists(sourceAbsPath))) {
        throw createError({ statusCode: 404, statusMessage: 'Source file not found' })
    }

    await fs.unlink(sourceAbsPath)

    let removedOutputDir: string | null = null
    for (const candidate of outputCandidates(source)) {
        const outputMarkdownAbsPath = path.join(outputRoot, candidate)
        if (await pathExists(outputMarkdownAbsPath)) {
            const outputDir = path.dirname(outputMarkdownAbsPath)
            await fs.rm(outputDir, { recursive: true, force: true })
            removedOutputDir = path.relative(outputRoot, outputDir).replaceAll('\\', '/')
            break
        }
    }

    return {
        source,
        deleted: true,
        removedOutputDir
    }
})

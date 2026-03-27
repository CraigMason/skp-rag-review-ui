import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
})

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

async function resolveSourceRoot(configuredPath?: string): Promise<string> {
    if (configuredPath) {
        return path.resolve(process.cwd(), configuredPath)
    }

    const candidates = [
        path.resolve(process.cwd(), '../data/docs/in'),
        path.resolve(process.cwd(), 'data/docs/in'),
        path.resolve(process.cwd(), '../ai-doc-ingest/var/in'),
        path.resolve(process.cwd(), 'ai-doc-ingest/var/in'),
        path.resolve(process.cwd(), 'var/in')
    ]

    for (const candidate of candidates) {
        if (await pathExists(candidate)) {
            return candidate
        }
    }

    return candidates[0]
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

function sourceDir(sourcePath: string): string {
    const dir = path.posix.dirname(sourcePath)
    return dir === '.' ? '' : dir
}

function basenameWithoutExtension(filePath: string): string {
    return path.parse(filePath).name
}

function outputCandidates(sourcePath: string): string[] {
    const normalizedSourcePath = normalizeRelativePath(sourcePath)
    const baseName = basenameWithoutExtension(path.posix.basename(normalizedSourcePath))
    const parentDir = sourceDir(normalizedSourcePath)
    const sourceMirrored = parentDir ? `${parentDir}/${baseName}/${baseName}.md` : `${baseName}/${baseName}.md`
    const flatFallback = `${baseName}/${baseName}.md`

    return Array.from(new Set([sourceMirrored, flatFallback]))
}

async function resolveTablePaths(
    outputRoot: string,
    outputMarkdownPath: string,
    metadataTables: unknown
): Promise<string[]> {
    const markdownDir = path.posix.dirname(outputMarkdownPath)
    const discovered = new Set<string>()

    const tableValues = Array.isArray(metadataTables)
        ? metadataTables.filter((value) => typeof value === 'string') as string[]
        : []

    for (const tableValue of tableValues) {
        const normalized = normalizeRelativePath(tableValue)
        const basename = path.posix.basename(normalized)
        const candidates = [
            normalized,
            `${markdownDir}/_tables/${basename}`,
            `${markdownDir}/${normalized}`
        ]

        for (const candidate of candidates) {
            if (await pathExists(path.join(outputRoot, candidate))) {
                discovered.add(candidate)
                break
            }
        }
    }

    const tableDir = path.join(outputRoot, markdownDir, '_tables')
    if (await pathExists(tableDir)) {
        const entries = await fs.readdir(tableDir, { withFileTypes: true })
        for (const entry of entries) {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.csv') {
                continue
            }

            discovered.add(`${markdownDir}/_tables/${entry.name}`)
        }
    }

    return Array.from(discovered).sort((a, b) => a.localeCompare(b))
}

async function resolveOutputMarkdownPath(sourcePath: string, outputRoot: string): Promise<string | null> {
    for (const candidate of outputCandidates(sourcePath)) {
        if (await pathExists(path.join(outputRoot, candidate))) {
            return candidate
        }
    }

    return null
}

function ensureSafePath(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath)
    const relative = path.relative(root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid source path'
        })
    }
    return resolved
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig()
    const sourceRoot = await resolveSourceRoot(
        process.env.SKP_DOCS_IN_DIR || (config.skpDocsInDir as string | undefined)
    )
    const outputRoot = await resolveOutputRoot(
        process.env.SKP_DOCS_OUT_DIR || (config.skpDocsOutDir as string | undefined)
    )

    const query = getQuery(event)
    const sourceParam = typeof query.source === 'string' ? normalizeRelativePath(query.source) : ''

    if (!sourceParam) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required query parameter: source'
        })
    }

    const sourceAbsolutePath = ensureSafePath(sourceRoot, sourceParam)

    if (!(await pathExists(sourceAbsolutePath))) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Source file not found'
        })
    }

    const sourceStat = await fs.stat(sourceAbsolutePath)
    const outputMarkdownPath = await resolveOutputMarkdownPath(sourceParam, outputRoot)

    if (!outputMarkdownPath) {
        return {
            source: {
                path: sourceParam,
                extension: path.extname(sourceParam).toLowerCase(),
                updatedAt: sourceStat.mtime.toISOString()
            },
            output: {
                exists: false,
                markdownPath: null
            },
            processingStatus: {
                state: 'unprocessed',
                tableCount: 0,
                outputUpdatedAt: null
            },
            metadata: {},
            tables: [],
            markdown: {
                raw: '',
                renderedHtml: ''
            }
        }
    }

    const outputMarkdownAbsolutePath = ensureSafePath(outputRoot, outputMarkdownPath)
    const outputStat = await fs.stat(outputMarkdownAbsolutePath)
    const markdownRaw = await fs.readFile(outputMarkdownAbsolutePath, 'utf-8')
    const parsed = matter(markdownRaw)
    const tables = await resolveTablePaths(outputRoot, outputMarkdownPath, parsed.data?.tables)
    const tableCount = tables.length

    return {
        source: {
            path: sourceParam,
            extension: path.extname(sourceParam).toLowerCase(),
            updatedAt: sourceStat.mtime.toISOString()
        },
        output: {
            exists: true,
            markdownPath: outputMarkdownPath
        },
        processingStatus: {
            state: 'processed',
            tableCount,
            outputUpdatedAt: outputStat.mtime.toISOString()
        },
        metadata: parsed.data || {},
        tables,
        markdown: {
            raw: parsed.content,
            renderedHtml: markdown.render(parsed.content)
        }
    }
})

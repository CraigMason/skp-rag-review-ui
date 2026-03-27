import { promises as fs } from 'node:fs'
import path from 'node:path'

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.html', '.xlsx', '.csv'])
const DEFAULT_MAX_UPLOAD_BYTES = 250 * 1024 * 1024

type UploadResult = {
    uploaded: Array<{
        fileName: string
        relativePath: string
        size: number
    }>
    rejected: Array<{
        fileName: string
        reason: string
    }>
    targetDir: string
}

function normalizeRelativePath(input: string): string {
    return input.replaceAll('\\', '/').replace(/^\/+/, '')
}

function parseTargetDir(input: string): string {
    const normalized = normalizeRelativePath(input).trim()
    if (!normalized) {
        return ''
    }

    const pieces = normalized.split('/').filter(Boolean)
    if (pieces.some((piece) => piece === '.' || piece === '..')) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid target directory'
        })
    }

    return pieces.join('/')
}

function ensureSafePath(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath)
    const relative = path.relative(root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid target path'
        })
    }
    return resolved
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

export default defineEventHandler(async (event): Promise<UploadResult> => {
    const config = useRuntimeConfig()
    const sourceRoot = await resolveSourceRoot(
        process.env.SKP_DOCS_IN_DIR || (config.skpDocsInDir as string | undefined)
    )

    const body = await readMultipartFormData(event)
    if (!body || body.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'No multipart form data received'
        })
    }

    const maxUploadBytesEnv = Number.parseInt(process.env.SKP_UPLOAD_MAX_BYTES || '', 10)
    const maxUploadBytes = Number.isFinite(maxUploadBytesEnv) ? maxUploadBytesEnv : DEFAULT_MAX_UPLOAD_BYTES

    let targetDir = ''
    const uploaded: UploadResult['uploaded'] = []
    const rejected: UploadResult['rejected'] = []
    const requestFileNames = new Set<string>()

    for (const part of body) {
        if (part.name === 'targetDir') {
            targetDir = parseTargetDir(part.data.toString('utf-8'))
        }
    }

    const targetDirectoryAbsolutePath = ensureSafePath(sourceRoot, targetDir)
    await fs.mkdir(targetDirectoryAbsolutePath, { recursive: true })

    for (const part of body) {
        if (!part.filename) {
            continue
        }

        const originalFileName = path.basename(part.filename)
        const extension = path.extname(originalFileName).toLowerCase()

        if (!ALLOWED_EXTENSIONS.has(extension)) {
            rejected.push({
                fileName: originalFileName,
                reason: `Unsupported file extension '${extension || '(none)'}'`
            })
            continue
        }

        if (part.data.byteLength > maxUploadBytes) {
            rejected.push({
                fileName: originalFileName,
                reason: `File exceeds maximum size of ${maxUploadBytes} bytes`
            })
            continue
        }

        if (requestFileNames.has(originalFileName)) {
            rejected.push({
                fileName: originalFileName,
                reason: 'Duplicate filename in upload request'
            })
            continue
        }
        requestFileNames.add(originalFileName)

        const destinationRelativePath = targetDir
            ? `${targetDir}/${originalFileName}`
            : originalFileName
        const destinationAbsolutePath = ensureSafePath(sourceRoot, destinationRelativePath)

        if (await pathExists(destinationAbsolutePath)) {
            rejected.push({
                fileName: originalFileName,
                reason: 'Duplicate filename already exists in target folder'
            })
            continue
        }

        await fs.writeFile(destinationAbsolutePath, part.data)
        uploaded.push({
            fileName: originalFileName,
            relativePath: destinationRelativePath,
            size: part.data.byteLength
        })
    }

    return {
        uploaded,
        rejected,
        targetDir
    }
})

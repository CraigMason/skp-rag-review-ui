import { promises as fs } from 'node:fs'
import path from 'node:path'

type ProcessingStatus = {
    state: 'processed' | 'unprocessed'
    outputMarkdownPath: string
    tableCount: number
    outputUpdatedAt: string | null
}

type TreeNode = {
    name: string
    path: string
    type: 'file' | 'directory'
    processingStatus?: ProcessingStatus
    warnings?: string[]
    children?: TreeNode[]
}

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.html', '.xlsx', '.csv'])

function isHiddenOrSystem(name: string): boolean {
    return name.startsWith('.')
}

function sourceDir(sourcePath: string): string {
    const dir = path.posix.dirname(sourcePath)
    return dir === '.' ? '' : dir
}

function basenameWithoutExtension(fileName: string): string {
    return path.parse(fileName).name
}

function normalizeRelativePath(input: string): string {
    return input.replaceAll('\\', '/').replace(/^\/+/, '')
}

function toOutputCandidates(sourcePath: string): string[] {
    const normalizedSourcePath = normalizeRelativePath(sourcePath)
    const baseName = basenameWithoutExtension(path.posix.basename(normalizedSourcePath))
    const parentDir = sourceDir(normalizedSourcePath)

    const pathWithSourceDir = parentDir
        ? `${parentDir}/${baseName}/${baseName}.md`
        : `${baseName}/${baseName}.md`

    const fallbackFlatPath = `${baseName}/${baseName}.md`

    return Array.from(new Set([pathWithSourceDir, fallbackFlatPath]))
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

function collectFileNodes(nodes: TreeNode[]): TreeNode[] {
    const result: TreeNode[] = []

    for (const node of nodes) {
        if (node.type === 'file') {
            result.push(node)
            continue
        }

        if (node.children?.length) {
            result.push(...collectFileNodes(node.children))
        }
    }

    return result
}

async function countCsvFiles(targetDir: string): Promise<number> {
    if (!(await pathExists(targetDir))) {
        return 0
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.csv').length
}

async function resolveOutputMarkdownPath(sourcePath: string, outputRoot: string): Promise<string | null> {
    for (const candidate of toOutputCandidates(sourcePath)) {
        const candidateAbsolutePath = path.join(outputRoot, candidate)
        if (await pathExists(candidateAbsolutePath)) {
            return candidate
        }
    }

    return null
}

async function enrichFileStatuses(nodes: TreeNode[], outputRoot: string): Promise<void> {
    const fileNodes = collectFileNodes(nodes)
    const basenameCounts = new Map<string, number>()

    for (const node of fileNodes) {
        const baseName = basenameWithoutExtension(node.name)
        basenameCounts.set(baseName, (basenameCounts.get(baseName) || 0) + 1)
    }

    await Promise.all(fileNodes.map(async (node) => {
        const baseName = basenameWithoutExtension(node.name)
        const outputMarkdownPath = await resolveOutputMarkdownPath(node.path, outputRoot)
        const resolvedOutputPath = outputMarkdownPath || toOutputCandidates(node.path)[0]
        const outputAbsolutePath = path.join(outputRoot, resolvedOutputPath)
        const outputExists = await pathExists(outputAbsolutePath)
        const tableDir = path.join(outputRoot, path.posix.dirname(resolvedOutputPath), '_tables')
        const tableCount = await countCsvFiles(tableDir)

        let outputUpdatedAt: string | null = null
        if (outputExists) {
            const stat = await fs.stat(outputAbsolutePath)
            outputUpdatedAt = stat.mtime.toISOString()
        }

        node.processingStatus = {
            state: outputExists ? 'processed' : 'unprocessed',
            outputMarkdownPath: resolvedOutputPath,
            tableCount,
            outputUpdatedAt
        }

        if ((basenameCounts.get(baseName) || 0) > 1) {
            node.warnings = [
                `Ambiguous basename collision for '${baseName}'. Output mapping may be shared across multiple source paths.`
            ]
        }
    }))
}

async function buildTreeNode(currentAbsPath: string, currentRelPath: string): Promise<TreeNode | null> {
    const name = path.basename(currentAbsPath)
    if (isHiddenOrSystem(name)) {
        return null
    }

    const stat = await fs.stat(currentAbsPath)

    if (stat.isFile()) {
        const ext = path.extname(name).toLowerCase()
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return null
        }

        return {
            name,
            path: currentRelPath,
            type: 'file'
        }
    }

    if (!stat.isDirectory()) {
        return null
    }

    const entries = await fs.readdir(currentAbsPath, { withFileTypes: true })
    const children: TreeNode[] = []

    for (const entry of entries) {
        if (isHiddenOrSystem(entry.name)) {
            continue
        }

        const entryAbsPath = path.join(currentAbsPath, entry.name)
        const entryRelPath = currentRelPath ? `${currentRelPath}/${entry.name}` : entry.name
        const child = await buildTreeNode(entryAbsPath, entryRelPath)

        if (child) {
            children.push(child)
        }
    }

    children.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
    })

    if (children.length === 0) {
        return null
    }

    return {
        name,
        path: currentRelPath,
        type: 'directory',
        children
    }
}

export default defineEventHandler(async () => {
    const config = useRuntimeConfig()
    const sourceRoot = await resolveSourceRoot(
        process.env.SKP_DOCS_IN_DIR || (config.skpDocsInDir as string | undefined)
    )
    const outputRoot = await resolveOutputRoot(
        process.env.SKP_DOCS_OUT_DIR || (config.skpDocsOutDir as string | undefined)
    )

    if (!(await pathExists(sourceRoot))) {
        return {
            root: '',
            nodes: [] as TreeNode[]
        }
    }

    const entries = await fs.readdir(sourceRoot, { withFileTypes: true })
    const nodes: TreeNode[] = []

    for (const entry of entries) {
        if (isHiddenOrSystem(entry.name)) {
            continue
        }

        const entryAbsPath = path.join(sourceRoot, entry.name)
        const child = await buildTreeNode(entryAbsPath, entry.name)
        if (child) {
            nodes.push(child)
        }
    }

    nodes.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
    })

    await enrichFileStatuses(nodes, outputRoot)

    return {
        root: sourceRoot,
        nodes
    }
})

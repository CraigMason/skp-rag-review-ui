<script setup lang="ts">
type TreeNode = {
    name: string
    path: string
    type: 'file' | 'directory'
    processingStatus?: {
        state: 'processed' | 'unprocessed'
        outputMarkdownPath: string
        tableCount: number
        outputUpdatedAt: string | null
    }
    warnings?: string[]
    children?: TreeNode[]
}

type UploadResponse = {
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

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024

const open = ref(true)
const selectedSourcePath = useState<string | null>('selected-source-path', () => null)
const selectedTargetFolderPath = useState<string>('selected-target-folder-path', () => '')
const treeRefreshNonce = useState<number>('tree-refresh-nonce', () => 0)
const activeDropFolderPath = ref<string | null>(null)
const isPageDropActive = ref(false)
const isUploading = ref(false)
const toast = useToast()

const { data, pending, error, refresh } = await useFetch<{ nodes: TreeNode[] }>('/api/get')
let removeDocumentDragHandlers: (() => void) | null = null

function clearDragState(): void {
    activeDropFolderPath.value = null
    isPageDropActive.value = false
}

function getFolderTargetFromEvent(event: DragEvent): string | null {
    const target = event.target
    if (!(target instanceof Element)) {
        return null
    }

    const folderElement = target.closest('[data-folder-path]')
    if (!(folderElement instanceof Element)) {
        return null
    }

    return folderElement.getAttribute('data-folder-path')
}

function notifyUploadResult(result: UploadResponse): void {
    if (result.uploaded.length > 0) {
        toast.add({
            title: `Uploaded ${result.uploaded.length} file${result.uploaded.length === 1 ? '' : 's'}`,
            description: result.targetDir
                ? `Saved to ${result.targetDir}`
                : 'Saved to source root',
            color: 'success'
        })
    }

    if (result.rejected.length > 0) {
        const firstFailure = result.rejected[0]
        toast.add({
            title: `${result.rejected.length} file${result.rejected.length === 1 ? ' was' : 's were'} rejected`,
            description: `${firstFailure.fileName}: ${firstFailure.reason}`,
            color: 'warning'
        })
    }
}

async function uploadFiles(files: File[], targetDir: string): Promise<void> {
    if (files.length === 0 || isUploading.value) {
        return
    }

    const oversized = files.filter(file => file.size > MAX_UPLOAD_BYTES)
    if (oversized.length > 0) {
        toast.add({
            title: 'Upload blocked',
            description: `${oversized[0].name} exceeds the 250MB upload limit.`,
            color: 'warning'
        })
        clearDragState()
        return
    }

    isUploading.value = true

    try {
        const formData = new FormData()
        formData.append('targetDir', targetDir)
        for (const file of files) {
            formData.append('files', file, file.name)
        }

        const result = await $fetch<UploadResponse>('/api/upload', {
            method: 'POST',
            body: formData
        })

        notifyUploadResult(result)

        if (result.uploaded.length > 0) {
            await refresh()
        }
    } catch (uploadError) {
        toast.add({
            title: 'Upload failed',
            description: uploadError instanceof Error ? uploadError.message : 'Unable to upload files.',
            color: 'error'
        })
    } finally {
        isUploading.value = false
        clearDragState()
    }
}

function onSelectFile(sourcePath: string): void {
    selectedSourcePath.value = sourcePath
}

function onFolderDragOver(targetDir: string): void {
    activeDropFolderPath.value = targetDir
    selectedTargetFolderPath.value = targetDir
    isPageDropActive.value = true
}

async function onFolderDrop(payload: { files: File[]; targetDir: string }): Promise<void> {
    selectedTargetFolderPath.value = payload.targetDir
    await uploadFiles(payload.files, payload.targetDir)
}

function onPageDragOver(event: DragEvent): void {
    event.preventDefault()
    isPageDropActive.value = true

    const hoveredFolder = getFolderTargetFromEvent(event)
    if (hoveredFolder) {
        activeDropFolderPath.value = hoveredFolder
        selectedTargetFolderPath.value = hoveredFolder
        return
    }

    activeDropFolderPath.value = null
    selectedTargetFolderPath.value = ''
}

function onPageDragLeave(event: DragEvent): void {
    const leftWindow = event.clientX <= 0
        || event.clientY <= 0
        || event.clientX >= window.innerWidth
        || event.clientY >= window.innerHeight

    if (leftWindow) {
        clearDragState()
        return
    }

    if (event.currentTarget === event.target) {
        clearDragState()
    }
}

async function onPageDrop(event: DragEvent): Promise<void> {
    event.preventDefault()

    const files = Array.from(event.dataTransfer?.files || [])
    if (files.length === 0) {
        clearDragState()
        return
    }

    const targetDir = getFolderTargetFromEvent(event) || activeDropFolderPath.value || ''
    selectedTargetFolderPath.value = targetDir
    await uploadFiles(files, targetDir)
}

onMounted(() => {
    const onDocumentDragOver = (event: DragEvent) => {
        if (event.defaultPrevented) {
            return
        }

        event.preventDefault()
        isPageDropActive.value = true

        const hoveredFolder = getFolderTargetFromEvent(event)
        if (hoveredFolder) {
            activeDropFolderPath.value = hoveredFolder
            selectedTargetFolderPath.value = hoveredFolder
            return
        }

        activeDropFolderPath.value = null
        selectedTargetFolderPath.value = ''
    }

    const onDocumentDrop = (event: DragEvent) => {
        if (event.defaultPrevented) {
            return
        }

        void onPageDrop(event)
    }

    document.addEventListener('dragover', onDocumentDragOver)
    document.addEventListener('drop', onDocumentDrop)

    removeDocumentDragHandlers = () => {
        document.removeEventListener('dragover', onDocumentDragOver)
        document.removeEventListener('drop', onDocumentDrop)
    }
})

onBeforeUnmount(() => {
    removeDocumentDragHandlers?.()
    removeDocumentDragHandlers = null
})

watch(treeRefreshNonce, async () => {
    await refresh()
})
</script>

<template>
    <div
        class="relative min-h-screen"
        @dragover="onPageDragOver"
        @dragleave="onPageDragLeave"
        @drop="onPageDrop"
    >
        <div
            v-if="isPageDropActive"
            class="pointer-events-none absolute inset-0 z-40 flex items-start justify-center bg-primary/10 p-4"
        >
            <div class="rounded border border-primary/50 bg-default px-4 py-2 text-sm font-medium text-primary">
                Drop files to upload {{ activeDropFolderPath ? `to ${activeDropFolderPath}` : 'to root' }}
            </div>
        </div>

        <UDashboardGroup unit="rem">
            <UDashboardSidebar
                id="default"
                v-model:open="open"
                collapsible
                resizable
                class="bg-elevated/25"
                :ui="{ header: 'border-b border-default', body: 'p-3' }"
            >
                <template #header>
                    <div class="flex items-center justify-between gap-2">
                        <p class="text-sm font-semibold">
                            Source Files
                        </p>
                        <UButton
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            :loading="pending || isUploading"
                            @click="refresh()"
                        />
                    </div>
                </template>

                <template #default>
                    <div v-if="pending" class="text-sm text-muted">
                        Loading source tree...
                    </div>
                    <UAlert
                        v-else-if="error"
                        color="error"
                        variant="subtle"
                        title="Failed to load source tree"
                        :description="error.message"
                    />
                    <div v-else class="space-y-2">
                        <p class="text-xs text-muted">
                            Drag files here to upload to root or drop onto a folder.
                        </p>
                        <SourceTree
                            :nodes="data?.nodes || []"
                            :selected-source-path="selectedSourcePath"
                            :active-drop-folder-path="activeDropFolderPath"
                            @select-file="onSelectFile"
                            @upload-drop="onFolderDrop"
                            @folder-drag-over="onFolderDragOver"
                        />
                    </div>
                </template>
            </UDashboardSidebar>

            <slot />
        </UDashboardGroup>
    </div>
</template>

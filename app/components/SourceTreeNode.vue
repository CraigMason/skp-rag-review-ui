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

const props = defineProps<{
    node: TreeNode
    selectedSourcePath: string | null
    activeDropFolderPath: string | null
    parentDirectoryPath: string
}>()

const emit = defineEmits<{
    selectFile: [sourcePath: string]
    uploadDrop: [payload: { files: File[]; targetDir: string }]
    folderDragOver: [targetDir: string]
}>()

const isDirectory = computed(() => props.node.type === 'directory')
const isSelected = computed(() => props.selectedSourcePath === props.node.path)
const isDropTarget = computed(() => isDirectory.value && props.activeDropFolderPath === props.node.path)
const uploadTargetDir = computed(() => {
    if (isDirectory.value) {
        return props.node.path
    }
    return props.parentDirectoryPath
})

function onFileClick(): void {
    if (props.node.type !== 'file') {
        return
    }

    emit('selectFile', props.node.path)
}

function onFolderDragOver(event: DragEvent): void {
    if (!isDirectory.value) {
        return
    }

    event.preventDefault()
    event.stopPropagation()
    emit('folderDragOver', props.node.path)
}

function onDrop(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()

    const files = Array.from(event.dataTransfer?.files || [])
    if (files.length === 0) {
        return
    }

    emit('uploadDrop', {
        files,
        targetDir: uploadTargetDir.value
    })
}
</script>

<template>
    <li class="space-y-1">
        <details
            v-if="isDirectory"
            open
            class="rounded"
            data-folder-drop="true"
            :data-folder-path="node.path"
            :class="isDropTarget ? 'bg-primary/10 ring-1 ring-primary/50' : ''"
            @dragover="onFolderDragOver"
            @drop="onDrop"
        >
            <summary
                class="cursor-pointer list-none rounded px-2 py-1 text-sm text-highlighted hover:bg-elevated/40"
                data-folder-drop="true"
                :data-folder-path="node.path"
                @dragover="onFolderDragOver"
                @drop="onDrop"
            >
                <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-folder" class="size-4" />
                    <span class="truncate">{{ node.name }}</span>
                </div>
            </summary>

            <ul class="ml-3 border-l border-default pl-2">
                <SourceTreeNode
                    v-for="child in node.children || []"
                    :key="child.path"
                    :node="child"
                    :selected-source-path="selectedSourcePath"
                    :active-drop-folder-path="activeDropFolderPath"
                    :parent-directory-path="node.path"
                    @select-file="emit('selectFile', $event)"
                    @upload-drop="emit('uploadDrop', $event)"
                    @folder-drag-over="emit('folderDragOver', $event)"
                />
            </ul>
        </details>

        <button
            v-else
            type="button"
            class="w-full rounded px-2 py-1 text-left text-sm"
            :class="isSelected ? 'bg-elevated text-highlighted' : 'text-toned hover:bg-elevated/40'"
            @click="onFileClick"
            @dragover.prevent.stop
            @drop="onDrop"
        >
            <div class="flex items-center gap-2">
                <UIcon name="i-lucide-file" class="size-4" />
                <span class="truncate">{{ node.name }}</span>
                <span class="ml-auto text-[11px] text-muted">
                    {{ node.processingStatus?.state === 'processed' ? 'Processed' : 'Unprocessed' }}
                </span>
            </div>
        </button>
    </li>
</template>

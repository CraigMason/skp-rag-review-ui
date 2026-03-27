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

defineProps<{
    nodes: TreeNode[]
    selectedSourcePath: string | null
    activeDropFolderPath: string | null
}>()

const emit = defineEmits<{
    selectFile: [sourcePath: string]
    uploadDrop: [payload: { files: File[]; targetDir: string }]
    folderDragOver: [targetDir: string]
}>()
</script>

<template>
    <ul class="space-y-1">
        <SourceTreeNode
            v-for="node in nodes"
            :key="node.path"
            :node="node"
            :selected-source-path="selectedSourcePath"
            :active-drop-folder-path="activeDropFolderPath"
            parent-directory-path=""
            @select-file="emit('selectFile', $event)"
            @upload-drop="emit('uploadDrop', $event)"
            @folder-drag-over="emit('folderDragOver', $event)"
        />
    </ul>
</template>

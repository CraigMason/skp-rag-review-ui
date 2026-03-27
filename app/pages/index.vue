<script setup lang="ts">
type DocumentPayload = {
    source: {
        path: string
        extension: string
        updatedAt: string
    }
    output: {
        exists: boolean
        markdownPath: string | null
    }
    processingStatus: {
        state: 'processed' | 'unprocessed'
        tableCount: number
        outputUpdatedAt: string | null
    }
    metadata: Record<string, unknown>
    tables: string[]
    markdown: {
        raw: string
        renderedHtml: string
    }
}

type TablePayload = {
    path: string
    headers: string[]
    rows: Record<string, string>[]
    totalRows: number
    returnedRows: number
    truncated: boolean
}

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

const selectedSourcePath = useState<string | null>('selected-source-path', () => null)
const treeRefreshNonce = useState<number>('tree-refresh-nonce', () => 0)
const toast = useToast()

const documentData = ref<DocumentPayload | null>(null)
const pending = ref(false)
const errorMessage = ref<string | null>(null)
const deleteModalOpen = ref(false)
const deletingFile = ref(false)
const processing = ref(false)
const lastProcessResult = ref<ConvertResponse | null>(null)
const statusExpanded = ref(true)
const metadataExpanded = ref(false)
const selectedTablePath = ref<string | null>(null)
const tableData = ref<TablePayload | null>(null)
const tablePending = ref(false)
const tableErrorMessage = ref<string | null>(null)

const metadataEntries = computed(() => {
    const metadata = documentData.value?.metadata || {}
    return Object.entries(metadata)
})

const availableTables = computed(() => documentData.value?.tables || [])

const tableTabs = computed(() => {
    return availableTables.value.map((tablePath) => ({
        path: tablePath,
        label: tablePath.split('/').pop() || tablePath
    }))
})

function formatMetadataValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null'
    }

    if (Array.isArray(value)) {
        return value.join(', ')
    }

    if (typeof value === 'object') {
        return JSON.stringify(value)
    }

    return String(value)
}

function formatDate(value: string | null): string {
    if (!value) {
        return 'n/a'
    }

    return new Date(value).toLocaleString()
}

async function loadDocument(): Promise<void> {
    if (!selectedSourcePath.value) {
        documentData.value = null
        errorMessage.value = null
        selectedTablePath.value = null
        tableData.value = null
        tableErrorMessage.value = null
        return
    }

    pending.value = true
    errorMessage.value = null

    try {
        documentData.value = await $fetch<DocumentPayload>('/api/document', {
            query: {
                source: selectedSourcePath.value
            }
        })
        selectedTablePath.value = documentData.value.tables[0] || null
    } catch (error) {
        documentData.value = null
        errorMessage.value = error instanceof Error ? error.message : 'Failed to load document output.'
        selectedTablePath.value = null
        tableData.value = null
        tableErrorMessage.value = null
    } finally {
        pending.value = false
    }
}

async function loadTable(): Promise<void> {
    if (!selectedTablePath.value) {
        tableData.value = null
        tableErrorMessage.value = null
        return
    }

    tablePending.value = true
    tableErrorMessage.value = null

    try {
        tableData.value = await $fetch<TablePayload>('/api/table', {
            query: {
                path: selectedTablePath.value,
                limit: 1000
            }
        })
    } catch (error) {
        tableData.value = null
        tableErrorMessage.value = error instanceof Error ? error.message : 'Failed to load table data.'
    } finally {
        tablePending.value = false
    }
}

watch(selectedSourcePath, loadDocument, { immediate: true })
watch(selectedTablePath, loadTable, { immediate: true })

async function deleteSelectedFile(): Promise<void> {
    if (!selectedSourcePath.value || deletingFile.value) {
        return
    }

    deletingFile.value = true

    try {
        await $fetch('/api/source', {
            method: 'DELETE',
            body: {
                source: selectedSourcePath.value
            }
        })

        toast.add({
            title: 'File deleted',
            description: selectedSourcePath.value,
            color: 'success'
        })

        deleteModalOpen.value = false
        selectedSourcePath.value = null
        treeRefreshNonce.value += 1
    } catch (error) {
        toast.add({
            title: 'Delete failed',
            description: error instanceof Error ? error.message : 'Unable to delete file.',
            color: 'error'
        })
    } finally {
        deletingFile.value = false
    }
}

async function processSelectedFile(): Promise<void> {
    if (!selectedSourcePath.value || processing.value) {
        return
    }

    processing.value = true

    try {
        const result = await $fetch<ConvertResponse>('/api/convert', {
            method: 'POST',
            body: {
                source: selectedSourcePath.value
            }
        })

        lastProcessResult.value = result

        if (result.success) {
            toast.add({
                title: 'Processing complete',
                description: `Finished in ${(result.durationMs / 1000).toFixed(1)}s`,
                color: 'success'
            })

            treeRefreshNonce.value += 1
            await loadDocument()
        } else {
            toast.add({
                title: 'Processing failed',
                description: result.stderr || 'The pipeline exited with an error.',
                color: 'error'
            })
        }
    } catch (error) {
        toast.add({
            title: 'Processing failed',
            description: error instanceof Error ? error.message : 'Unable to process selected file.',
            color: 'error'
        })
    } finally {
        processing.value = false
    }
}
</script>

<template>
    <UDashboardPanel id="review-home">
        <template #header>
            <UDashboardNavbar title="Document Review">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
                <template #right>
                    <UButton
                        label="Process"
                        color="primary"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-play"
                        :loading="processing"
                        :disabled="!selectedSourcePath || deletingFile"
                        @click="processSelectedFile"
                    />
                    <UModal
                        v-model:open="deleteModalOpen"
                        title="Delete selected file"
                        :description="`Delete ${selectedSourcePath || 'this file'} and related output artifacts? This action cannot be undone.`"
                    >
                        <UButton
                            label="Delete File"
                            color="error"
                            variant="soft"
                            size="sm"
                            icon="i-lucide-trash-2"
                            :disabled="!selectedSourcePath || deletingFile"
                        />

                        <template #body>
                            <div class="flex justify-end gap-2">
                                <UButton
                                    label="Cancel"
                                    color="neutral"
                                    variant="subtle"
                                    :disabled="deletingFile"
                                    @click="deleteModalOpen = false"
                                />
                                <UButton
                                    label="Delete"
                                    color="error"
                                    :loading="deletingFile"
                                    @click="deleteSelectedFile"
                                />
                            </div>
                        </template>
                    </UModal>
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UAlert
                v-if="!selectedSourcePath"
                color="neutral"
                variant="subtle"
                title="No file selected"
                description="Select a source file from the left tree to review processing details and markdown output."
            />

            <UAlert
                v-else-if="errorMessage"
                color="error"
                variant="subtle"
                title="Failed to load document"
                :description="errorMessage"
            />

            <div v-else class="space-y-4">
                <UAlert
                    v-if="lastProcessResult"
                    :color="lastProcessResult.success ? 'success' : 'error'"
                    variant="subtle"
                    :title="lastProcessResult.success ? 'Last process run succeeded' : 'Last process run failed'"
                    :description="`Mode: ${lastProcessResult.mode}. Duration: ${(lastProcessResult.durationMs / 1000).toFixed(1)}s. Exit code: ${lastProcessResult.exitCode}.`"
                />

                <UCard>
                    <template #header>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="flex flex-wrap items-center gap-2">
                                <h2 class="text-base font-semibold">
                                    Status Overview
                                </h2>
                                <UBadge
                                    :color="documentData?.processingStatus.state === 'processed' ? 'success' : 'warning'"
                                    variant="soft"
                                >
                                    {{ documentData?.processingStatus.state || 'unknown' }}
                                </UBadge>
                                <UBadge color="neutral" variant="outline">
                                    {{ documentData?.source.path }}
                                </UBadge>
                            </div>
                            <UButton
                                :label="statusExpanded ? 'Condense' : 'Expand'"
                                color="neutral"
                                variant="outline"
                                size="xs"
                                :icon="statusExpanded ? 'i-lucide-chevrons-up' : 'i-lucide-chevrons-down'"
                                @click="statusExpanded = !statusExpanded"
                            />
                        </div>
                    </template>

                    <div v-if="pending" class="text-sm text-muted">
                        Loading status and metadata...
                    </div>

                    <div v-else-if="documentData && statusExpanded" class="space-y-4">
                        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div class="rounded border border-default p-3">
                                <p class="text-xs text-muted">
                                    Source Extension
                                </p>
                                <p class="text-sm font-medium">
                                    {{ documentData.source.extension }}
                                </p>
                            </div>
                            <div class="rounded border border-default p-3">
                                <p class="text-xs text-muted">
                                    Output Markdown
                                </p>
                                <p class="text-sm font-medium break-all">
                                    {{ documentData.output.markdownPath || 'not available' }}
                                </p>
                            </div>
                            <div class="rounded border border-default p-3">
                                <p class="text-xs text-muted">
                                    Extracted Tables
                                </p>
                                <p class="text-sm font-medium">
                                    {{ documentData.processingStatus.tableCount }}
                                </p>
                            </div>
                            <div class="rounded border border-default p-3">
                                <p class="text-xs text-muted">
                                    Output Updated
                                </p>
                                <p class="text-sm font-medium">
                                    {{ formatDate(documentData.processingStatus.outputUpdatedAt) }}
                                </p>
                            </div>
                        </div>

                        <div class="rounded border border-default p-3">
                            <div class="mb-2 flex items-center justify-between gap-2">
                                <p class="text-xs font-semibold uppercase tracking-wide text-muted">
                                    Output Metadata
                                </p>
                                <UButton
                                    :label="metadataExpanded ? 'Hide' : 'Show'"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :icon="metadataExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                                    @click="metadataExpanded = !metadataExpanded"
                                />
                            </div>
                            <div v-if="metadataExpanded && metadataEntries.length === 0" class="text-sm text-muted">
                                No metadata found.
                            </div>
                            <div v-else-if="metadataExpanded" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                <div
                                    v-for="[key, value] in metadataEntries"
                                    :key="key"
                                    class="rounded border border-default p-2"
                                >
                                    <p class="text-xs text-muted">
                                        {{ key }}
                                    </p>
                                    <p class="text-sm break-words">
                                        {{ formatMetadataValue(value) }}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-else-if="documentData" class="text-sm text-muted">
                        Status details are condensed.
                    </div>
                </UCard>

                <div class="grid gap-4 lg:grid-cols-2">
                    <UCard>
                        <template #header>
                            <h3 class="text-sm font-semibold">
                                Raw Markdown
                            </h3>
                        </template>
                        <div class="max-h-[60vh] overflow-auto rounded border border-default bg-elevated/30 p-3">
                            <pre class="whitespace-pre-wrap break-words text-xs">{{ documentData?.markdown.raw || '' }}</pre>
                        </div>
                    </UCard>

                    <UCard>
                        <template #header>
                            <h3 class="text-sm font-semibold">
                                Rendered Markdown
                            </h3>
                        </template>
                        <div class="max-h-[60vh] overflow-auto rounded border border-default p-4">
                            <div class="space-y-3 text-sm" v-html="documentData?.markdown.renderedHtml || ''" />
                        </div>
                    </UCard>
                </div>

                <UCard>
                    <template #header>
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <h3 class="text-sm font-semibold">
                                Extracted Tables
                            </h3>
                            <p v-if="tableData" class="text-xs text-muted">
                                {{ tableData.returnedRows }} of {{ tableData.totalRows }} rows
                                <span v-if="tableData.truncated">(truncated)</span>
                            </p>
                        </div>
                    </template>

                    <div v-if="availableTables.length === 0" class="text-sm text-muted">
                        No extracted tables were found for this file.
                    </div>

                    <div v-else class="mb-3 flex flex-wrap gap-2 border-b border-default pb-3">
                        <UButton
                            v-for="tab in tableTabs"
                            :key="tab.path"
                            :color="selectedTablePath === tab.path ? 'primary' : 'neutral'"
                            :variant="selectedTablePath === tab.path ? 'solid' : 'outline'"
                            size="xs"
                            @click="selectedTablePath = tab.path"
                        >
                            {{ tab.label }}
                        </UButton>
                    </div>

                    <div v-if="tablePending" class="text-sm text-muted">
                        Loading table data...
                    </div>

                    <UAlert
                        v-else-if="tableErrorMessage"
                        color="error"
                        variant="subtle"
                        title="Failed to load table"
                        :description="tableErrorMessage"
                    />

                    <div v-else-if="tableData" class="space-y-2">
                        <div class="max-h-[40vh] overflow-auto rounded border border-default">
                            <table class="min-w-full border-collapse text-sm">
                                <thead class="sticky top-0 bg-elevated/90 backdrop-blur">
                                    <tr>
                                        <th
                                            v-for="header in tableData.headers"
                                            :key="header"
                                            class="border-b border-default px-3 py-2 text-left font-medium"
                                        >
                                            {{ header }}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr
                                        v-for="(row, rowIndex) in tableData.rows"
                                        :key="`${tableData.path}-${rowIndex}`"
                                        class="odd:bg-elevated/20"
                                    >
                                        <td
                                            v-for="header in tableData.headers"
                                            :key="`${rowIndex}-${header}`"
                                            class="border-b border-default px-3 py-2 align-top"
                                        >
                                            {{ row[header] }}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </UCard>
            </div>
        </template>
    </UDashboardPanel>
</template>

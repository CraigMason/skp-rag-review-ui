import treeHandler from './tree.get'

export default defineEventHandler(async (event) => {
    const result = await treeHandler(event)

    return {
        nodes: result.nodes || []
    }
})

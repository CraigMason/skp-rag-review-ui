// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    modules: [
        '@nuxt/eslint',
        '@nuxt/ui',
        '@vueuse/nuxt'
    ],

    devtools: {
        enabled: true
    },

    css: ['~/assets/css/main.css'],

    runtimeConfig: {
        skpDocsInDir: process.env.SKP_DOCS_IN_DIR || '../data/docs/in',
        skpDocsOutDir: process.env.SKP_DOCS_OUT_DIR || '../data/docs/out',
        skpIngestWorkdir: process.env.SKP_INGEST_WORKDIR || '../ai-doc-ingest',
        skpIngestApiUrl: process.env.SKP_INGEST_API_URL || '',
        skpConvertTimeoutMs: process.env.SKP_CONVERT_TIMEOUT_MS || '600000'
    },

    routeRules: {
        '/api/**': {
            cors: true
        }
    },

    compatibilityDate: '2024-07-11',

    eslint: {
        config: {
            stylistic: {
                commaDangle: 'never',
                braceStyle: '1tbs'
            }
        }
    }
})

// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
    rules: {
        '@stylistic/indent': 'off',
        'indent': ['error', 4, { SwitchCase: 1 }],
        'vue/script-indent': ['error', 4, { baseIndent: 0, switchCase: 1 }],
        'vue/html-indent': ['error', 4, {
            attribute: 1,
            baseIndent: 1,
            closeBracket: 0,
            alignAttributesVertically: true
        }],
        'vue/no-multiple-template-root': 'off',
        'vue/max-attributes-per-line': ['error', { singleline: 3 }]
    }
})

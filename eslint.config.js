const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const pluginVue = require('eslint-plugin-vue');
const stylistic = require('@stylistic/eslint-plugin');
const globals = require('globals');

/**
 * Rewrites a rule entry so it reports at "warn" severity, keeping any options.
 * Disabled rules stay disabled.
 */
const asWarning = (entry) => {
    if (entry === 'off' || entry === 0) {
        return entry;
    }

    return Array.isArray(entry) ? ['warn', ...entry.slice(1)] : 'warn';
};

/**
 * Reproduces tslint's `defaultSeverity: "warning"`: nothing the linter reports
 * fails the command, so `npm run lint` stays advisory as it was before.
 */
const asWarnings = (configs) => configs.map((config) => (
    config.rules
        ? {
            ...config,
            rules: Object.fromEntries(
                Object.entries(config.rules).map(([rule, entry]) => [rule, asWarning(entry)]),
            ),
        }
        : config
));

module.exports = tseslint.config(
    {
        ignores: [
            'dist/**',
            'dist_electron/**',
            'build/**',
            // electron-vite's build output, the Phase B counterpart of the
            // three above. Without this, `npm run lint` reports on generated
            // bundles and its warning count moves with every probe build.
            'out/**',
            'migrations/**',
            'public/**',
            'src/background.ts',
            '*.config.js',
        ],
    },

    asWarnings([
        js.configs.recommended,
        ...tseslint.configs.recommended,
        ...pluginVue.configs['flat/vue2-essential'],
    ]),

    {
        files: ['**/*.{ts,vue}'],
        plugins: {
            '@stylistic': stylistic,
        },
        languageOptions: {
            // Renderer views run with nodeIntegration, so both sets apply.
            globals: {
                ...globals.browser,
                ...globals.node,
                // Injected by vue-cli-plugin-electron-builder.
                __static: 'readonly',
            },
            parserOptions: {
                // .vue files are read by vue-eslint-parser, which delegates
                // <script lang="ts"> to the TypeScript parser.
                parser: tseslint.parser,
                extraFileExtensions: ['.vue'],
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        rules: {
            // TypeScript already reports unknown identifiers.
            'no-undef': 'off',

            // Ported from tslint.json.
            '@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
            '@stylistic/indent': ['warn', 4, { SwitchCase: 1 }],
            'vue/html-indent': ['warn', 4],
            'vue/script-indent': ['warn', 4, { baseIndent: 1 }],
            '@typescript-eslint/member-ordering': [
                'warn',
                { default: ['field', 'constructor', 'method'] },
            ],
            '@typescript-eslint/naming-convention': [
                'warn',
                {
                    selector: 'variableLike',
                    format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
                    leadingUnderscore: 'allow',
                },
            ],
            '@typescript-eslint/prefer-for-of': 'off',
            'no-console': 'off',
        },
    },

    {
        // @stylistic/indent double-reports inside SFC <script> blocks;
        // vue/script-indent owns them.
        files: ['**/*.vue'],
        rules: {
            '@stylistic/indent': 'off',
        },
    },

    {
        // Vitest injects its own globals into test files.
        files: ['tests/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.vitest,
            },
        },
    },
);

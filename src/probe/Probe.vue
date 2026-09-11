<template>
    <main>
        <h1>Plumbing probe</h1>
        <ul>
            <li v-for="check in checks" :key="check.name">
                {{ check.ok ? 'OK' : 'FAIL' }} {{ check.name }}: {{ check.detail }}
            </li>
        </ul>
    </main>
</template>

<script setup lang="ts">
    import {ref, onMounted} from 'vue';

    interface Check {
        name: string;
        ok: boolean;
        detail: string;
    }

    const checks = ref<Check[]>([]);

    function record(name: string, run: () => string): void {
        let check: Check;
        try {
            check = {name, ok: true, detail: run()};
        } catch (error) {
            check = {name, ok: false, detail: String(error)};
        }
        checks.value = [...checks.value, check];
        // Mirrored to the console so src/probe/main.ts can forward it to stdout.
        console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
    }

    // The renderer bundle is a web-target ESM bundle: electron-vite 5 has no
    // `externalizeDeps` for the renderer, so a static `import 'sqlite3'` would be
    // bundled rather than left external. Node modules have to come from the
    // nodeIntegration `require` at runtime instead. Tasks 7 to 9 need to know which
    // spelling of that survives Vite's transform, so the probe measures both.
    onMounted(() => {
        record('vue', () => 'Vue 3 renders and this component is <script setup>');

        record('bare require', () => {
            // Deliberate: measuring whether a bare `require` survives the
            // bundler is the point of this check.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const sep = (require('path') as typeof import('path')).sep;
            return `require('path').sep is ${JSON.stringify(sep)}`;
        });

        record('window.require', () => {
            const nodeRequire = (window as unknown as {require?: NodeRequire}).require;
            if (typeof nodeRequire !== 'function') {
                throw new Error('window.require is not a function');
            }
            const sep = (nodeRequire('path') as typeof import('path')).sep;
            return `window.require('path').sep is ${JSON.stringify(sep)}`;
        });
    });
</script>

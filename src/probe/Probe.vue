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
    import {checkDatabase} from './probeDatabase';

    interface Check {
        name: string;
        ok: boolean;
        detail: string;
    }

    const checks = ref<Check[]>([]);

    function push(check: Check): void {
        checks.value = [...checks.value, check];
        // Mirrored to the console so src/probe/main.ts can forward it to stdout.
        console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
    }

    function record(name: string, run: () => string): void {
        let check: Check;
        try {
            check = {name, ok: true, detail: run()};
        } catch (error) {
            check = {name, ok: false, detail: String(error)};
        }
        push(check);
    }

    // `record` takes a synchronous function. The database check has to await a
    // sync, an insert and a read, so it gets a second helper rather than a
    // changed signature on the one the other checks already use.
    async function recordAsync(name: string, run: () => Promise<string>): Promise<void> {
        let check: Check;
        try {
            check = {name, ok: true, detail: await run()};
        } catch (error) {
            check = {name, ok: false, detail: String(error)};
        }
        push(check);
    }

    // Every Node module reached from the renderer goes through `window.require`,
    // never a bare `require`. Both were measured working in Task 6, but a
    // property access on `window` is not something a bundler plausibly rewrites,
    // whereas a free `require` identifier only keeps working for as long as Vite
    // chooses to leave it alone.
    function nodeRequire<T>(id: string): T {
        const fromWindow = (window as unknown as {require?: NodeRequire}).require;
        if (typeof fromWindow !== 'function') {
            throw new Error('window.require is not a function');
        }
        return fromWindow(id) as T;
    }

    // The renderer bundle is a web-target ESM bundle: electron-vite 5 has no
    // `externalizeDeps` for the renderer, so a static `import 'sqlite3'` would be
    // bundled rather than left external. Node modules have to come from the
    // nodeIntegration `require` at runtime instead. Tasks 7 to 9 need to know which
    // spelling of that survives Vite's transform, so the probe measures both.
    onMounted(async () => {
        record('vue', () => 'Vue 3 renders and this component is <script setup>');

        record('bare require', () => {
            // Deliberate: measuring whether a bare `require` survives the
            // bundler is the point of this check.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const sep = (require('path') as typeof import('path')).sep;
            return `require('path').sep is ${JSON.stringify(sep)}`;
        });

        record('window.require', () => {
            const sep = nodeRequire<typeof import('path')>('path').sep;
            return `window.require('path').sep is ${JSON.stringify(sep)}`;
        });

        record('@electron/remote', () => {
            const remote = nodeRequire<typeof import('@electron/remote')>('@electron/remote');
            return `userData resolves to ${remote.app.getPath('userData')}`;
        });

        // The decorated model and this check's body live in ./probeDatabase.ts
        // rather than inline here. A class decorated inside <script setup> loses
        // its design:type metadata on the dev-server path, because plugin-vue
        // inlines a TypeScript script block into the .vue module and lowers the
        // decorators with Babel, which emits no metadata, and the resulting .vue
        // id never reaches electron-vite's swcPlugin. A plain .ts module always
        // does. probeDatabase.ts carries the full reasoning.
        await recordAsync('sqlite3 + sequelize-typescript', checkDatabase);

        // Sentinel consumed by src/probe/main.ts. It writes this line to stdout
        // and then exits the app with the same code, so a headless run
        // terminates on its own with a meaningful status instead of needing an
        // external timeout. Doing the exit in the main process, from the handler
        // that just wrote the line, means no console output can be lost to a
        // race with app.exit().
        const failed = checks.value.filter(check => !check.ok).length;
        console.log(`[probe] done exit=${failed === 0 ? 0 : 1}`);
    });
</script>

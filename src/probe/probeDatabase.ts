// The decorated model lives in a plain .ts module on purpose, not inside
// Probe.vue's <script setup>.
//
// @vitejs/plugin-vue's `canInlineMain` (dist/index.mjs:325) returns true for
// `lang === 'ts' && options.devServer`, so with a dev server running it inlines
// the SFC script into the main .vue module through `rewriteDefault`, which is
// Babel with the 'typescript' and 'decorators-legacy' parser plugins. Babel
// lowers the decorators into working runtime calls but emits no
// `design:type` metadata. The resulting module id is the literal .vue path,
// which electron-vite's `swcPlugin` filter (/\.(m?ts|[jt]sx)$/) does not match,
// so swc never gets a chance to add the metadata back. In a build there is no
// dev server, `canInlineMain` returns false, plugin-vue emits a
// `?vue&type=script&setup=true&lang.ts` sub-request instead, and that id does
// match the filter. That split is why the same source used to pass the packaged
// run and fail `probe:dev`.
//
// `options.devServer` is assigned by the plugin itself in `configureServer`
// (dist/index.mjs:1722) and is not a user-settable option, and widening
// swcPlugin's filter to .vue ids would not help either, because vue() runs
// before swcPlugin and Babel has already lowered the decorators by then.
//
// A plain .ts module has an id ending in .ts on both paths, so swcPlugin always
// transforms it. This also mirrors how the application is actually organised:
// Game.model.ts and Category.model.ts are separate modules that get imported,
// never classes declared inside a component.

// Deliberately local rather than shared with Probe.vue. Each module reaches
// Node through its own `window.require` call, so each one proves that access
// works from its own module context. Sharing one helper would leave the
// question of whether the other context works unanswered.
function nodeRequire<T>(id: string): T {
    const fromWindow = (window as unknown as {require?: NodeRequire}).require;
    if (typeof fromWindow !== 'function') {
        throw new Error('window.require is not a function');
    }
    return fromWindow(id) as T;
}

/**
 * Opens a SQLite database through the native sqlite3 binding, registers a
 * decorated model, and round-trips a row through it.
 *
 * Returns a detail string describing what was observed, or throws with the
 * reason the plumbing is broken.
 */
export async function checkDatabase(): Promise<string> {
    const {Sequelize, Table, Column, Model, DataType}
        = nodeRequire<typeof import('sequelize-typescript')>('sequelize-typescript');
    const {app} = nodeRequire<typeof import('@electron/remote')>('@electron/remote');
    const {join} = nodeRequire<typeof import('path')>('path');

    // A decorated model declared here rather than imported from src/models, so
    // this check stands on its own. Its job is to prove that decorator metadata
    // survived the bundler: a build without emitDecoratorMetadata still
    // succeeds, and still opens a database, but cannot resolve a column type it
    // was not handed explicitly.
    @Table({tableName: 'probe_rows', timestamps: false})
    class ProbeRow extends Model<ProbeRow> {
        @Column({type: DataType.STRING})
        public label!: string;

        // Deliberately declared without an explicit `type`. That is the branch
        // of sequelize-typescript's `annotate` which calls
        // `getSequelizeTypeByDesignType`, which reads
        // `Reflect.getMetadata('design:type', ...)` and throws when the metadata
        // is absent. It is this column, not `label`, that actually proves
        // `emitDecoratorMetadata` survived: an explicit `type` short-circuits
        // the metadata lookup entirely, so `label` would register either way.
        // Game.model.ts uses both spellings, so both have to keep working.
        @Column
        public inferred!: number;
    }

    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: join(app.getPath('userData'), 'probe.sqlite'),
        models: [ProbeRow],
        logging: false,
    });

    // sequelize 5 has no `getAttributes()`; that arrived in 6. The v5 spelling
    // of the registered column map is `rawAttributes`.
    const rawAttributes = (ProbeRow as unknown as {
        rawAttributes: Record<string, {type: unknown}>;
    }).rawAttributes;
    const attributes = Object.keys(rawAttributes);
    const missing = ['label', 'inferred'].filter(name => !attributes.includes(name));
    if (missing.length > 0) {
        throw new Error(
            `decorator metadata was lost: ProbeRow registered ${JSON.stringify(attributes)}`,
        );
    }
    const inferredType = String(rawAttributes.inferred.type);

    // Round-trip through the native binding, so a missing sqlite3 also fails here.
    await sequelize.sync({force: true});
    const created = await ProbeRow.create({label: 'probe', inferred: 42});
    const count = await ProbeRow.count();
    const reloaded = await ProbeRow.findOne({where: {label: 'probe'}});

    // Reading the values back off the instances is the only part of this check
    // that catches native class fields. A field emitted under define semantics
    // creates an own `undefined` property that shadows the accessor sequelize
    // installs on the prototype (sequelize/lib/model.js:1241), and neither the
    // insert nor the row count notices, because the data reaches `dataValues`
    // either way.
    const readBack = {
        createdLabel: created.label,
        createdInferred: created.inferred,
        reloadedLabel: reloaded?.label,
        reloadedInferred: reloaded?.inferred,
    };
    const shadowed = created.label !== 'probe' || created.inferred !== 42
        || reloaded?.label !== 'probe' || reloaded?.inferred !== 42;
    if (shadowed) {
        throw new Error(
            'attribute accessors are shadowed, most likely by native class fields: '
                + `read back ${JSON.stringify(readBack)}`,
        );
    }

    await sequelize.close();

    return `dialect ${sequelize.getDialect()}, attributes ${attributes.join(',')}, `
        + `inferred column type ${inferredType}, rows ${count}, `
        + `read back ${JSON.stringify(readBack)}`;
}

declare module '*.vue' {
    import type {DefineComponent} from 'vue';

    // The canonical Vue 3 SFC shim. The empty object types and the `any` are
    // part of that published shape: they stand for "unknown props" and
    // "unknown instance type", which is all a wildcard module declaration can
    // say about an SFC that tsc does not parse.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any
    const component: DefineComponent<{}, {}, any>;
    export default component;
}

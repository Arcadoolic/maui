// Stand-in for @/model/Game.model. The real model decorates its properties with
// sequelize-typescript's `@Column` (several without an explicit type), which
// relies on `emitDecoratorMetadata` to read the property's design-time type.
// Vitest transforms TypeScript through esbuild, which does not emit that
// metadata, so loading the real model throws at class-definition time,
// unrelated to the ini lookups under test. Tests that reach this module
// through GameService's import graph get this stand-in instead.
export default class Game {
}

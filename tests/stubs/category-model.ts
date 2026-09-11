// Stand-in for @/model/Category.model. Same reason as tests/stubs/game-model.ts:
// its sequelize-typescript `@Column` decorators need `emitDecoratorMetadata`,
// which Vitest's esbuild transform does not provide.
export default class Category {
}

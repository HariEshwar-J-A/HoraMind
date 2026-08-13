import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config.
 *
 * Type-aware linting is deliberately not enabled: it needs a full type-check
 * per run, which duplicates what `npm run typecheck` already does and roughly
 * triples CI time. The rules kept here are the ones the compiler cannot catch.
 */
export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', 'apps/mobile/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            // Unused arguments are often deliberate in handler signatures; an
            // underscore prefix marks the intent explicitly.
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
            // Present in a few places where an external shape genuinely is not
            // known; flagged as a warning so it stays visible without blocking.
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-console': ['warn', { allow: ['error', 'warn'] }],
            eqeqeq: ['error', 'smart'],
        },
    },
    {
        // Entry points and scripts legitimately write to the console: at that
        // point there is no logger yet, or the output is the deliverable.
        files: ['**/index.ts', 'db/*.mjs'],
        rules: { 'no-console': 'off' },
    },
);

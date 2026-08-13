import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        // The ephemeris kernel is 32 MB and is read at startup, so any suite
        // that initialises the engine needs more than the default timeout.
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
    resolve: {
        // Source uses NodeNext, so internal imports carry a `.js` extension even
        // though the files are `.ts`. Vite resolves those only if told to.
        extensions: ['.ts', '.js', '.mjs', '.json'],
    },
});

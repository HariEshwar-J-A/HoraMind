import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Web client lint rules.
 *
 * The rules that matter here are the ones protecting a future React Native
 * port. The plan says only the view layer may be DOM-aware; a rule enforces
 * that, because "we agreed not to" is not a constraint that survives six months
 * and a deadline.
 */
export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', 'dev-dist/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            globals: { fetch: 'readonly', Response: 'readonly', Headers: 'readonly',
                       RequestInit: 'readonly', console: 'readonly', Intl: 'readonly' },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
        },
    },
    {
        /**
         * Everything except the primitives and the shell.
         *
         * Screens, hooks, stores and the API client must contain nothing a
         * React Native runtime lacks. `document` and `window` do not exist
         * there; `localStorage` does not either, and reaching for it would also
         * undo the decision to keep tokens out of JavaScript-readable storage.
         */
        files: ['src/screens/**/*.tsx', 'src/lib/**/*.ts', 'src/routes/**/*.ts', 'src/theme/**/*.ts'],
        rules: {
            'no-restricted-globals': [
                'error',
                { name: 'window', message: 'Not available in React Native. Keep it in components/ or App.tsx.' },
                { name: 'document', message: 'Not available in React Native. Keep it in components/ or App.tsx.' },
                { name: 'localStorage', message: 'Use the TokenStore interface; tokens must not sit in JS-readable storage.' },
                { name: 'sessionStorage', message: 'Use the TokenStore interface.' },
                { name: 'navigator', message: 'Not portable. Feature-detect inside components/ instead.' },
            ],
            'no-restricted-imports': [
                'error',
                {
                    patterns: [{
                        group: ['*.css', '*.scss'],
                        message: 'Style with token objects from theme/tokens.ts; CSS does not port to React Native.',
                    }],
                },
            ],
        },
    },
);

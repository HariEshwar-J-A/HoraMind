import { create } from 'zustand';

/**
 * Display preferences.
 *
 * Separate from `session` because these outlive a session and belong to nobody
 * but this device: which chart convention someone reads is a habit, not account
 * data, and syncing it would mean a migration and a write on every toggle for
 * something that changes twice a year.
 *
 * Persistence deliberately goes through a small injectable port rather than
 * touching `localStorage` here. An ESLint rule forbids browser globals in this
 * directory precisely so a React Native port does not have to find them, and
 * `expo-secure-store` or `AsyncStorage` satisfies the same three methods.
 */

export type ChartStyle = 'north' | 'south';

export interface PrefsStorage {
    get(key: string): string | null;
    set(key: string, value: string): void;
}

/**
 * The default port: remembers nothing.
 *
 * A store that silently forgets is better than one that throws on a platform
 * without the API — the app still works, the preference just resets. `App.tsx`
 * installs the real one.
 */
let storage: PrefsStorage = {
    get: () => null,
    set: () => {},
};

export function installPrefsStorage(port: PrefsStorage): void {
    storage = port;
    const saved = port.get(KEY);
    if (saved === 'north' || saved === 'south') {
        usePrefs.setState({ chartStyle: saved });
    }
}

const KEY = 'horamind.chartStyle';

interface PrefsState {
    chartStyle: ChartStyle;
    setChartStyle(style: ChartStyle): void;
    toggleChartStyle(): void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
    // North Indian is the default because it is what the app already drew, and
    // changing what an existing user opens to is a worse first impression than
    // picking one convention.
    chartStyle: 'north',

    setChartStyle(style) {
        set({ chartStyle: style });
        storage.set(KEY, style);
    },

    toggleChartStyle() {
        get().setChartStyle(get().chartStyle === 'north' ? 'south' : 'north');
    },
}));

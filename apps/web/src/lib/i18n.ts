/**
 * Strings, one function.
 *
 * Every user-facing sentence goes through `t()` from day one, even with a
 * single locale. Retrofitting i18n is the expensive version of this: by the
 * time the copy is baked into fifty files, extracting it is a rewrite.
 *
 * Interpolation is `{name}` against the vars object. Missing keys return the
 * key itself so a forgotten string is visible rather than silent.
 */

const EN: Record<string, string> = {
    'app.name': 'iAstro',
    'app.tagline': 'Free. No ads. No data sale. Conversations deleted after 7 days.',
    'app.claim': 'Vedic astrology, computed properly.',

    'tab.today': 'Today',
    'tab.chart': 'Chart',
    'tab.ask': 'Ask',
    'tab.life': 'Life',
    'tab.me': 'Me',

    'landing.hero': 'The sky, computed. Not guessed.',
    'landing.cta': 'Read your chart — free',
    'landing.signin': 'I already have an account',
    'landing.diff.ephemeris': 'An ephemeris verified against JPL Horizons',
    'landing.diff.ephemeris.body':
        'Planetary positions come from node-jhora, which reproduces Jagannatha Hora to sub-arcsecond agreement. The diagram on this page is that computation, running now.',
    'landing.diff.corpus': 'A corpus that cites Parashara by chapter and verse',
    'landing.diff.corpus.body':
        'Classical rules are retrieved from JyotishBase. When a reading states a rule, it names the chapter. When it cannot, it does not invent one.',
    'landing.diff.model': 'A model that presents computed facts',
    'landing.diff.model.body':
        'The language model is last, on purpose. It needs the first two to be believed. It does not derive a longitude, and it has no tool that could.',
    'landing.example.q': 'Should I change jobs during this Jupiter dasha?',
    'landing.example.answer':
        'Jupiter mahadasha with Saturn antardasha is classically a period that rewards consolidation over a leap. The 10th from the dasha lord is occupied; a move that is already in motion is favoured over one that is not. This is a texture, not a date.',
    'landing.example.dasha': 'Jupiter → Saturn → Mercury',
    'landing.example.cite': 'BPHS · Chapter 19 · verse 16–18',
    'landing.privacy':
        'Conversations are never used for advertising or profiling, never sold, and deleted after 7 days. Only what you save as a Memory is kept. The claim is not that nothing is stored — that would be false.',
    'landing.example.label': 'A worked question',
    'landing.sky': 'The sky over your location, right now',
    'landing.sky.fallback': 'The sky over Greenwich, right now — share a location to move it.',

    'notify.bell': 'Notifications',
    'notify.empty': 'Nothing yet',
    'notify.empty.hint': 'Dasha changes, slow transits, and a stale life reading land here. Daily compass is off until you turn it on.',
    'notify.markAll': 'Mark all read',
    'notify.prefs': 'What to send',
    'notify.kind.dasha_change': 'Dasha changes',
    'notify.kind.dasha_change.hint': 'A few times a year — when a maha, antar or pratyantar period turns.',
    'notify.kind.transit': 'Saturn and Jupiter',
    'notify.kind.transit.hint': 'A handful of times a decade, plus Sade Sati beginning or ending.',
    'notify.kind.life_stale': 'Life reading out of date',
    'notify.kind.life_stale.hint': 'When memories or interests have moved and the long reading is more than a week old.',
    'notify.kind.daily_compass': 'Daily compass',
    'notify.kind.daily_compass.hint': 'Once a day. Off by default — the app is already there.',
    'notify.kind.system': 'System',
    'notify.kind.system.hint': 'Rare. Account and integrity notices only.',
    'notify.quiet': 'Quiet hours',
    'notify.quiet.hint': 'In your timezone. The centre still fills; the phone does not buzz.',

    'error.retry': 'Try again',
    'error.load': 'Could not load this. Try again shortly.',
};

export function t(key: string, vars?: Record<string, string | number>): string {
    let out = EN[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            out = out.replaceAll(`{${k}}`, String(v));
        }
    }
    return out;
}

/** Degrees and dates, locale-aware. The app's whole substance. */
export function formatDegree(n: number, locale = 'en'): string {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}°`;
}

export function formatDate(iso: string, locale = 'en'): string {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(Date.UTC(y, m - 1, d)));
}

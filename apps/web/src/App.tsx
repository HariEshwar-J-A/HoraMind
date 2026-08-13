import { useEffect, type ReactNode } from 'react';
import {
    BrowserRouter, Routes, Route, Navigate, NavLink, useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { motion as m, useReducedMotion } from 'motion/react';

import { ROUTES, TABS } from './routes/routes.js';
import { useSession } from './lib/session.js';
import { installPrefsStorage } from './lib/prefs.js';
import { Starfield } from './components/astro/Starfield.js';
import { brass, colors, fonts, motion as mo, space, touchTarget } from './theme/tokens.js';

import { SignIn } from './screens/SignIn.js';
import { Onboarding } from './screens/Onboarding.js';
import { Today } from './screens/Today.js';
import { Chart } from './screens/Chart.js';
import { Calendar } from './screens/Calendar.js';
import { Ask } from './screens/Ask.js';
import { You } from './screens/You.js';
import { Devices } from './screens/Devices.js';

/**
 * Application shell.
 *
 * Routes are built from the table in `routes/routes.ts` rather than written as
 * JSX. The registry below is the only place that maps a screen name to a
 * component, so a React Native port swaps this file and the registry entries
 * keep their meaning.
 */

const SCREENS: Record<string, () => JSX.Element> = {
    SignIn, Onboarding, Today, Chart, Calendar, Ask, You, Devices,
};

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Mobile networks drop requests routinely; one silent retry is worth
            // more than an error state the user has to act on.
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 60_000,
        },
    },
});

function Guard({ children, requiresAuth, requiresProfile }: {
    children: ReactNode; requiresAuth: boolean; requiresProfile?: boolean;
}) {
    const { status, profile } = useSession();
    const location = useLocation();

    // Never redirect before the session has been checked, or a reload bounces
    // an authenticated user to sign-in for the moment it takes to restore.
    if (status === 'unknown') return <Splash />;

    if (requiresAuth && status !== 'authenticated') {
        return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
    }
    if (!requiresAuth && status === 'authenticated' && location.pathname === '/sign-in') {
        return <Navigate to="/" replace />;
    }
    if (requiresProfile && !profile) {
        return <Navigate to="/onboarding" replace />;
    }

    return <>{children}</>;
}

/**
 * Shown while the session is being restored.
 *
 * It breathes rather than spinning. This appears for a few hundred
 * milliseconds on a warm start, and a spinner in that window reads as an error
 * state — something is *wrong* enough to need loading — where a slow pulse
 * reads as the app waking up.
 */
function Splash() {
    const still = useReducedMotion();

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: space.md,
        }}>
            <m.div
                animate={still ? undefined : { opacity: [0.35, 1, 0.35], scale: [0.98, 1, 0.98] }}
                transition={still ? undefined : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                    fontFamily: fonts.display, fontSize: 26,
                    color: brass.mid, letterSpacing: 2,
                }}
            >
                HoraMind
            </m.div>
        </div>
    );
}

function TabBar() {
    const { status, profile } = useSession();
    if (status !== 'authenticated' || !profile) return null;

    return (
        <nav style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            display: 'flex',
            backgroundColor: colors.surface,
            borderTop: `1px solid ${colors.border}`,
            // Clear of the iOS home indicator, which otherwise sits on the tabs.
            paddingBottom: 'env(safe-area-inset-bottom)',
            zIndex: 10,
        }}>
            {TABS.map(tab => (
                <NavLink
                    key={tab.path}
                    to={tab.path}
                    end={tab.path === '/'}
                    style={({ isActive }) => ({
                        flex: 1,
                        minHeight: touchTarget,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        paddingTop: space.md,
                        paddingBottom: space.md,
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? colors.accent : colors.textMuted,
                        textDecoration: 'none',
                        transition: 'color 180ms ease',
                    })}
                >
                    {({ isActive }) => (
                        <>
                            {/* One indicator, shared across tabs by `layoutId`:
                                Motion tweens it from the old tab's position to
                                the new one instead of cross-fading two bars, so
                                the mark travels and the movement names which
                                direction you went. */}
                            {isActive && (
                                <m.span
                                    layoutId="hm-tab-indicator"
                                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                                    style={{
                                        position: 'absolute', top: 0,
                                        left: '22%', right: '22%', height: 2,
                                        backgroundColor: brass.mid,
                                        borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
                                    }}
                                />
                            )}
                            {tab.tabLabel}
                        </>
                    )}
                </NavLink>
            ))}
        </nav>
    );
}

/**
 * The routed area, with a transition on arrival.
 *
 * Split out of `App` only because `useLocation` has to be called inside the
 * router.
 *
 * Entry only, and no `AnimatePresence`. That is not a shortcut — it is the one
 * arrangement that does not deadlock the router. `AnimatePresence` keeps the
 * *outgoing* subtree mounted for the length of its exit, so a second, stale
 * `<Routes>` stays live; the `Guard` inside it re-evaluates against the new
 * session, renders `<Navigate>` again, and the two trees push each other back
 * and forth until React gives up with "Maximum update depth exceeded". Any
 * route tree containing a declarative redirect has the same problem.
 *
 * Keying this wrapper on the path instead gives a clean remount: exactly one
 * live `<Routes>`, one redirect, and the incoming screen still animates. The
 * screens stagger their own contents in on top of it, which is where nearly all
 * of the movement is felt anyway.
 */
function RoutedScreens() {
    const location = useLocation();
    const still = useReducedMotion();

    return (
        <m.div
            key={location.pathname}
            initial={{ opacity: 0, y: still ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: still ? 0.01 : mo.base, ease: mo.standard }}
        >
            <Routes>
                {ROUTES.map(route => {
                    const Screen = SCREENS[route.screen];
                    if (!Screen) return null;
                    return (
                        <Route
                            key={route.path}
                            path={route.path}
                            element={
                                <Guard requiresAuth={route.requiresAuth} requiresProfile={route.requiresProfile}>
                                    <Screen />
                                </Guard>
                            }
                        />
                    );
                })}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </m.div>
    );
}

/*
 * The one place display preferences may touch the browser.
 *
 * `lib/prefs.ts` is forbidden from naming `localStorage` — the same lint rule
 * that keeps the rest of `lib/` portable — so the port is installed here, in
 * the shell, which is already DOM-aware. A React Native port swaps these four
 * lines for `AsyncStorage` and the store above never learns the difference.
 */
installPrefsStorage({
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
});

export function App() {
    const restore = useSession(s => s.restore);

    useEffect(() => { void restore(); }, [restore]);

    return (
        <QueryClientProvider client={queryClient}>
            <Starfield />
            <BrowserRouter>
                <RoutedScreens />
                <TabBar />
            </BrowserRouter>
        </QueryClientProvider>
    );
}

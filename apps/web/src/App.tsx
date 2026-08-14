import { useEffect, useState, type ReactNode } from 'react';
import {
    BrowserRouter, Routes, Route, Navigate, NavLink, useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { motion as m, useReducedMotion } from 'motion/react';
import { Shell } from '@horamind/ui';

import { ROUTES, TABS } from './routes/routes.js';
import { useSession } from './lib/session.js';
import { installPrefsStorage } from './lib/prefs.js';
import { t } from './lib/i18n.js';
import { Starfield } from './components/astro/Starfield.js';
import { NotifyBell } from './components/notify/Bell.js';
import { brass, colors, fonts, motion as mo, space, touchTarget } from './theme/tokens.js';

import { Landing } from './screens/Landing.js';
import { SignIn } from './screens/SignIn.js';
import { Onboarding } from './screens/Onboarding.js';
import { Today } from './screens/Today.js';
import { Chart } from './screens/Chart.js';
import { Life } from './screens/Life.js';
import { EditProfile } from './screens/EditProfile.js';
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
    SignIn, Onboarding, Today, Chart, Ask, You, Life, EditProfile, Devices, Landing,
};

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 60_000,
        },
    },
});

const WIDE = '(min-width: 900px)';

function useWide(): boolean {
    const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
    useEffect(() => {
        const mq = window.matchMedia(WIDE);
        const on = () => setWide(mq.matches);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    }, []);
    return wide;
}

function Guard({ children, requiresAuth, requiresProfile }: {
    children: ReactNode; requiresAuth: boolean; requiresProfile?: boolean;
}) {
    const { status, profile } = useSession();
    const location = useLocation();

    if (status === 'unknown') return <Splash />;

    if (requiresAuth && status !== 'authenticated') {
        // `/` stays `requiresAuth` in the route table so the tab still
        // authenticates, but an unauthenticated visit renders the landing
        // rather than bouncing to sign-in. That is the whole reason a
        // marketing page can exist at the same path as Today.
        if (location.pathname === '/') return <Landing />;
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
                {t('app.name')}
            </m.div>
        </div>
    );
}

function activeTabPath(pathname: string): string | undefined {
    let best: string | undefined;
    for (const tab of TABS) {
        const hit = tab.path === '/'
            ? pathname === '/'
            : pathname === tab.path || pathname.startsWith(tab.path + '/');
        if (hit && (best === undefined || tab.path.length > best.length)) best = tab.path;
    }
    return best;
}

function TabNav({ orientation }: { orientation: 'row' | 'column' }) {
    const { pathname } = useLocation();
    const active = activeTabPath(pathname);

    return (
        <nav style={{
            display: 'flex',
            flexDirection: orientation,
            ...(orientation === 'row' ? {
                position: 'fixed' as const, bottom: 0, left: 0, right: 0,
                backgroundColor: colors.surface,
                borderTop: `1px solid ${colors.border}`,
                paddingBottom: 'env(safe-area-inset-bottom)',
                zIndex: 10,
            } : {
                gap: 4,
            }),
        }}>
            {TABS.map(tab => (
                <NavLink
                    key={tab.path}
                    to={tab.path}
                    style={() => ({
                        ...(orientation === 'row'
                            ? { flex: 1, minHeight: touchTarget, justifyContent: 'center', paddingTop: space.md, paddingBottom: space.md }
                            : { minHeight: touchTarget, padding: '0 12px', borderRadius: 10, background: tab.path === active ? colors.surfaceRaised : 'transparent' }
                        ),
                        display: 'flex',
                        alignItems: 'center',
                        position: 'relative',
                        fontSize: 13,
                        fontWeight: tab.path === active ? 600 : 400,
                        color: tab.path === active ? colors.accent : colors.textMuted,
                        textDecoration: 'none',
                        transition: 'color 180ms ease',
                    })}
                >
                    {() => (
                        <>
                            {orientation === 'row' && tab.path === active && (
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

function Chrome({ children }: { children: ReactNode }) {
    const { status, profile } = useSession();
    const wide = useWide();
    if (status !== 'authenticated' || !profile) return <>{children}</>;

    const header = (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: `${space.sm}px ${space.lg}px`,
        }}>
            {wide ? <span /> : (
                <span style={{
                    fontFamily: fonts.display, fontSize: 18, color: brass.mid, letterSpacing: 1,
                }}>
                    {t('app.name')}
                </span>
            )}
            <NotifyBell wide={wide} />
        </div>
    );

    const brand = (
        <div style={{
            fontFamily: fonts.display, fontSize: 22, color: brass.mid,
            letterSpacing: 1, padding: '8px 4px 16px',
        }}>
            {t('app.name')}
        </div>
    );

    return (
        <Shell
            mode={wide ? 'sidebar' : 'tabs'}
            brand={brand}
            header={header}
            nav={<TabNav orientation={wide ? 'column' : 'row'} />}
        >
            {children}
        </Shell>
    );
}

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
                <Chrome>
                    <RoutedScreens />
                </Chrome>
            </BrowserRouter>
        </QueryClientProvider>
    );
}

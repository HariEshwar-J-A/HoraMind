import { useEffect, type ReactNode } from 'react';
import {
    BrowserRouter, Routes, Route, Navigate, NavLink, useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ROUTES, TABS } from './routes/routes.js';
import { useSession } from './lib/session.js';
import { colors, space, touchTarget } from './theme/tokens.js';

import { SignIn } from './screens/SignIn.js';
import { Onboarding } from './screens/Onboarding.js';
import { Today } from './screens/Today.js';
import { Chart } from './screens/Chart.js';
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
    SignIn, Onboarding, Today, Chart, Ask, You, Devices,
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

function Splash() {
    return (
        <div style={{
            minHeight: '100vh', backgroundColor: colors.background,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.textFaint, fontSize: 14,
        }}>
            HoraMind
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
                        paddingTop: space.md,
                        paddingBottom: space.md,
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? colors.accent : colors.textMuted,
                        textDecoration: 'none',
                    })}
                >
                    {tab.tabLabel}
                </NavLink>
            ))}
        </nav>
    );
}

export function App() {
    const restore = useSession(s => s.restore);

    useEffect(() => { void restore(); }, [restore]);

    return (
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
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
                <TabBar />
            </BrowserRouter>
        </QueryClientProvider>
    );
}

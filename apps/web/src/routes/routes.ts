/**
 * The route table, as data.
 *
 * Deliberately not JSX. `react-router` and `expo-router` disagree about almost
 * everything except that an app has a list of paths, each with a component and
 * a few flags — so the list lives here as plain objects, and each platform's
 * router is built from it.
 *
 * Porting to React Native then means writing one adapter, not re-deriving the
 * navigation graph from a tree of `<Route>` elements.
 */

export interface RouteDef {
    /** Path pattern. Both routers use `:param` syntax. */
    path: string;
    /** Key into the screen registry, so this file imports no components. */
    screen: string;
    /** Shown in the tab bar. Routes without one are reachable but not listed. */
    tabLabel?: string;
    /** Redirects to sign-in when there is no session. */
    requiresAuth: boolean;
    /** Redirects to onboarding when the user has no birth profile yet. */
    requiresProfile?: boolean;
    title?: string;
}

export const ROUTES: RouteDef[] = [
    { path: '/sign-in',   screen: 'SignIn',    requiresAuth: false, title: 'Sign in' },
    { path: '/onboarding', screen: 'Onboarding', requiresAuth: true, title: 'Your birth details' },

    { path: '/',        screen: 'Today',    tabLabel: 'Today',   requiresAuth: true, requiresProfile: true, title: 'Today' },
    { path: '/chart',   screen: 'Chart',    tabLabel: 'Chart',   requiresAuth: true, requiresProfile: true, title: 'Your chart' },
    { path: '/calendar', screen: 'Calendar', tabLabel: 'Days',   requiresAuth: true, requiresProfile: true, title: 'Calendar' },
    { path: '/ask',     screen: 'Ask',      tabLabel: 'Ask',     requiresAuth: true, requiresProfile: true, title: 'Ask' },
    { path: '/you',     screen: 'You',      tabLabel: 'You',     requiresAuth: true, requiresProfile: true, title: 'You' },

    // Reachable from You rather than the tab bar: five tabs is already the most
    // a thumb can reach comfortably, and this is a screen someone opens
    // occasionally, not daily.
    { path: '/you/life', screen: 'Life', requiresAuth: true, requiresProfile: true, title: 'Your life' },

    { path: '/you/devices', screen: 'Devices', requiresAuth: true, title: 'Signed-in devices' },
];

export const TABS = ROUTES.filter(r => r.tabLabel);

export function routeFor(path: string): RouteDef | undefined {
    return ROUTES.find(r => r.path === path);
}

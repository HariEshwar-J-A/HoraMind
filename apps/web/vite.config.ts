import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Build configuration.
 *
 * The dev proxy sends `/api` to the local Fastify server so development matches
 * production exactly: one origin, no CORS, and the httpOnly refresh cookie
 * behaves the same in both. A client that only works because CORS is wide open
 * in development is a client that breaks on deploy.
 */
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            registerType: 'prompt',
            includeAssets: ['favicon.svg'],
            manifest: {
                name: 'HoraMind — Vedic Astrology',
                short_name: 'HoraMind',
                description:
                    'Vedic astrology grounded in a verified ephemeris and classical sources.',
                theme_color: '#0B0D17',
                background_color: '#0B0D17',
                display: 'standalone',
                orientation: 'portrait',
                start_url: '/',
                scope: '/',
                categories: ['lifestyle', 'education'],
                icons: [
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                    {
                        src: '/icon-512.png', sizes: '512x512', type: 'image/png',
                        // Android adaptive icons crop to a circle; without a
                        // maskable variant the artwork loses its edges.
                        purpose: 'maskable',
                    },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
                // Never cache the API. A chart or a dasha is cheap to fetch and
                // catastrophic to serve stale — a reading from yesterday's
                // transits looks authoritative and is wrong.
                navigateFallbackDenylist: [/^\/api/],
                runtimeCaching: [
                    {
                        urlPattern: /^\/api\//,
                        handler: 'NetworkOnly',
                    },
                ],
            },
            devOptions: { enabled: false },
        }),
    ],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: false,
                rewrite: path => path.replace(/^\/api/, ''),
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        target: 'es2022',
    },
});

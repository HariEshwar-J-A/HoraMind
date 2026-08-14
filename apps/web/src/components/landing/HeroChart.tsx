import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChartWheel } from '../astro/ChartWheel.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/i18n.js';
import { brass, colors, fonts, space } from '../../theme/tokens.js';

/**
 * The landing hero: a live chart of *this* moment.
 *
 * Geolocation lives here, not in the screen, because screens are forbidden
 * from naming `navigator`. Greenwich is the fallback so the diagram is never
 * empty; the caption says so.
 */

interface NowChart {
    ascendant: { sign: number; signName: string; degree: number };
    planets: Array<{
        name: string; house: number; signName: string; degree: number; retrograde: boolean;
    }>;
}

export function HeroChart() {
    const [coords, setCoords] = useState<{ lat: number; lon: number; sourced: 'here' | 'greenwich' }>({
        lat: 51.4769, lon: -0.0005, sourced: 'greenwich',
    });

    useEffect(() => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            pos => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude, sourced: 'here' }),
            () => { /* keep Greenwich */ },
            { maximumAge: 60_000, timeout: 4_000, enableHighAccuracy: false },
        );
    }, []);

    const chart = useQuery<NowChart>({
        queryKey: ['charts-now', coords.lat, coords.lon],
        queryFn: () => api.request(
            `/v1/charts/now?lat=${coords.lat}&lon=${coords.lon}`,
            { method: 'GET', skipAuth: true },
        ),
        staleTime: 60_000,
        retry: 1,
    });

    return (
        <div style={{ textAlign: 'center' }}>
            {chart.data ? (
                <ChartWheel
                    ascendantSign={chart.data.ascendant.sign}
                    planets={chart.data.planets}
                    size={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 48 : 360)}
                />
            ) : (
                <div style={{
                    height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: colors.textFaint, fontFamily: fonts.mono, fontSize: 12,
                }}>
                    {chart.isError ? t('error.load') : '…'}
                </div>
            )}
            <p style={{
                margin: `${space.md}px 0 0`, fontSize: 12, color: brass.deep,
                fontFamily: fonts.mono, lineHeight: '18px',
            }}>
                {coords.sourced === 'here' ? t('landing.sky') : t('landing.sky.fallback')}
            </p>
        </div>
    );
}

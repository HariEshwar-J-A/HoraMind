import { EphemerisEngine } from '@node-jhora/core';

/**
 * The DE440s ephemeris engine, initialised once per process.
 *
 * Initialisation reads a multi-megabyte SPK kernel from disk, so it happens at
 * startup rather than on first request — otherwise the first user of a freshly
 * deployed instance pays for everyone else.
 */

let engine: EphemerisEngine | null = null;

export async function initEngine(): Promise<EphemerisEngine> {
    if (engine) return engine;
    const instance = EphemerisEngine.getInstance();
    await instance.initialize();
    engine = instance;
    return engine;
}

export function getEngine(): EphemerisEngine {
    if (!engine) throw new Error('EphemerisEngine not initialised. Call initEngine() first.');
    return engine;
}

export function isEngineReady(): boolean {
    return engine !== null;
}

import { ChromaClient, type Collection } from 'chromadb';
import { createHash } from 'node:crypto';

import type { Env } from '../config/env.js';
import { embedQuery } from '../lib/embeddings.js';
import { extractEntities } from '../lib/entities.js';
import { serviceUnavailable, upstreamFailure } from '../lib/errors.js';

/**
 * Retrieval over the BPHS corpus.
 *
 * Two adjustments sit between Chroma's cosine distance and what is returned,
 * and both exist because the raw ranking was demonstrably wrong in ways that
 * looked fine:
 *
 *   1. **Substance re-rank.** Bare chapter headings — "Effects of the
 *      Antardasas in the Dasa of Saturn" — are short and match query terms
 *      densely, so they outrank the verses that state the actual rule while
 *      giving an interpreter nothing to reason from. A mild length prior fixes
 *      the order without discarding them; a heading is still a legitimate hit
 *      when nothing better exists.
 *
 *   2. **Entity boost.** A question naming Rahu and the 9th house embeds close
 *      to everything about either. Passages whose metadata matches both are
 *      pulled forward. Deliberately a boost and not a `where` filter: filtering
 *      returns nothing when the corpus has no matching tag, and "unfocused
 *      results" beats "no results".
 *
 * The constants are carried over unchanged from the tuning that fixed the
 * original false positives. They are not free parameters to adjust casually.
 */

const SUBSTANCE_FLOOR = 260;   // chars below which a chunk is mostly a title
const MAX_PENALTY     = 0.18;  // in cosine-distance units

/**
 * A division match is worth far more than a topic match: `topic_varga` is broad
 * and matches most of the divisional-chart chapters, while `division_9` names
 * the specific thing being asked about.
 */
const ENTITY_BOOST   = 0.06;
const DIVISION_BOOST = 0.25;

/** Over-fetch so the re-rank has candidates to reorder rather than just trim. */
const OVERFETCH = 5;

export interface RagHit {
    id: string;
    document: string;
    /** Raw cosine distance from Chroma. Lower is closer. */
    distance: number;
    /** Distance after the substance penalty and entity boosts. */
    adjusted: number;
    source: string | null;
    chapter: number | null;
    verse: string | null;
    matchedEntities: string[];
}

export interface RagResult {
    hits: RagHit[];
    entities: string[];
    /** SHA-256 of the query. Logged in place of the text itself. */
    queryHash: Buffer;
    latencyMs: number;
}

let client: ChromaClient | null = null;
let collection: Collection | null = null;

export function resetRagClient(): void {
    client = null;
    collection = null;
}

async function getCollection(env: Env): Promise<Collection> {
    if (collection) return collection;
    try {
        client ??= new ChromaClient({ path: env.CHROMA_URL });
        collection = await client.getCollection({ name: env.CHROMA_COLLECTION } as never);
        return collection;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Distinguish "not running" from "running but the collection is
        // missing" — the first is an ops problem, the second means ingestion
        // never completed, and they have entirely different fixes.
        if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
            throw serviceUnavailable(
                `The knowledge base is unreachable at ${env.CHROMA_URL}. `
                + 'Start ChromaDB, or check CHROMA_URL.',
            );
        }
        throw upstreamFailure(
            `Collection "${env.CHROMA_COLLECTION}" could not be opened. `
            + 'Has the JyotishBase ingestion been run?',
            { cause: message },
        );
    }
}

/** Chroma metadata is loosely typed; read defensively rather than assert. */
function metaString(meta: Record<string, unknown>, key: string): string | null {
    const v = meta[key];
    return typeof v === 'string' && v.length > 0 ? v : null;
}

function metaNumber(meta: Record<string, unknown>, key: string): number | null {
    const v = meta[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    return null;
}

export async function query(
    env: Env,
    text: string,
    topK = 4,
): Promise<RagResult> {
    const started = Date.now();
    const trimmed = text.trim();
    const queryHash = createHash('sha256').update(trimmed).digest();

    const entities = extractEntities(trimmed);
    const embedding = await embedQuery(trimmed);
    const col = await getCollection(env);

    let raw;
    try {
        raw = await col.query({
            queryEmbeddings: [embedding],
            nResults: Math.max(topK * OVERFETCH, 20),
            include: ['documents', 'metadatas', 'distances'] as never,
        });
    } catch (err) {
        throw upstreamFailure('Knowledge base query failed', {
            cause: err instanceof Error ? err.message : String(err),
        });
    }

    const ids = raw.ids?.[0] ?? [];

    const hits: RagHit[] = ids.map((id, i) => {
        const document = raw.documents?.[0]?.[i] ?? '';
        const distance = raw.distances?.[0]?.[i] ?? 1;
        const meta = (raw.metadatas?.[0]?.[i] ?? {}) as Record<string, unknown>;

        // Which of the question's entities this passage is tagged with. Tags
        // are stored as a flat list on the document during ingestion.
        const tags = Array.isArray(meta.entities)
            ? (meta.entities as unknown[]).filter((t): t is string => typeof t === 'string')
            : typeof meta.entities === 'string'
                ? meta.entities.split(',').map(s => s.trim())
                : [];

        const matched = entities.filter(e => tags.includes(e));
        const divisionHits = matched.filter(e => e.startsWith('division_')).length;
        const otherHits = matched.length - divisionHits;

        const shortfall = Math.max(0, SUBSTANCE_FLOOR - document.length) / SUBSTANCE_FLOOR;

        return {
            id,
            document,
            distance,
            // Lower is better throughout, so boosts subtract and the penalty adds.
            adjusted: distance
                + shortfall * MAX_PENALTY
                - divisionHits * DIVISION_BOOST
                - otherHits * ENTITY_BOOST,
            source: metaString(meta, 'source'),
            chapter: metaNumber(meta, 'chapter'),
            verse: metaString(meta, 'verse'),
            matchedEntities: matched,
        };
    });

    hits.sort((a, b) => a.adjusted - b.adjusted);

    return {
        hits: hits.slice(0, topK),
        entities,
        queryHash,
        latencyMs: Date.now() - started,
    };
}

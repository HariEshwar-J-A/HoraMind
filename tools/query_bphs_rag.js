/**
 * query_bphs_rag.js
 * Tool 2 – Semantic search against the local JyotishBase ChromaDB vector store.
 *
 * Input:  query {string} — natural-language search (e.g. "Effects of Rahu in 9th house")
 * Output: Array of top-4 matched Markdown chunks from santhanam_source_of_truth.
 *
 * WASM RULE (mandatory — host VM has no AVX instructions):
 *   env.backends.onnx.node     = false;   // disable native ONNX backend
 *   env.backends.onnx.wasm.numThreads = 1;  // single-threaded WASM
 *
 * Dependencies:
 *   @xenova/transformers   — local embedding generation (WASM)
 *   chromadb               — ChromaDB JS client (v1.x REST API)
 *
 * Assumes:
 *   ChromaDB running at http://[IP_ADDRESS]
 *   Collection name: santhanam_source_of_truth
 */

import { pipeline, env } from '@xenova/transformers';
import { ChromaClient } from 'chromadb';

// ---------------------------------------------------------------------------
// CRITICAL: Force WASM backend — prevents Segfault on AVX-less VMs
// ---------------------------------------------------------------------------
env.backends.onnx.node = false;
env.backends.onnx.wasm.numThreads = 1;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CHROMA_URL = 'http://192.168.128.128:8000';
const COLLECTION_NAME = 'santhanam_source_of_truth';
const TOP_K = 4;
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'; // 384-dim, matches ingest script

// ---------------------------------------------------------------------------
// Singletons (initialized lazily, cached for warm re-use in long-running agents)
// ---------------------------------------------------------------------------
let _embedder = null;
let _client = null;
let _collection = null;

async function getEmbedder() {
    if (!_embedder) {
        _embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, {
            // quantized model = smaller download & faster WASM inference
            quantized: true,
        });
    }
    return _embedder;
}

async function getCollection() {
    if (!_collection) {
        _client = new ChromaClient({ path: CHROMA_URL });
        _collection = await _client.getCollection({ name: COLLECTION_NAME });
    }
    return _collection;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Xenova feature-extraction tensor to a plain Float32 array.
 * The model returns shape [1, seq_len, dim]; we mean-pool across token dim.
 */
function tensorToEmbedding(tensor) {
    // tensor.data is a Float32Array of shape [1 * seq_len * dim]
    const data = tensor.data;
    const [, seqLen, dim] = tensor.dims;           // [batch=1, seq_len, 384]
    const pooled = new Float32Array(dim);

    for (let d = 0; d < dim; d++) {
        let sum = 0;
        for (let t = 0; t < seqLen; t++) {
            sum += data[t * dim + d];
        }
        pooled[d] = sum / seqLen;
    }

    // L2-normalize for cosine similarity
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += pooled[d] ** 2;
    norm = Math.sqrt(norm);
    for (let d = 0; d < dim; d++) pooled[d] /= norm;

    return Array.from(pooled);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Query the BPHS RAG database.
 *
 * @param {string} query — natural-language search string
 * @returns {Promise<Array<{
 *   rank:     number,
 *   score:    number,
 *   id:       string,
 *   document: string,
 *   metadata: object
 * }>>}
 */
export async function queryBphsRag(query) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        throw new Error('query must be a non-empty string');
    }

    const trimmed = query.trim();

    // 1. Generate embedding for the query
    let embedding;
    try {
        const embedder = await getEmbedder();
        const output = await embedder(trimmed, { pooling: 'none', normalize: false });
        embedding = tensorToEmbedding(output);
    } catch (err) {
        throw new Error(`Embedding generation failed: ${err.message}`);
    }

    // 2. Query ChromaDB
    let raw;
    try {
        const collection = await getCollection();
        raw = await collection.query({
            queryEmbeddings: [embedding],
            nResults: TOP_K,
            include: ['documents', 'metadatas', 'distances'],
        });
    } catch (err) {
        if (err.message?.includes('ECONNREFUSED')) {
            throw new Error(
                `ChromaDB is not reachable at ${CHROMA_URL}. ` +
                'Start it with: chroma run --path ./chroma_data'
            );
        }
        throw new Error(`ChromaDB query failed: ${err.message}`);
    }

    // 3. Format results
    const ids = raw.ids?.[0] ?? [];
    const docs = raw.documents?.[0] ?? [];
    const metas = raw.metadatas?.[0] ?? [];
    const distances = raw.distances?.[0] ?? [];

    if (ids.length === 0) {
        return [];
    }

    return ids.map((id, i) => ({
        rank: i + 1,
        score: +(1 - distances[i]).toFixed(6), // convert L2 distance → cosine similarity approx
        id,
        document: docs[i] ?? '',
        metadata: metas[i] ?? {},
    }));
}

// ---------------------------------------------------------------------------
// CLI shim — run directly: node query_bphs_rag.js "Effects of Rahu in 9th house"
// ---------------------------------------------------------------------------
import { fileURLToPath } from 'url';
import path from 'path';

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const query = process.argv.slice(2).join(' ');
    if (!query) {
        console.error('Usage: node query_bphs_rag.js "your search query"');
        process.exit(1);
    }
    try {
        const results = await queryBphsRag(query);
        if (results.length === 0) {
            console.log('No results found.');
        } else {
            for (const r of results) {
                console.log(`\n--- Rank ${r.rank} | Score: ${r.score} | ID: ${r.id} ---`);
                if (r.metadata && Object.keys(r.metadata).length > 0) {
                    console.log('Metadata:', JSON.stringify(r.metadata));
                }
                console.log(r.document);
            }
        }
    } catch (err) {
        console.error({ error: err.message });
        process.exit(1);
    }
}

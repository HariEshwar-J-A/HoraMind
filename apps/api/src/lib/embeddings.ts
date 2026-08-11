import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

/**
 * Query embeddings.
 *
 * ---------------------------------------------------------------------------
 * The WASM rule
 * ---------------------------------------------------------------------------
 * The host VM lacks AVX instructions. The native ONNX backend compiles against
 * them and segfaults the process on first inference — not an exception, a hard
 * crash with no stack. These two lines are the difference between a working
 * service and one that dies silently under load, and they must run *before* any
 * pipeline is constructed.
 */
env.backends.onnx.node = false;
env.backends.onnx.wasm.numThreads = 1;

/**
 * Must match what JyotishBase ingested with. A different model produces vectors
 * in a different space, and cosine distance against them is not wrong so much
 * as meaningless — the results look plausible and are noise.
 */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMS = 384;

let embedder: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Load the model once per process.
 *
 * The in-flight promise is cached, not just the result: two concurrent requests
 * arriving before the first load finishes would otherwise each start their own
 * download and initialisation.
 */
export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
    if (embedder) return embedder;
    if (!loading) {
        loading = pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true })
            .then(p => { embedder = p as FeatureExtractionPipeline; return embedder; });
    }
    return loading;
}

export function isEmbedderReady(): boolean {
    return embedder !== null;
}

/**
 * Mean-pool token vectors and L2-normalise.
 *
 * Done by hand rather than with `{ pooling: 'mean', normalize: true }` because
 * this reproduces exactly what the ingestion script did. Pooling that differs
 * from ingestion puts queries in a subtly different place from the documents,
 * which degrades retrieval in a way that is very hard to notice: results still
 * come back, ranked, and slightly wrong.
 */
export function poolAndNormalise(data: Float32Array, seqLen: number, dim: number): number[] {
    const pooled = new Float32Array(dim);

    for (let d = 0; d < dim; d++) {
        let sum = 0;
        for (let t = 0; t < seqLen; t++) sum += data[t * dim + d]!;
        pooled[d] = sum / seqLen;
    }

    let norm = 0;
    for (let d = 0; d < dim; d++) norm += pooled[d]! ** 2;
    norm = Math.sqrt(norm);

    // A zero vector cannot be normalised; returning it unchanged keeps the
    // caller from producing NaNs that would silently poison every distance.
    if (norm === 0) return Array.from(pooled);

    for (let d = 0; d < dim; d++) pooled[d] = pooled[d]! / norm;
    return Array.from(pooled);
}

export async function embedQuery(text: string): Promise<number[]> {
    const model = await getEmbedder();
    const output = await model(text, { pooling: 'none', normalize: false });
    const [, seqLen, dim] = output.dims as [number, number, number];
    return poolAndNormalise(output.data as Float32Array, seqLen, dim);
}

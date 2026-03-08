---
name: query-bphs-rag
description: Semantic search against the JyotishBase ChromaDB vector database. Returns the top-4 matching Markdown chunks from Brihat Parashara Hora Shastra and related classical Vedic texts.
version: 1.0.0
emoji: 📜
user-invocable: false
disable-model-invocation: false
command-dispatch: false

metadata:
  openclaw:
    requires:
      bins:
        - node
      anyBins:
        - node
      os:
        - linux
        - darwin
        - win32
    primaryEnv: CHROMA_URL
---

# query-bphs-rag

Performs semantic vector search against the **santhanam_source_of_truth** ChromaDB collection. Embeddings are generated locally using `@xenova/transformers` (WASM backend — no GPU required). Results are classical text chunks in Markdown format with metadata tags.

## When to Invoke

Run **after every `calculate_chart` call** to ground your interpretation in classical authority. Run before stating any interpretive claim that isn't directly sourced from a tool number.

**Example use cases:**
- After computing D1 planets: look up effects of each key placement
- After detecting a Yoga: look up its classical definition and conditions
- Before declaring a planet weak: look up Neecha Bhanga rules
- During Dasha interpretation: look up effects of the current Mahadasha lord

## Invocation

```bash
node ./tools/query_bphs_rag.js "your natural-language search query"
```

## Query Crafting Tips

Be specific. Include the planet name, house, sign, or Yoga. Examples:

```
"Rahu in 9th house from Lagna karma foreign travel dharma"
"Sun Saturn conjunction Capricorn results Vedic astrology BPHS"
"Moon Mahadasha Jupiter Antardasha period results"
"Neecha Bhanga Raja Yoga conditions for Mars debilitated Cancer"
"Ashtakavarga 28 bindus 8th house Saturn transit"
"D10 Dashamsa Mercury strong career intellectual profession"
"Atmakaraka Venus spiritual path dharma"
"Kendra Trikona Raja Yoga formation conditions"
```

## Output

Array of up to 4 result objects:
```json
[
  {
    "rank": 1,
    "score": 0.923456,
    "id": "bphs_ch12_sl4",
    "document": "## BPHS Chapter 12, Sloka 4\n\n*[Sanskrit original]*\n\n**Translation:** When Rahu occupies...",
    "metadata": {
      "source": "bphs",
      "chapter": "12",
      "tags": ["rahu", "9th_house", "dharma"]
    }
  }
]
```

## Processing Results

- Use the `document` field as your citation. Quote it directly or paraphrase with attribution: *"Per BPHS Chapter [n]..."*
- A `score` above 0.85 = highly relevant. Between 0.70–0.85 = contextually related. Below 0.70 = marginal — use with caution.
- If the array is empty, proceed from first principles and state: *"I could not find a directly relevant BPHS rule for this placement."*

## Dependency

ChromaDB must be running at the URL specified in `CHROMA_URL` env variable.
Default: `http://localhost:8000`. If unreachable, proceed without RAG and notify the user.

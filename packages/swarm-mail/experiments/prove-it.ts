/**
 * Proof that local embeddings work without Ollama
 */
import { pipeline } from "@huggingface/transformers";

async function main() {
  console.log("🔬 Proving local embeddings work...\n");

  console.log("1️⃣  Loading model (first run downloads ~23MB)...");
  const start = Date.now();

  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { dtype: "fp32" }
  );

  console.log(`   ✅ Model loaded in ${Date.now() - start}ms\n`);

  console.log("2️⃣  Generating embedding for: 'How to fix Windows path issues'");
  const embedStart = Date.now();

  const result = await extractor("How to fix Windows path issues", {
    pooling: "mean",
    normalize: true,
  });

  const embedding = Array.from(result.data as Float32Array);
  console.log(`   ✅ Generated in ${Date.now() - embedStart}ms`);
  console.log(`   📊 Dimensions: ${embedding.length}`);
  console.log(`   📈 First 5 values: [${embedding.slice(0, 5).map((n) => n.toFixed(4)).join(", ")}]`);
  console.log(`   📉 Last 5 values: [${embedding.slice(-5).map((n) => n.toFixed(4)).join(", ")}]\n`);

  console.log("3️⃣  Generating another embedding for similarity test...");
  const result2 = await extractor("Windows file path problems and solutions", {
    pooling: "mean",
    normalize: true,
  });
  const embedding2 = Array.from(result2.data as Float32Array);

  // Cosine similarity (vectors are normalized so just dot product)
  const similarity = embedding.reduce((sum, val, i) => sum + val * embedding2[i], 0);
  console.log(`   📐 Cosine similarity: ${similarity.toFixed(4)}`);
  console.log(`   ${similarity > 0.7 ? "✅ High similarity - semantic search would match!" : "⚠️ Low similarity"}\n`);

  console.log("4️⃣  Testing unrelated text...");
  const result3 = await extractor("Recipe for chocolate cake with frosting", {
    pooling: "mean",
    normalize: true,
  });
  const embedding3 = Array.from(result3.data as Float32Array);
  const dissimilarity = embedding.reduce((sum, val, i) => sum + val * embedding3[i], 0);
  console.log(`   📐 Cosine similarity with unrelated text: ${dissimilarity.toFixed(4)}`);
  console.log(`   ${dissimilarity < 0.3 ? "✅ Low similarity - correctly different!" : "⚠️ Unexpectedly similar"}\n`);

  console.log("═".repeat(50));
  console.log("🎉 PROOF COMPLETE: Local embeddings work without Ollama!");
  console.log("═".repeat(50));
}

main().catch(console.error);

import { getDatabase } from './database';
import { apiClient } from '../../apiClient';
import { getApiUrl } from '../../config';

export interface VectorDocument {
    id: string;
    sourceType: string;
    content: string;
    metadata?: Record<string, any>;
}

export interface SearchResult {
    id: string;
    content: string;
    score: number;
    metadata?: Record<string, any>;
}

export class VectorStore {
    /**
     * Generate embedding for single text using Backend API (Transient)
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            const response = await apiClient.post<{ embedding: number[] }>(
                `${getApiUrl()}/embeddings`,
                { text }
            );
            if (response && response.embedding) {
                return response.embedding;
            }
            throw new Error('No embedding returned from backend');
        } catch (error) {
            console.error('Failed to generate embedding:', error);
            throw error;
        }
    }

    /**
     * Generate embeddings for multiple texts in a single API call (Batch mode)
     */
    private async generateEmbeddings(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        try {
            const response = await apiClient.post<{ embeddings: number[][] }>(
                `${getApiUrl()}/embeddings`,
                { texts }
            );
            if (response && response.embeddings) {
                return response.embeddings;
            }
            throw new Error('No embeddings returned from backend');
        } catch (error) {
            console.error('Failed to generate embeddings:', error);
            throw error;
        }
    }

    /**
     * Add a single document to the vector store
     */
    async addDocument(doc: VectorDocument): Promise<void> {
        const startTime = Date.now();
        const contentPreview = doc.content.substring(0, 100).replace(/\n/g, ' ');
        console.log(
            `[Local RAG Store] Adding document - id=${doc.id} sourceType=${doc.sourceType} contentPreview="${contentPreview}..."`
        );

        const db = getDatabase();

        // 1. Generate embedding
        console.log('[Local RAG Store] Generating embedding...');
        const embeddingStartTime = Date.now();
        const embedding = await this.generateEmbedding(doc.content);
        const embeddingTime = Date.now() - embeddingStartTime;
        console.log(`[Local RAG Store] Embedding generated in ${embeddingTime}ms (${embedding.length} dimensions)`);

        // 2. Store in SQLite
        console.log('[Local RAG Store] Storing in SQLite...');
        const dbStartTime = Date.now();
        await db.runAsync(
            `INSERT OR REPLACE INTO vectors (id, source_type, content, embedding, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                doc.id,
                doc.sourceType,
                doc.content,
                JSON.stringify(embedding),
                doc.metadata ? JSON.stringify(doc.metadata) : null,
                Date.now()
            ]
        );
        const dbTime = Date.now() - dbStartTime;
        
        const totalTime = Date.now() - startTime;
        console.log(
            `[Local RAG Store] ✓ Document stored successfully in ${totalTime}ms (embedding: ${embeddingTime}ms, db: ${dbTime}ms)`
        );
    }

    /**
     * Add multiple documents to the vector store in batch (more efficient)
     */
    async addDocuments(docs: VectorDocument[]): Promise<void> {
        if (docs.length === 0) {
            console.log('[Local RAG Store] No documents to add (empty batch)');
            return;
        }

        const startTime = Date.now();
        console.log(`[Local RAG Store] Starting batch add - ${docs.length} documents`);

        // Log document previews
        docs.forEach((doc, idx) => {
            const contentPreview = doc.content.substring(0, 80).replace(/\n/g, ' ');
            console.log(
                `[Local RAG Store] Document ${idx + 1}/${docs.length}: id=${doc.id} sourceType=${doc.sourceType} content="${contentPreview}..."`
            );
        });

        const db = getDatabase();

        // 1. Generate all embeddings in one API call
        console.log('[Local RAG Store] Generating embeddings in batch...');
        const embeddingStartTime = Date.now();
        const texts = docs.map(doc => doc.content);
        const embeddings = await this.generateEmbeddings(texts);
        const embeddingTime = Date.now() - embeddingStartTime;
        console.log(
            `[Local RAG Store] Batch embeddings generated in ${embeddingTime}ms (${docs.length} documents, ${embeddings[0]?.length || 0} dimensions each)`
        );

        // 2. Store all in SQLite
        console.log('[Local RAG Store] Storing batch in SQLite...');
        const dbStartTime = Date.now();
        const now = Date.now();
        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            const embedding = embeddings[i];
            await db.runAsync(
                `INSERT OR REPLACE INTO vectors (id, source_type, content, embedding, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    doc.id,
                    doc.sourceType,
                    doc.content,
                    JSON.stringify(embedding),
                    doc.metadata ? JSON.stringify(doc.metadata) : null,
                    now
                ]
            );
        }
        const dbTime = Date.now() - dbStartTime;

        const totalTime = Date.now() - startTime;
        console.log(
            `[Local RAG Store] ✓ Batch storage completed in ${totalTime}ms (embedding: ${embeddingTime}ms, db: ${dbTime}ms, avg per doc: ${(totalTime / docs.length).toFixed(1)}ms)`
        );
    }

    /**
     * Search for similar documents
     */
    async search(query: string, limit: number = 5, sourceType?: string): Promise<SearchResult[]> {
        const searchStartTime = Date.now();
        console.log(
            `[Local RAG Search] Starting search - query="${query}" limit=${limit} sourceType=${sourceType || 'all'}`
        );

        const db = getDatabase();

        // 1. Generate query embedding
        console.log('[Local RAG Search] Generating query embedding...');
        const embeddingStartTime = Date.now();
        const queryEmbedding = await this.generateEmbedding(query);
        const embeddingTime = Date.now() - embeddingStartTime;
        console.log(`[Local RAG Search] Query embedding generated in ${embeddingTime}ms (${queryEmbedding.length} dimensions)`);

        // 2. Fetch all vectors (Linear Scan - optimized for small local datasets < 1000 items)
        // For larger datasets, we would need a native vector extension or optimized storage.
        const whereClause = sourceType ? 'WHERE source_type = ?' : '';
        const params = sourceType ? [sourceType] : [];

        console.log('[Local RAG Search] Fetching vectors from SQLite...');
        const dbStartTime = Date.now();
        const rows = await db.getAllAsync<{
            id: string;
            content: string;
            embedding: string;
            metadata: string;
        }>(`SELECT id, content, embedding, metadata FROM vectors ${whereClause}`, params);
        const dbTime = Date.now() - dbStartTime;
        console.log(`[Local RAG Search] Fetched ${rows.length} vectors from SQLite in ${dbTime}ms`);

        // 3. Compute Cosine Similarity in JS
        console.log('[Local RAG Search] Computing cosine similarity for all documents...');
        const similarityStartTime = Date.now();
        const results: SearchResult[] = rows.map(row => {
            const vector = JSON.parse(row.embedding) as number[];
            const score = this.cosineSimilarity(queryEmbedding, vector);
            return {
                id: row.id,
                content: row.content,
                score,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined
            };
        });
        const similarityTime = Date.now() - similarityStartTime;
        console.log(`[Local RAG Search] Similarity computation completed in ${similarityTime}ms`);

        // 4. Sort and return top K
        const sortedResults = results.sort((a, b) => b.score - a.score);
        const topResults = sortedResults.slice(0, limit);

        // Log detailed results
        const totalTime = Date.now() - searchStartTime;
        console.log(
            `[Local RAG Search] Search completed in ${totalTime}ms (embedding: ${embeddingTime}ms, db: ${dbTime}ms, similarity: ${similarityTime}ms)`
        );
        console.log(`[Local RAG Search] Returning ${topResults.length}/${rows.length} documents (top ${limit})`);

        // Log each result with detailed info
        topResults.forEach((result, idx) => {
            const contentPreview = result.content.substring(0, 80).replace(/\n/g, ' ');
            const metaStr = result.metadata ? JSON.stringify(result.metadata) : 'none';
            console.log(
                `[Local RAG Search] Result ${idx + 1}: score=${result.score.toFixed(3)} id=${result.id} meta=${metaStr} content="${contentPreview}..."`
            );
        });

        // Warn if no results or low relevance
        if (topResults.length === 0) {
            console.warn('[Local RAG Search] ⚠️ No documents found in local knowledge base');
        } else if (topResults[0].score < 0.5) {
            console.warn(
                `[Local RAG Search] ⚠️ Top result has low relevance (score=${topResults[0].score.toFixed(3)}). Consider lowering threshold or expanding knowledge base.`
            );
        }

        return topResults;
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            magnitudeA += vecA[i] * vecA[i];
            magnitudeB += vecB[i] * vecB[i];
        }
        magnitudeA = Math.sqrt(magnitudeA);
        magnitudeB = Math.sqrt(magnitudeB);
        if (magnitudeA === 0 || magnitudeB === 0) return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    }

    /**
     * Delete document by ID
     */
    async deleteDocument(id: string): Promise<void> {
        const db = getDatabase();
        await db.runAsync('DELETE FROM vectors WHERE id = ?', [id]);
    }

    /**
     * Clear all vectors (e.g. on logout)
     */
    async clear(): Promise<void> {
        const db = getDatabase();
        await db.runAsync('DELETE FROM vectors');
    }
}

export const vectorStore = new VectorStore();

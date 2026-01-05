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
        const db = getDatabase();

        // 1. Generate embedding
        const embedding = await this.generateEmbedding(doc.content);

        // 2. Store in SQLite
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
        console.log(`[VectorStore] Added document ${doc.id} (${doc.sourceType})`);
    }

    /**
     * Add multiple documents to the vector store in batch (more efficient)
     */
    async addDocuments(docs: VectorDocument[]): Promise<void> {
        if (docs.length === 0) return;

        const db = getDatabase();

        // 1. Generate all embeddings in one API call
        const texts = docs.map(doc => doc.content);
        const embeddings = await this.generateEmbeddings(texts);

        // 2. Store all in SQLite
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
        console.log(`[VectorStore] Added ${docs.length} documents in batch`);
    }

    /**
     * Search for similar documents
     */
    async search(query: string, limit: number = 5, sourceType?: string): Promise<SearchResult[]> {
        const db = getDatabase();

        // 1. Generate query embedding
        const queryEmbedding = await this.generateEmbedding(query);

        // 2. Fetch all vectors (Linear Scan - optimized for small local datasets < 1000 items)
        // For larger datasets, we would need a native vector extension or optimized storage.
        const whereClause = sourceType ? 'WHERE source_type = ?' : '';
        const params = sourceType ? [sourceType] : [];

        const rows = await db.getAllAsync<{
            id: string;
            content: string;
            embedding: string;
            metadata: string;
        }>(`SELECT id, content, embedding, metadata FROM vectors ${whereClause}`, params);

        // 3. Compute Cosine Similarity in JS
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

        // 4. Sort and return top K
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
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

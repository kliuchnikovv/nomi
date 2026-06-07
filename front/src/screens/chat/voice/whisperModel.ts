/**
 * On-device Whisper model provisioning for the voice mode.
 *
 * whisper.rn needs two ggml checkpoints at runtime:
 *   - a multilingual Whisper model for transcription (auto language detection)
 *   - a Silero VAD model for speech-start / speech-end detection
 *
 * Both are downloaded once on first entry into voice mode and cached under the
 * app document directory. We use the legacy expo-file-system API because it is
 * the only one that exposes byte-level download progress (the new File API does
 * not), which matters for a ~150 MB one-time download.
 */
import * as FileSystem from 'expo-file-system/legacy';

// Public, free Hugging Face checkpoints. Change MODEL_STT_FILE to `ggml-small.bin`
// for higher accuracy at the cost of a larger download (~488 MB vs ~148 MB).
const HF_WHISPER = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const HF_VAD = 'https://huggingface.co/ggml-org/whisper-vad/resolve/main';

// Multilingual model — must NOT be an `*.en` (English-only) checkpoint, otherwise
// non-English speech is mis-transcribed.
const MODEL_STT_FILE = 'ggml-base.bin';
const MODEL_VAD_FILE = 'ggml-silero-v5.1.2.bin';

const STT_URL = `${HF_WHISPER}/${MODEL_STT_FILE}`;
const VAD_URL = `${HF_VAD}/${MODEL_VAD_FILE}`;

// A freshly-downloaded model must be at least this big; anything smaller is an
// error page / truncated download that we should discard and retry.
const MIN_VALID_BYTES = 1_000_000;

export interface WhisperModelPaths {
    /** Absolute file path of the transcription model. */
    sttPath: string;
    /** Absolute file path of the VAD model. */
    vadPath: string;
}

export type ModelStage = 'stt' | 'vad';

export interface ModelDownloadProgress {
    stage: ModelStage;
    /** 0..1, or null when the server did not report a content length. */
    progress: number | null;
}

function modelDir(): string {
    // documentDirectory is null only on web, which this iOS-only feature never hits.
    return `${FileSystem.documentDirectory}whisper/`;
}

function localPath(file: string): string {
    return `${modelDir()}${file}`;
}

async function ensureDir(): Promise<void> {
    const dir = modelDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
}

async function isValidFile(path: string): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(path);
    return (
        info.exists && !info.isDirectory && (info.size ?? 0) >= MIN_VALID_BYTES
    );
}

/** True when both checkpoints are already cached and look intact. */
export async function whisperModelsReady(): Promise<boolean> {
    const [stt, vad] = await Promise.all([
        isValidFile(localPath(MODEL_STT_FILE)),
        isValidFile(localPath(MODEL_VAD_FILE)),
    ]);
    return stt && vad;
}

async function downloadOne(
    url: string,
    file: string,
    stage: ModelStage,
    onProgress?: (p: ModelDownloadProgress) => void,
): Promise<string> {
    const dest = localPath(file);

    if (await isValidFile(dest)) {
        onProgress?.({ stage, progress: 1 });
        return dest;
    }

    // Remove any truncated leftover from a previous failed attempt.
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) {
        await FileSystem.deleteAsync(dest, { idempotent: true });
    }

    const task = FileSystem.createDownloadResumable(
        url,
        dest,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
            const progress =
                totalBytesExpectedToWrite > 0
                    ? totalBytesWritten / totalBytesExpectedToWrite
                    : null;
            onProgress?.({ stage, progress });
        },
    );

    const result = await task.downloadAsync();
    if (!result || !(await isValidFile(dest))) {
        await FileSystem.deleteAsync(dest, { idempotent: true });
        throw new Error(`Failed to download ${file}`);
    }

    onProgress?.({ stage, progress: 1 });
    return dest;
}

/**
 * Ensure both models are present, downloading any that are missing.
 * Safe to call on every voice-mode entry — returns immediately once cached.
 */
export async function ensureWhisperModels(
    onProgress?: (p: ModelDownloadProgress) => void,
): Promise<WhisperModelPaths> {
    await ensureDir();
    // VAD model is tiny, fetch it first so the (much larger) STT download owns
    // the visible progress bar.
    const vadPath = await downloadOne(
        VAD_URL,
        MODEL_VAD_FILE,
        'vad',
        onProgress,
    );
    const sttPath = await downloadOne(
        STT_URL,
        MODEL_STT_FILE,
        'stt',
        onProgress,
    );
    return { sttPath, vadPath };
}

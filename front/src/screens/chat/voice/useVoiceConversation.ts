import { useState, useEffect, useRef, useCallback } from 'react';
import * as Speech from 'expo-speech';
import { AppState, AppStateStatus, Linking } from 'react-native';
import {
    initWhisper,
    initWhisperVad,
    type WhisperContext,
    type WhisperVadContext,
} from 'whisper.rn';
import {
    RealtimeTranscriber,
    RingBufferVad,
} from 'whisper.rn/realtime-transcription';
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter';
import { useChat } from '../context';
import {
    ensureWhisperModels,
    type ModelDownloadProgress,
} from './whisperModel';

export type VoiceState =
    | 'loading'
    | 'idle'
    | 'listening'
    | 'processing'
    | 'speaking'
    | 'error';
export type ErrorKind = 'permission' | 'stt' | 'model' | null;

export interface UseVoiceConversationOptions {
    chatId: string;
}

export interface UseVoiceConversationResult {
    state: VoiceState;
    liveTranscript: string;
    errorKind: ErrorKind;
    /** Detected language code of the user's speech (e.g. 'ru', 'en'), or null. */
    detectedLanguage: string | null;
    /** Model download progress while in 'loading' state, or null once ready. */
    modelProgress: ModelDownloadProgress | null;
    interrupt(): void;
    stop(): void;
    openSettings(): void;
}

// Backstop after the VAD reports end-of-speech: if no further speech or
// transcription arrives within this window, finalize the turn. The VAD itself
// is the primary end-of-turn signal; this guards against missed events.
const SILENCE_TIMEOUT_MS = 900;
const MAX_STT_RETRIES = 3;

// --- Barge-in (interrupt the assistant by speaking) -------------------------
// Keeping the mic open while TTS plays risks the assistant transcribing its own
// voice (no hardware echo cancellation guaranteed by the audio stream lib), so
// barge-in is conservative and easy to disable if it misbehaves on device:
//  - mic only runs during 'speaking' (not while the assistant is "thinking"),
//  - a stricter VAD threshold during playback resists self-triggering,
//  - speech must be sustained before it counts as an interruption.
// The tap-to-interrupt gesture in VoiceScreen remains as a fallback.
const BARGE_IN_ENABLED = true;
const BARGE_IN_MIN_SPEECH_MS = 350;
const VAD_THRESHOLD_LISTEN = 0.5; // normal sensitivity when it's the user's turn
const VAD_THRESHOLD_SPEAKING = 0.7; // less sensitive while TTS is playing

// Sentence terminators across Latin / CJK scripts, used to chunk streaming
// assistant text for incremental TTS.
const SENTENCE_RE = /[^.!?…。！？\n]*[.!?…。！？\n]+/g;

// Map a 2-letter language code (from Whisper auto-detect) to a TTS-friendly
// BCP-47 locale. Falls back to the raw code, which expo-speech also accepts.
const TTS_LOCALE: Record<string, string> = {
    ru: 'ru-RU',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-BR',
    uk: 'uk-UA',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN',
};

// Extract speakable text from a message, including team-mode member_response content_parts.
function extractSpeakableText(msg: {
    text: string;
    content_parts?: any[];
}): string {
    const mainText = msg.text?.trim() ?? '';
    if (mainText) return mainText;
    if (msg.content_parts && msg.content_parts.length > 0) {
        return msg.content_parts
            .filter(
                (p: any) => p.type === 'text' || p.type === 'member_response',
            )
            .map((p: any) => p.text ?? '')
            .join(' ')
            .trim();
    }
    return '';
}

// Pull complete sentences off the front of `text`. When `flush` is true, also
// emit a trailing partial sentence (generation finished, nothing more coming).
// Returns the sentences and how many characters were consumed.
function takeSentences(
    text: string,
    flush: boolean,
): { sentences: string[]; consumed: number } {
    const sentences: string[] = [];
    let consumed = 0;
    SENTENCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_RE.exec(text)) !== null) {
        const chunk = m[0].trim();
        if (chunk) sentences.push(chunk);
        consumed = SENTENCE_RE.lastIndex;
    }
    if (flush && consumed < text.length) {
        const tail = text.slice(consumed).trim();
        if (tail) sentences.push(tail);
        consumed = text.length;
    }
    return { sentences, consumed };
}

// Choose the TTS locale from the response text's script (most reliable for the
// common ru/en split) with the Whisper-detected language as a fallback.
function pickTtsLanguage(text: string, detected: string | null): string | undefined {
    if (/[Ѐ-ӿ]/.test(text)) return 'ru-RU'; // Cyrillic
    if (/[぀-ヿ]/.test(text)) return 'ja-JP'; // Kana
    if (/[가-힯]/.test(text)) return 'ko-KR'; // Hangul
    if (detected) return TTS_LOCALE[detected] ?? detected;
    return undefined; // system default voice
}

export function useVoiceConversation({
    chatId,
}: UseVoiceConversationOptions): UseVoiceConversationResult {
    const [voiceState, setVoiceState] = useState<VoiceState>('loading');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [errorKind, setErrorKind] = useState<ErrorKind>(null);
    const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
    const [modelProgress, setModelProgress] =
        useState<ModelDownloadProgress | null>(null);

    const { sendMessage, assistantWorking, messages } = useChat();

    const isMountedRef = useRef(true);
    const voiceStateRef = useRef<VoiceState>('loading');
    const assistantWorkingRef = useRef(assistantWorking);

    // whisper.rn engine handles
    const whisperCtxRef = useRef<WhisperContext | null>(null);
    const vadCtxRef = useRef<WhisperVadContext | null>(null);
    const transcriberRef = useRef<RealtimeTranscriber | null>(null);
    const engineRunningRef = useRef(false);

    // Current listening turn accumulation
    const turnSegmentsRef = useRef<string[]>([]); // stabilized slice texts
    const liveSliceRef = useRef(''); // in-progress slice text
    const hasSpeechRef = useRef(false);
    const finalizingRef = useRef(false);
    const detectedLangRef = useRef<string | null>(null);
    const turnEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sttRetryCountRef = useRef(0);

    // Barge-in tracking: timestamp (ms) of speech onset detected during playback.
    const bargeInStartRef = useRef<number | null>(null);

    // Streaming-TTS bookkeeping
    const spokenOffsetRef = useRef(0); // chars of current assistant msg enqueued
    const currentAssistantIdRef = useRef<string | null>(null);
    const ttsActiveCountRef = useRef(0); // queued-but-not-finished utterances
    const ttsLangRef = useRef<string | undefined>(undefined);
    const lastFullLenRef = useRef(0);

    const applyState = useCallback((s: VoiceState) => {
        voiceStateRef.current = s;
        setVoiceState(s);
    }, []);

    useEffect(() => {
        assistantWorkingRef.current = assistantWorking;
    }, [assistantWorking]);

    const clearTurnEndTimer = useCallback(() => {
        if (turnEndTimerRef.current) {
            clearTimeout(turnEndTimerRef.current);
            turnEndTimerRef.current = null;
        }
    }, []);

    const currentTurnText = useCallback(() => {
        return [...turnSegmentsRef.current, liveSliceRef.current]
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }, []);

    // ---- Audio engine on/off -------------------------------------------------

    const startEngine = useCallback(async () => {
        if (engineRunningRef.current) return;
        await transcriberRef.current?.start();
        engineRunningRef.current = true;
    }, []);
    const startEngineRef = useRef(startEngine);
    useEffect(() => {
        startEngineRef.current = startEngine;
    }, [startEngine]);

    const stopEngine = useCallback(async () => {
        if (!engineRunningRef.current) return;
        engineRunningRef.current = false;
        try {
            await transcriberRef.current?.stop();
        } catch {
            /* ignore */
        }
    }, []);
    const stopEngineRef = useRef(stopEngine);
    useEffect(() => {
        stopEngineRef.current = stopEngine;
    }, [stopEngine]);

    // ---- Listening lifecycle -------------------------------------------------

    const clearTurnAccumulation = useCallback(() => {
        turnSegmentsRef.current = [];
        liveSliceRef.current = '';
        hasSpeechRef.current = false;
        finalizingRef.current = false;
        bargeInStartRef.current = null;
        setLiveTranscript('');
    }, []);

    // Resume a fresh listening turn. `keepAudio` is set by barge-in, where the
    // mic is already capturing the user's interrupting speech and must not be
    // reset (which would clip the first words).
    const resumeListening = useCallback(
        async (keepAudio = false) => {
            const t = transcriberRef.current;
            if (!t) return;
            clearTurnEndTimer();
            clearTurnAccumulation();
            try {
                t.updateVadOptions({ threshold: VAD_THRESHOLD_LISTEN });
                await startEngineRef.current();
                if (!keepAudio) t.reset();
                applyState('listening');
            } catch (err: any) {
                const msg = String(err?.message ?? '').toLowerCase();
                const isPermission =
                    msg.includes('permission') ||
                    msg.includes('not authorized');
                setErrorKind(isPermission ? 'permission' : 'stt');
                applyState('error');
            }
        },
        [applyState, clearTurnAccumulation, clearTurnEndTimer],
    );
    const resumeListeningRef = useRef(resumeListening);
    useEffect(() => {
        resumeListeningRef.current = resumeListening;
    }, [resumeListening]);

    const finalizeTurn = useCallback(async () => {
        if (voiceStateRef.current !== 'listening') return;
        if (finalizingRef.current) return;
        clearTurnEndTimer();

        const text = currentTurnText();
        if (!text) {
            // Nothing recognized — count as a miss and retry / give up gracefully.
            sttRetryCountRef.current += 1;
            if (sttRetryCountRef.current >= MAX_STT_RETRIES) {
                sttRetryCountRef.current = 0;
                setLiveTranscript("Couldn't hear you — try again");
                retryTimerRef.current = setTimeout(
                    () => resumeListeningRef.current(),
                    2000,
                );
            } else {
                resumeListeningRef.current();
            }
            return;
        }

        finalizingRef.current = true;
        sttRetryCountRef.current = 0;
        setDetectedLanguage(detectedLangRef.current);
        // Stop the mic while the assistant thinks — no recording, no feedback.
        await stopEngineRef.current();
        applyState('processing');
        sendMessage(text);
    }, [applyState, clearTurnEndTimer, currentTurnText, sendMessage]);

    const finalizeTurnRef = useRef(finalizeTurn);
    useEffect(() => {
        finalizeTurnRef.current = finalizeTurn;
    }, [finalizeTurn]);

    const armTurnEnd = useCallback(() => {
        clearTurnEndTimer();
        turnEndTimerRef.current = setTimeout(() => {
            if (voiceStateRef.current === 'listening' && hasSpeechRef.current) {
                finalizeTurnRef.current();
            }
        }, SILENCE_TIMEOUT_MS);
    }, [clearTurnEndTimer]);

    // ---- Barge-in ------------------------------------------------------------

    // Open the mic for the duration of playback so the user can interrupt.
    const armBargeIn = useCallback(() => {
        if (!BARGE_IN_ENABLED) return;
        bargeInStartRef.current = null;
        try {
            transcriberRef.current?.updateVadOptions({
                threshold: VAD_THRESHOLD_SPEAKING,
            });
        } catch {
            /* ignore */
        }
        startEngineRef.current().catch(() => {});
    }, []);
    const armBargeInRef = useRef(armBargeIn);
    useEffect(() => {
        armBargeInRef.current = armBargeIn;
    }, [armBargeIn]);

    // User interrupted: cut the assistant off and capture what they're saying.
    const triggerBargeIn = useCallback(() => {
        Speech.stop();
        ttsActiveCountRef.current = 0;
        currentAssistantIdRef.current = null;
        spokenOffsetRef.current = 0;
        try {
            transcriberRef.current?.updateVadOptions({
                threshold: VAD_THRESHOLD_LISTEN,
            });
        } catch {
            /* ignore */
        }
        // Keep the engine running — it is mid-capture of the user's speech.
        clearTurnEndTimer();
        turnSegmentsRef.current = [];
        liveSliceRef.current = '';
        hasSpeechRef.current = true;
        finalizingRef.current = false;
        bargeInStartRef.current = null;
        setLiveTranscript('');
        applyState('listening');
        armTurnEnd();
    }, [applyState, armTurnEnd, clearTurnEndTimer]);
    const triggerBargeInRef = useRef(triggerBargeIn);
    useEffect(() => {
        triggerBargeInRef.current = triggerBargeIn;
    }, [triggerBargeIn]);

    // ---- Engine initialization ----------------------------------------------

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { sttPath, vadPath } = await ensureWhisperModels(p => {
                    if (!cancelled) setModelProgress(p);
                });
                if (cancelled) return;
                setModelProgress(null);

                const whisperCtx = await initWhisper({
                    filePath: sttPath,
                    useGpu: true,
                    useFlashAttn: true,
                });
                if (cancelled) {
                    whisperCtx.release();
                    return;
                }
                whisperCtxRef.current = whisperCtx;

                const vadCtx = await initWhisperVad({
                    filePath: vadPath,
                    useGpu: true,
                });
                if (cancelled) {
                    vadCtx.release();
                    return;
                }
                vadCtxRef.current = vadCtx;

                const ringVad = new RingBufferVad(vadCtx, {
                    vadPreset: 'default',
                });
                const audioStream = new AudioPcmStreamAdapter();

                const transcriber = new RealtimeTranscriber(
                    {
                        whisperContext: whisperCtx,
                        vadContext: ringVad,
                        audioStream,
                    },
                    {
                        // 'auto' → Whisper detects the spoken language per slice.
                        // Auto-slicing on speech-end is driven by the VAD context.
                        transcribeOptions: { language: 'auto' },
                        audioSliceSec: 30,
                    },
                    {
                        onVad: event => {
                            const st = voiceStateRef.current;
                            if (st === 'listening') {
                                if (event.type === 'speech_start') {
                                    hasSpeechRef.current = true;
                                    clearTurnEndTimer();
                                } else if (
                                    event.type === 'speech_end' ||
                                    event.type === 'silence'
                                ) {
                                    if (hasSpeechRef.current) armTurnEnd();
                                }
                            } else if (st === 'speaking' && BARGE_IN_ENABLED) {
                                if (event.type === 'speech_start') {
                                    bargeInStartRef.current = Date.now();
                                } else if (event.type === 'speech_continue') {
                                    const started = bargeInStartRef.current;
                                    if (
                                        started != null &&
                                        Date.now() - started >=
                                            BARGE_IN_MIN_SPEECH_MS
                                    ) {
                                        triggerBargeInRef.current();
                                    }
                                } else {
                                    bargeInStartRef.current = null;
                                }
                            }
                        },
                        onTranscribe: event => {
                            if (voiceStateRef.current !== 'listening') return;
                            const data = event.data;
                            if (!data) return;
                            if (data.language) {
                                detectedLangRef.current = data.language;
                            }
                            const partial = data.result?.trim() ?? '';
                            if (partial) {
                                liveSliceRef.current = partial;
                                hasSpeechRef.current = true;
                                setLiveTranscript(currentTurnText());
                                armTurnEnd();
                            }
                        },
                        onSliceTranscriptionStabilized: text => {
                            if (voiceStateRef.current !== 'listening') return;
                            const t = text?.trim() ?? '';
                            if (t) {
                                turnSegmentsRef.current.push(t);
                                liveSliceRef.current = '';
                                hasSpeechRef.current = true;
                                setLiveTranscript(currentTurnText());
                                armTurnEnd();
                            }
                        },
                        onError: () => {
                            // Transient stream/transcription errors — keep listening.
                        },
                    },
                );
                transcriberRef.current = transcriber;

                if (cancelled) return;
                await resumeListeningRef.current();
            } catch (err: any) {
                if (cancelled) return;
                setErrorKind('model');
                applyState('error');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [applyState, armTurnEnd, clearTurnEndTimer, currentTurnText]);

    // ---- Streaming TTS -------------------------------------------------------

    const onUtteranceDone = useCallback(() => {
        ttsActiveCountRef.current = Math.max(0, ttsActiveCountRef.current - 1);
        if (
            ttsActiveCountRef.current === 0 &&
            !assistantWorkingRef.current &&
            voiceStateRef.current === 'speaking' &&
            spokenOffsetRef.current >= lastFullLenRef.current
        ) {
            resumeListeningRef.current();
        }
    }, []);

    const enqueueSpeak = useCallback(
        (sentence: string) => {
            ttsActiveCountRef.current += 1;
            Speech.speak(sentence, {
                language: ttsLangRef.current,
                onDone: onUtteranceDone,
                onError: onUtteranceDone,
            });
        },
        [onUtteranceDone],
    );

    // Speak assistant text sentence-by-sentence as it streams in, instead of
    // waiting for the whole response. Runs while handling a response turn.
    useEffect(() => {
        const state = voiceStateRef.current;
        if (state !== 'processing' && state !== 'speaking') return;

        const lastAssistant = [...messages]
            .reverse()
            .find(m => m.role === 'assistant');
        if (!lastAssistant) return;

        if (lastAssistant.id !== currentAssistantIdRef.current) {
            currentAssistantIdRef.current = lastAssistant.id;
            spokenOffsetRef.current = 0;
            ttsLangRef.current = undefined;
        }

        const full = extractSpeakableText(lastAssistant);
        lastFullLenRef.current = full.length;

        const pending = full.slice(spokenOffsetRef.current);
        const { sentences, consumed } = takeSentences(pending, !assistantWorking);

        if (sentences.length > 0) {
            if (ttsLangRef.current === undefined) {
                ttsLangRef.current = pickTtsLanguage(
                    full,
                    detectedLangRef.current,
                );
            }
            if (voiceStateRef.current === 'processing') {
                applyState('speaking');
                armBargeInRef.current(); // open mic so the user can interrupt
            }
            sentences.forEach(enqueueSpeak);
            spokenOffsetRef.current += consumed;
        }

        // Tool-call-only / empty responses: nothing to speak — resume listening.
        if (
            !assistantWorking &&
            ttsActiveCountRef.current === 0 &&
            voiceStateRef.current === 'processing' &&
            full.length === 0
        ) {
            resumeListeningRef.current();
        }
    }, [assistantWorking, messages, applyState, enqueueSpeak]);

    // Safety net: stuck in 'processing' shortly after generation ends with no
    // speakable text and no queued audio — resume listening.
    useEffect(() => {
        if (assistantWorking) return;
        if (voiceStateRef.current !== 'processing') return;
        const timer = setTimeout(() => {
            if (
                voiceStateRef.current === 'processing' &&
                ttsActiveCountRef.current === 0
            ) {
                resumeListeningRef.current();
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [assistantWorking]);

    // ---- App background ------------------------------------------------------

    useEffect(() => {
        const sub = AppState.addEventListener(
            'change',
            (next: AppStateStatus) => {
                if (next === 'background' || next === 'inactive') {
                    Speech.stop();
                    ttsActiveCountRef.current = 0;
                    stopEngineRef.current();
                    clearTurnEndTimer();
                    applyState('idle');
                }
            },
        );
        return () => sub.remove();
    }, [clearTurnEndTimer, applyState]);

    // ---- Mount / unmount -----------------------------------------------------

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            Speech.stop();
            clearTurnEndTimer();
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
            const t = transcriberRef.current;
            transcriberRef.current = null;
            engineRunningRef.current = false;
            (async () => {
                try {
                    await t?.release();
                } catch {
                    /* ignore */
                }
                try {
                    await whisperCtxRef.current?.release();
                } catch {
                    /* ignore */
                }
                try {
                    await vadCtxRef.current?.release();
                } catch {
                    /* ignore */
                }
            })();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const interrupt = useCallback(() => {
        if (voiceStateRef.current === 'speaking') {
            Speech.stop();
            ttsActiveCountRef.current = 0;
            currentAssistantIdRef.current = null;
            spokenOffsetRef.current = 0;
            resumeListeningRef.current();
        }
    }, []);

    const stop = useCallback(() => {
        Speech.stop();
        ttsActiveCountRef.current = 0;
        clearTurnEndTimer();
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        stopEngineRef.current();
        applyState('idle');
    }, [clearTurnEndTimer, applyState]);

    const openSettings = useCallback(() => {
        Linking.openSettings();
    }, []);

    return {
        state: voiceState,
        liveTranscript,
        errorKind,
        detectedLanguage,
        modelProgress,
        interrupt,
        stop,
        openSettings,
    };
}

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Speech from 'expo-speech';
// SDK 54: the string-based file API (writeAsStringAsync + cacheDirectory) lives
// in the legacy entrypoint; importing it from the main module now throws.
import * as FileSystem from 'expo-file-system/legacy';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { AppState, AppStateStatus, Linking } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { useChat } from '../context';
import { useAuth } from '../../auth/context';
import { ttsApi } from '../../../apiClient';

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

// Languages offered in the in-call switcher. `code` is a BCP-47 locale passed to
// the native recognizer; `label` is shown on the toggle; `short` drives TTS.
export interface VoiceLanguageOption {
    code: string;
    label: string;
    short: string;
}
export const VOICE_LANGUAGES: VoiceLanguageOption[] = [
    { code: 'ru-RU', label: 'RU', short: 'ru' },
    { code: 'en-US', label: 'EN', short: 'en' },
];
const DEFAULT_LANGUAGE = 'ru-RU';

export interface UseVoiceConversationResult {
    state: VoiceState;
    liveTranscript: string;
    /** Speakable text of the latest assistant reply (the model's current message). */
    assistantText: string;
    errorKind: ErrorKind;
    /** Detected language code of the user's speech (e.g. 'ru', 'en'), or null. */
    detectedLanguage: string | null;
    /** Model download progress — always null now (native engine, no download). */
    modelProgress: null;
    /** Current recognition locale (BCP-47, e.g. 'ru-RU'). */
    language: string;
    /** Switch the recognition language; restarts capture mid-call if listening. */
    setLanguage(code: string): void;
    interrupt(): void;
    stop(): void;
    openSettings(): void;
}

// We run the native recognizer in `continuous` mode and own end-of-turn
// detection ourselves: a turn finalizes only after a real trailing silence once
// speech has actually been heard. This avoids iOS's eager endpointing, which
// (with `continuous: false`) ends the session on the first pause / first
// `isFinal` and drops speech the user was still saying.
const END_SILENCE_MS = 1300; // trailing silence after speech before finalizing
const ENDPOINT_CHECK_INTERVAL_MS = 250;

// Silent re-listen debounce when a session ends with no speech (user hasn't
// spoken yet) — keep listening instead of nagging the user.
const RELISTEN_DEBOUNCE_MS = 300;

// Wedged-recognizer safety net: if the session keeps ending empty in rapid
// succession (no speech ever captured), surface an error instead of looping.
const MAX_EMPTY_RESTARTS = 8;
const EMPTY_RESTART_WINDOW_MS = 8000;

// Start TTS as early as possible: for the FIRST chunk of a reply we break on a
// clause boundary (or this many characters) instead of waiting for a full
// sentence, cutting time-to-first-audio. Later chunks use sentence boundaries.
const FIRST_CHUNK_MIN_CHARS = 12;

// Sentence terminators across Latin / CJK scripts, used to chunk streaming
// assistant text for incremental TTS.
const SENTENCE_RE = /[^.!?…。！？\n]*[.!?…。！？\n]+/g;
// Clause boundaries (commas, dashes, colons, newline) used only to emit the
// first spoken chunk sooner.
const CLAUSE_RE = /[^,;:—–\n]*[,;:—–\n]+/g;

// TTS voice tuning. The biggest lever on naturalness is the device voice
// (Enhanced/Premium) chosen below; rate/pitch are kept near-neutral.
const TTS_RATE = 1.0; // 1.0 = system default speaking rate
const TTS_PITCH = 1.0; // 1.0 = normal pitch

// Strip emoji / pictographs before speaking so the TTS engine doesn't read them
// aloud (e.g. "smiling face", "party popper"). Explicit Unicode ranges (with the
// `u` flag) are used for engine portability instead of \p{Extended_Pictographic}.
const EMOJI_RE =
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu;
function stripForSpeech(text: string): string {
    return text.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
}

// --- Resume-after-TTS watchdog ----------------------------------------------
// Resuming to 'listening' after a reply hangs off expo-speech's onDone/onError
// callbacks, which are unreliable on iOS. This watchdog runs once generation is
// done: resume when the TTS queue drains, or force-resume if the engine reports
// it is idle while utterances are still queued (a lost onDone).
const TTS_WATCHDOG_INTERVAL_MS = 400;
const TTS_DRAIN_GRACE_MS = 500;
const TTS_STALL_MS = 1500;

// Map a 2-letter language code to a TTS-friendly BCP-47 locale.
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
// When `earlyFirst` is true (nothing spoken yet for this reply) and no full
// sentence is available, emit one early chunk on the first clause boundary at or
// past FIRST_CHUNK_MIN_CHARS — this lowers time-to-first-audio without making
// the whole reply choppy.
function takeSentences(
    text: string,
    flush: boolean,
    earlyFirst = false,
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
    // No complete sentence yet, but we haven't spoken anything for this reply —
    // try to emit a first clause so audio starts sooner.
    if (!flush && earlyFirst && sentences.length === 0) {
        CLAUSE_RE.lastIndex = 0;
        const c = CLAUSE_RE.exec(text);
        if (c && c.index + c[0].length >= FIRST_CHUNK_MIN_CHARS) {
            const chunk = c[0].trim();
            if (chunk) {
                sentences.push(chunk);
                consumed = CLAUSE_RE.lastIndex;
            }
        }
    }
    return { sentences, consumed };
}

// Choose the TTS locale from the response text's script (most reliable for the
// common ru/en split) with the user's selected language as a fallback.
function pickTtsLanguage(text: string, fallbackShort: string): string {
    if (/[Ѐ-ӿ]/.test(text)) return 'ru-RU'; // Cyrillic
    if (/[぀-ヿ]/.test(text)) return 'ja-JP'; // Kana
    if (/[가-힯]/.test(text)) return 'ko-KR'; // Hangul
    return TTS_LOCALE[fallbackShort] ?? fallbackShort;
}

export function useVoiceConversation({
    chatId: _chatId,
}: UseVoiceConversationOptions): UseVoiceConversationResult {
    const [voiceState, setVoiceState] = useState<VoiceState>('loading');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [errorKind, setErrorKind] = useState<ErrorKind>(null);
    const [language, setLanguageState] = useState<string>(DEFAULT_LANGUAGE);

    const { sendMessage, assistantWorking, messages } = useChat();
    const { user } = useAuth();

    const isMountedRef = useRef(true);
    const voiceStateRef = useRef<VoiceState>('loading');
    const assistantWorkingRef = useRef(assistantWorking);
    const languageRef = useRef<string>(DEFAULT_LANGUAGE);
    const onDeviceRef = useRef(false);
    const recognizingRef = useRef(false);

    // Current listening turn accumulation.
    const finalTextRef = useRef(''); // consolidated final transcript(s)
    const interimRef = useRef(''); // latest in-progress transcript
    const hasSpeechRef = useRef(false);
    const finalizingRef = useRef(false);
    const lastResultAtRef = useRef(0); // last time the transcript changed
    const endpointingRef = useRef(false); // we called stop() to finalize the turn
    // Safety-net bookkeeping for rapid empty re-listens (wedged recognizer).
    const emptyRestartCountRef = useRef(0);
    const emptyRestartWindowAtRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Streaming-TTS bookkeeping.
    const spokenOffsetRef = useRef(0);
    const currentAssistantIdRef = useRef<string | null>(null);
    // Reply that was interrupted (tap or barge-in): never speak it again, even
    // if it keeps streaming. A genuinely new reply has a different id.
    const interruptedAssistantIdRef = useRef<string | null>(null);
    const ttsActiveCountRef = useRef(0);
    const ttsLangRef = useRef<string | undefined>(undefined);
    const lastFullLenRef = useRef(0);
    const lastTtsActivityAtRef = useRef(0);
    // Best available device voice per language prefix (e.g. 'ru' -> identifier),
    // resolved once from getAvailableVoicesAsync, preferring Enhanced quality.
    const voiceByLangRef = useRef<Record<string, string>>({});

    // --- Server-side Gemini TTS backend (experimental `server_gemini` source) --
    const serverTtsRef = useRef(user?.voice_source === 'server_gemini');
    useEffect(() => {
        serverTtsRef.current = user?.voice_source === 'server_gemini';
    }, [user?.voice_source]);
    // Sequential play chain so streamed sentences play in order.
    const serverChainRef = useRef<Promise<void>>(Promise.resolve());
    const serverPlayingRef = useRef(false); // a clip is actively playing
    const playEndResolveRef = useRef<(() => void) | null>(null);
    const ttsFileSeqRef = useRef(0);

    // The model's current message — speakable text of the latest assistant reply.
    // Updates live as the reply streams in; shown on-screen during the turn.
    const assistantText = useMemo(() => {
        const last = [...messages].reverse().find(m => m.role === 'assistant');
        return last ? extractSpeakableText(last) : '';
    }, [messages]);

    const applyState = useCallback((s: VoiceState) => {
        voiceStateRef.current = s;
        setVoiceState(s);
    }, []);

    useEffect(() => {
        assistantWorkingRef.current = assistantWorking;
    }, [assistantWorking]);

    const currentTurnText = useCallback(() => {
        return [finalTextRef.current, interimRef.current]
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }, []);

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

    // ---- Recognition lifecycle ----------------------------------------------

    const startListening = useCallback(async () => {
        if (!isMountedRef.current) return;
        clearRetryTimer();
        finalTextRef.current = '';
        interimRef.current = '';
        hasSpeechRef.current = false;
        finalizingRef.current = false;
        endpointingRef.current = false;
        lastResultAtRef.current = Date.now();
        setLiveTranscript('');
        try {
            // The native engine throws if a session is already active — make
            // sure the previous one is fully torn down before (re)starting.
            if (recognizingRef.current) {
                try {
                    ExpoSpeechRecognitionModule.abort();
                } catch {
                    /* ignore */
                }
            }
            ExpoSpeechRecognitionModule.start({
                lang: languageRef.current,
                interimResults: true,
                // We own end-of-turn detection (trailing-silence endpointer
                // below). Continuous keeps the mic open so iOS doesn't end the
                // session on the first pause and drop the user's speech.
                continuous: true,
                requiresOnDeviceRecognition: onDeviceRef.current,
                addsPunctuation: true,
                iosTaskHint: 'dictation',
            });
            applyState('listening');
        } catch (err: any) {
            console.warn('[voice] start failed', err?.message ?? err);
            setErrorKind('stt');
            applyState('error');
        }
    }, [applyState, clearRetryTimer]);
    const startListeningRef = useRef(startListening);
    useEffect(() => {
        startListeningRef.current = startListening;
    }, [startListening]);

    const finalizeTurn = useCallback(
        (text: string) => {
            if (finalizingRef.current) return;
            finalizingRef.current = true;
            // A captured turn means the recognizer is healthy — reset the
            // wedged-recognizer safety net.
            emptyRestartCountRef.current = 0;
            applyState('processing');
            sendMessage(text);
        },
        [applyState, sendMessage],
    );
    const finalizeTurnRef = useRef(finalizeTurn);
    useEffect(() => {
        finalizeTurnRef.current = finalizeTurn;
    }, [finalizeTurn]);

    // The session ended with no speech (user simply hasn't spoken yet). Keep
    // listening silently — no nagging. Only bail to an error if the recognizer
    // is wedged: many empty sessions in rapid succession with zero speech.
    const relisten = useCallback(() => {
        clearRetryTimer();
        const now = Date.now();
        if (now - emptyRestartWindowAtRef.current > EMPTY_RESTART_WINDOW_MS) {
            emptyRestartWindowAtRef.current = now;
            emptyRestartCountRef.current = 0;
        }
        emptyRestartCountRef.current += 1;
        if (emptyRestartCountRef.current >= MAX_EMPTY_RESTARTS) {
            emptyRestartCountRef.current = 0;
            console.warn('[voice] recognizer wedged — surfacing stt error');
            setErrorKind('stt');
            applyState('error');
            return;
        }
        retryTimerRef.current = setTimeout(
            () => startListeningRef.current(),
            RELISTEN_DEBOUNCE_MS,
        );
    }, [applyState, clearRetryTimer]);
    const relistenRef = useRef(relisten);
    useEffect(() => {
        relistenRef.current = relisten;
    }, [relisten]);

    // ---- Server-side Gemini TTS backend -------------------------------------

    // Play one base64 WAV clip; resolves when playback ends (or on error/stop).
    // AudioRecorderPlayer configures its own playback audio session — we must
    // NOT touch the session ourselves (doing so churns the audio route and
    // kills both playback and the recognizer engine).
    const playServerClip = useCallback(async (audioB64: string) => {
        const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
        // Rotate through a small fixed set of filenames (writeAsStringAsync
        // overwrites) so temp clips never accumulate unbounded.
        ttsFileSeqRef.current = (ttsFileSeqRef.current + 1) % 8;
        const uri = `${dir}nomi-tts-${ttsFileSeqRef.current}.wav`;
        await FileSystem.writeAsStringAsync(uri, audioB64, {
            encoding: 'base64',
        });

        // Compute the clip's true duration from the WAV we generated ourselves
        // (24 kHz, 16-bit, mono => 48000 bytes/sec). The player is a singleton
        // and reports a STALE duration from the previous clip on its first
        // progress callbacks, so a `position >= duration` check stops playback
        // a fraction of a second in. A self-computed duration is reliable.
        const decodedBytes = Math.floor((audioB64.length * 3) / 4);
        const pcmBytes = Math.max(0, decodedBytes - 44); // minus WAV header
        const expectedMs = Math.max(800, Math.round(pcmBytes / 48 + 700));

        await new Promise<void>(resolve => {
            let finished = false;
            let startedAt = 0;
            let timer: ReturnType<typeof setTimeout> | null = null;
            const done = () => {
                if (finished) return;
                finished = true;
                if (timer) clearTimeout(timer);
                try {
                    AudioRecorderPlayer.removePlaybackEndListener();
                } catch {
                    /* ignore */
                }
                AudioRecorderPlayer.stopPlayer().catch(() => {});
                playEndResolveRef.current = null;
                resolve();
            };
            // Lets stopServerTts()/interrupt cut the current clip short.
            playEndResolveRef.current = done;
            // Honor a native end event, but only after most of the clip has
            // actually played — guards against an early/spurious end callback.
            AudioRecorderPlayer.addPlaybackEndListener(() => {
                const elapsed = startedAt ? Date.now() - startedAt : 0;
                if (elapsed >= expectedMs * 0.6) done();
            });
            startedAt = Date.now();
            // Deterministic completion: play for the clip's real duration.
            timer = setTimeout(done, expectedMs);
            AudioRecorderPlayer.startPlayer(uri).catch(() => done());
        });
    }, []);

    // Synthesize `text` on the server and play it (driven by the chain below).
    // `serverPlayingRef` stays true across BOTH synth and playback so the resume
    // watchdog doesn't mistake a slow synthesis for a stalled turn.
    const speakViaServer = useCallback(
        async (text: string) => {
            serverPlayingRef.current = true;
            try {
                const res = await ttsApi.synthesize({ text });
                if (res?.audio) await playServerClip(res.audio);
            } finally {
                serverPlayingRef.current = false;
            }
        },
        [playServerClip],
    );

    // Stop whatever is playing and clear the queue (server backend).
    const stopServerTts = useCallback(() => {
        serverChainRef.current = Promise.resolve();
        AudioRecorderPlayer.stopPlayer().catch(() => {});
        AudioRecorderPlayer.removePlaybackEndListener();
        serverPlayingRef.current = false;
        if (playEndResolveRef.current) {
            const resolve = playEndResolveRef.current;
            playEndResolveRef.current = null;
            resolve();
        }
    }, []);

    // Backend-aware stop: server player or on-device expo-speech.
    const stopTts = useCallback(() => {
        if (serverTtsRef.current) stopServerTts();
        else Speech.stop();
    }, [stopServerTts]);
    const stopTtsRef = useRef(stopTts);
    useEffect(() => {
        stopTtsRef.current = stopTts;
    }, [stopTts]);

    // Backend-aware "is audio currently playing?" for the resume watchdog.
    const isSpeakingTts = useCallback(async () => {
        if (serverTtsRef.current) return serverPlayingRef.current;
        try {
            return await Speech.isSpeakingAsync();
        } catch {
            return false;
        }
    }, []);
    const isSpeakingTtsRef = useRef(isSpeakingTts);
    useEffect(() => {
        isSpeakingTtsRef.current = isSpeakingTts;
    }, [isSpeakingTts]);

    // ---- Streaming TTS -------------------------------------------------------

    const onUtteranceDone = useCallback(() => {
        ttsActiveCountRef.current = Math.max(0, ttsActiveCountRef.current - 1);
        lastTtsActivityAtRef.current = Date.now();
        if (
            ttsActiveCountRef.current === 0 &&
            !assistantWorkingRef.current &&
            voiceStateRef.current === 'speaking' &&
            spokenOffsetRef.current >= lastFullLenRef.current
        ) {
            startListeningRef.current();
        }
    }, []);

    const enqueueSpeak = useCallback(
        (sentence: string) => {
            const clean = stripForSpeech(sentence);
            // Sentence was only emoji/whitespace — nothing to say, don't count it.
            if (!clean) return;
            ttsActiveCountRef.current += 1;
            lastTtsActivityAtRef.current = Date.now();

            // Server-side Gemini voice: synthesize + play sequentially. The
            // chain preserves sentence order; onUtteranceDone drives resume.
            if (serverTtsRef.current) {
                serverChainRef.current = serverChainRef.current
                    .then(() => speakViaServer(clean))
                    .catch(e =>
                        console.warn(
                            '[voice] server tts failed',
                            e?.message ?? e,
                        ),
                    )
                    .finally(() => onUtteranceDone());
                return;
            }

            const prefix = (ttsLangRef.current ?? '')
                .toLowerCase()
                .split('-')[0];
            Speech.speak(clean, {
                language: ttsLangRef.current,
                voice: voiceByLangRef.current[prefix],
                rate: TTS_RATE,
                pitch: TTS_PITCH,
                // Use a dedicated playback session instead of the recognizer's.
                // The recognizer leaves the shared AVAudioSession in
                // playAndRecord/measurement, which routes TTS to the quiet
                // earpiece; a separate session plays at full loudspeaker volume.
                useApplicationAudioSession: false,
                onDone: onUtteranceDone,
                onError: onUtteranceDone,
            });
        },
        [onUtteranceDone, speakViaServer],
    );

    // Speak assistant text sentence-by-sentence as it streams in.
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
            // A genuinely new reply — clear any prior interruption marker.
            interruptedAssistantIdRef.current = null;
        }

        // This reply was interrupted (tap or barge-in): never speak it again,
        // even if it keeps streaming.
        if (lastAssistant.id === interruptedAssistantIdRef.current) return;

        const full = extractSpeakableText(lastAssistant);
        lastFullLenRef.current = full.length;

        // Server Gemini TTS is billed/quota-limited per request (free tier:
        // ~10 req/min). Per-sentence synthesis blows that budget instantly and
        // the SDK then retries every 429, cascading. So in server mode we wait
        // for the *complete* reply and synthesize it in a SINGLE request. The
        // on-device path keeps the low-latency per-sentence streaming.
        const pending = full.slice(spokenOffsetRef.current);
        let sentences: string[];
        let consumed: number;
        if (serverTtsRef.current) {
            if (assistantWorking) {
                // Reply still streaming: synthesize ONLY the first sentence, as
                // soon as it's complete, so audio starts tracking the text
                // instead of waiting for the whole reply. Everything after it is
                // sent as one more request at flush — 2 TTS calls/turn, which
                // stays within the free-tier 10/min budget.
                if (spokenOffsetRef.current === 0) {
                    SENTENCE_RE.lastIndex = 0;
                    const sm = SENTENCE_RE.exec(pending);
                    const chunk = sm ? sm[0].trim() : '';
                    sentences = chunk ? [chunk] : [];
                    consumed = chunk ? SENTENCE_RE.lastIndex : 0;
                } else {
                    sentences = [];
                    consumed = 0;
                }
            } else {
                const whole = pending.trim();
                sentences = whole ? [whole] : [];
                consumed = pending.length;
            }
        } else {
            ({ sentences, consumed } = takeSentences(
                pending,
                !assistantWorking,
                spokenOffsetRef.current === 0, // earlyFirst: nothing spoken yet
            ));
        }

        if (sentences.length > 0) {
            if (ttsLangRef.current === undefined) {
                ttsLangRef.current = pickTtsLanguage(
                    full,
                    languageRef.current.split('-')[0],
                );
            }
            if (voiceStateRef.current === 'processing') {
                applyState('speaking');
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
            startListeningRef.current();
        }
    }, [assistantWorking, messages, applyState, enqueueSpeak]);

    // Resume-after-TTS watchdog (covers lost expo-speech onDone, late updates).
    useEffect(() => {
        if (assistantWorking) return;
        if (voiceState !== 'processing' && voiceState !== 'speaking') return;
        const id = setInterval(() => {
            const st = voiceStateRef.current;
            if (st !== 'processing' && st !== 'speaking') return;
            if (assistantWorkingRef.current) return;
            const idleMs = Date.now() - lastTtsActivityAtRef.current;
            if (ttsActiveCountRef.current === 0) {
                if (idleMs >= TTS_DRAIN_GRACE_MS) {
                    startListeningRef.current();
                }
            } else if (idleMs >= TTS_STALL_MS) {
                isSpeakingTtsRef
                    .current()
                    .then(speaking => {
                        if (speaking) return;
                        if (assistantWorkingRef.current) return;
                        const s = voiceStateRef.current;
                        if (s !== 'processing' && s !== 'speaking') return;
                        if (ttsActiveCountRef.current === 0) return;
                        // The reply finished streaming and was fully consumed;
                        // just stop the stalled tail and resume. Leave
                        // currentAssistantId/spokenOffset intact so the reply
                        // isn't re-spoken on the next render (cf. Fix 2).
                        stopTtsRef.current();
                        ttsActiveCountRef.current = 0;
                        startListeningRef.current();
                    })
                    .catch(() => {});
            }
        }, TTS_WATCHDOG_INTERVAL_MS);
        return () => clearInterval(id);
    }, [assistantWorking, voiceState]);

    // ---- Trailing-silence endpointer -----------------------------------------
    // The recognizer runs in continuous mode, so ending the turn is ours to
    // decide: once speech has been heard, finalize after END_SILENCE_MS with no
    // transcript change by asking the engine to stop() (→ final result → onEnd
    // → finalizeTurn). Before any speech we do nothing and keep listening.
    useEffect(() => {
        if (voiceState !== 'listening') return;
        const id = setInterval(() => {
            if (voiceStateRef.current !== 'listening') return;
            if (!hasSpeechRef.current) return;
            if (finalizingRef.current || endpointingRef.current) return;
            if (Date.now() - lastResultAtRef.current < END_SILENCE_MS) return;
            endpointingRef.current = true;
            try {
                ExpoSpeechRecognitionModule.stop();
            } catch {
                /* onEnd/onError will recover the turn */
            }
        }, ENDPOINT_CHECK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [voiceState]);

    // ---- Engine init + native event wiring ----------------------------------

    useEffect(() => {
        let cancelled = false;
        const subs: Array<{ remove: () => void }> = [];

        // Last transcript we stamped the endpointer clock for — guard against
        // iOS re-emitting an identical interim result (which would otherwise
        // keep resetting the trailing-silence timer and never endpoint).
        let lastStampedText = '';

        const onResult = (event: any) => {
            if (voiceStateRef.current !== 'listening') return;
            const transcript: string = event?.results?.[0]?.transcript ?? '';
            if (event?.isFinal) {
                finalTextRef.current = [finalTextRef.current, transcript]
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                interimRef.current = '';
            } else {
                interimRef.current = transcript;
            }
            const text = currentTurnText();
            if (text) {
                hasSpeechRef.current = true;
                setLiveTranscript(text);
                // Advance the trailing-silence clock only when the transcript
                // actually changed; the endpointer below finalizes once it
                // stops changing for END_SILENCE_MS.
                if (text !== lastStampedText) {
                    lastStampedText = text;
                    lastResultAtRef.current = Date.now();
                }
            }
        };

        const onEnd = () => {
            recognizingRef.current = false;
            lastStampedText = '';
            if (voiceStateRef.current !== 'listening') return;
            const text = currentTurnText();
            if (text) {
                // Covers both our endpointing stop() and any spontaneous iOS end.
                finalizeTurnRef.current(text);
            } else {
                // No speech this session — keep listening silently.
                relistenRef.current();
            }
        };

        const onError = (event: any) => {
            recognizingRef.current = false;
            lastStampedText = '';
            const code: string = event?.error ?? '';
            console.warn('[voice] recognition error', code, event?.message);
            if (voiceStateRef.current !== 'listening') return;
            if (code === 'not-allowed' || code === 'service-not-allowed') {
                setErrorKind('permission');
                applyState('error');
                return;
            }
            // If we already captured speech this turn, finalize it rather than
            // discarding it on a late transient error.
            const text = currentTurnText();
            if (text) {
                finalizeTurnRef.current(text);
                return;
            }
            // 'no-speech', 'aborted', 'busy', 'interrupted' — keep listening.
            relistenRef.current();
        };

        const onStart = () => {
            recognizingRef.current = true;
        };

        (async () => {
            try {
                if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
                    setErrorKind('stt');
                    applyState('error');
                    return;
                }
                const perm =
                    await ExpoSpeechRecognitionModule.requestPermissionsAsync();
                if (cancelled) return;
                if (!perm.granted) {
                    setErrorKind('permission');
                    applyState('error');
                    return;
                }
                try {
                    onDeviceRef.current =
                        ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
                } catch {
                    onDeviceRef.current = false;
                }

                // Resolve the best voice per language for more natural TTS.
                // Enhanced/Premium voices sound far better than the default but
                // must be downloaded by the user (iOS: Settings > Accessibility
                // > Spoken Content > Voices); we pick the best one available.
                try {
                    const voices = await Speech.getAvailableVoicesAsync();
                    if (!cancelled && Array.isArray(voices)) {
                        const byLang: Record<
                            string,
                            { id: string; score: number }
                        > = {};
                        for (const v of voices) {
                            const prefix = v.language
                                ?.toLowerCase()
                                .split('-')[0];
                            if (!prefix || !v.identifier) continue;
                            const score =
                                v.quality === Speech.VoiceQuality.Enhanced
                                    ? 2
                                    : 1;
                            const best = byLang[prefix];
                            if (!best || score > best.score) {
                                byLang[prefix] = { id: v.identifier, score };
                            }
                        }
                        voiceByLangRef.current = Object.fromEntries(
                            Object.entries(byLang).map(([k, v]) => [k, v.id]),
                        );
                    }
                } catch {
                    /* fall back to the system default voice */
                }

                subs.push(
                    ExpoSpeechRecognitionModule.addListener('start', onStart),
                    ExpoSpeechRecognitionModule.addListener('result', onResult),
                    ExpoSpeechRecognitionModule.addListener('end', onEnd),
                    ExpoSpeechRecognitionModule.addListener('error', onError),
                );

                if (cancelled) return;
                await startListeningRef.current();
            } catch (err: any) {
                if (cancelled) return;
                console.error(
                    '[voice] engine init failed:',
                    err?.message ?? err,
                );
                setErrorKind('stt');
                applyState('error');
            }
        })();

        return () => {
            cancelled = true;
            subs.forEach(s => {
                try {
                    s.remove();
                } catch {
                    /* ignore */
                }
            });
        };
    }, [applyState, currentTurnText]);

    // ---- App background ------------------------------------------------------

    useEffect(() => {
        const sub = AppState.addEventListener(
            'change',
            (next: AppStateStatus) => {
                if (next === 'background' || next === 'inactive') {
                    stopTtsRef.current();
                    ttsActiveCountRef.current = 0;
                    try {
                        ExpoSpeechRecognitionModule.abort();
                    } catch {
                        /* ignore */
                    }
                    recognizingRef.current = false;
                    applyState('idle');
                }
            },
        );
        return () => sub.remove();
    }, [applyState]);

    // ---- Mount / unmount -----------------------------------------------------

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            stopTtsRef.current();
            clearRetryTimer();
            try {
                ExpoSpeechRecognitionModule.abort();
            } catch {
                /* ignore */
            }
            recognizingRef.current = false;
        };
    }, [clearRetryTimer]);

    // ---- Public actions ------------------------------------------------------

    const setLanguage = useCallback((code: string) => {
        if (code === languageRef.current) return;
        languageRef.current = code;
        setLanguageState(code);
        // Apply immediately if we're mid-listen; otherwise the next turn
        // (resume after TTS) picks it up.
        if (voiceStateRef.current === 'listening') {
            startListeningRef.current();
        }
    }, []);

    const interrupt = useCallback(() => {
        if (voiceStateRef.current === 'speaking') {
            stopTtsRef.current();
            ttsActiveCountRef.current = 0;
            // Abandon the cut-off reply so it isn't re-spoken before the next
            // one (cf. Fix 2). Start a fresh clean listen — a tap doesn't mean
            // the user is already mid-sentence.
            interruptedAssistantIdRef.current = currentAssistantIdRef.current;
            startListeningRef.current();
        }
    }, []);

    const stop = useCallback(() => {
        stopTtsRef.current();
        ttsActiveCountRef.current = 0;
        clearRetryTimer();
        try {
            ExpoSpeechRecognitionModule.abort();
        } catch {
            /* ignore */
        }
        recognizingRef.current = false;
        applyState('idle');
    }, [clearRetryTimer, applyState]);

    const openSettings = useCallback(() => {
        Linking.openSettings();
    }, []);

    return {
        state: voiceState,
        liveTranscript,
        assistantText,
        errorKind,
        detectedLanguage: language.split('-')[0],
        modelProgress: null,
        language,
        setLanguage,
        interrupt,
        stop,
        openSettings,
    };
}

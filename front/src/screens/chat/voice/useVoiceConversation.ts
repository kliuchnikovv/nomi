import { useState, useEffect, useRef, useCallback } from 'react';
import Voice from '@react-native-voice/voice';
import * as Speech from 'expo-speech';
import { AppState, AppStateStatus, Linking } from 'react-native';
import { useChat } from '../context';

export type VoiceState =
    | 'idle'
    | 'listening'
    | 'processing'
    | 'speaking'
    | 'error';
export type ErrorKind = 'permission' | 'stt' | null;

export interface UseVoiceConversationOptions {
    chatId: string;
}

export interface UseVoiceConversationResult {
    state: VoiceState;
    liveTranscript: string;
    errorKind: ErrorKind;
    interrupt(): void;
    stop(): void;
    openSettings(): void;
}

const SILENCE_TIMEOUT_MS = 1500;
const MAX_STT_RETRIES = 3;

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

export function useVoiceConversation({
    chatId,
}: UseVoiceConversationOptions): UseVoiceConversationResult {
    const [voiceState, setVoiceState] = useState<VoiceState>('idle');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [errorKind, setErrorKind] = useState<ErrorKind>(null);

    const { sendMessage, assistantWorking, messages } = useChat();

    const isMountedRef = useRef(true);
    const voiceStateRef = useRef<VoiceState>('idle');
    const currentTranscriptRef = useRef('');
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sttRetryCountRef = useRef(0);
    const lastSpokenMsgIdRef = useRef<string | null>(null);

    const applyState = useCallback((s: VoiceState) => {
        voiceStateRef.current = s;
        setVoiceState(s);
    }, []);

    const clearSilenceTimer = useCallback(() => {
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
    }, []);

    const startListening = useCallback(async () => {
        try {
            clearSilenceTimer();
            setLiveTranscript('');
            currentTranscriptRef.current = '';
            await Voice.start('en-US');
            applyState('listening');
        } catch (err: any) {
            const msg = String(err?.message ?? '');
            const isPermission =
                msg.includes('permission') || msg.includes('not authorized');
            setErrorKind(isPermission ? 'permission' : 'stt');
            applyState('error');
        }
    }, [clearSilenceTimer, applyState]);

    // Stable refs for use inside Voice callbacks (avoid stale closures)
    const startListeningRef = useRef(startListening);
    useEffect(() => {
        startListeningRef.current = startListening;
    }, [startListening]);

    const handleSendTranscript = useCallback(async () => {
        const text = currentTranscriptRef.current.trim();
        if (!text) {
            sttRetryCountRef.current += 1;
            if (sttRetryCountRef.current >= MAX_STT_RETRIES) {
                sttRetryCountRef.current = 0;
                setLiveTranscript("Couldn't hear you — try again");
                retryTimerRef.current = setTimeout(
                    () => startListeningRef.current(),
                    2000,
                );
            } else {
                await startListeningRef.current();
            }
            return;
        }
        sttRetryCountRef.current = 0;
        try {
            await Voice.stop();
        } catch {
            /* ignore */
        }
        applyState('processing');
        sendMessage(text);
    }, [applyState, sendMessage]);

    const handleSendRef = useRef(handleSendTranscript);
    useEffect(() => {
        handleSendRef.current = handleSendTranscript;
    }, [handleSendTranscript]);

    // Register Voice listeners once on mount
    useEffect(() => {
        Voice.onSpeechResults = e => {
            const result = e.value?.[0] ?? '';
            currentTranscriptRef.current = result;
            setLiveTranscript(result);
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
                if (voiceStateRef.current === 'listening') {
                    handleSendRef.current();
                }
            }, SILENCE_TIMEOUT_MS);
        };

        Voice.onSpeechPartialResults = e => {
            const partial = e.value?.[0] ?? '';
            currentTranscriptRef.current = partial;
            setLiveTranscript(partial);
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
                if (voiceStateRef.current === 'listening') {
                    handleSendRef.current();
                }
            }, SILENCE_TIMEOUT_MS);
        };

        Voice.onSpeechEnd = () => {
            if (
                voiceStateRef.current === 'listening' &&
                currentTranscriptRef.current.trim()
            ) {
                clearSilenceTimer();
                handleSendRef.current();
            }
        };

        Voice.onSpeechError = e => {
            const msg = String(e.error?.message ?? '');
            // "No speech" is normal ambient silence — restart silently
            if (msg.includes('No speech') || msg.includes('recognition_fail')) {
                if (voiceStateRef.current === 'listening') {
                    startListeningRef.current();
                }
                return;
            }
            const isPermission =
                msg.includes('permission') || e.error?.code === '5';
            setErrorKind(isPermission ? 'permission' : 'stt');
            applyState('error');
        };

        return () => {
            Voice.removeAllListeners();
        };
    }, [clearSilenceTimer, applyState]);

    // Trigger TTS when generation is done and messages have the final text.
    // Depends on both `messages` (so it fires once text is flushed into the store)
    // and `assistantWorking` (so it knows generation is complete).
    useEffect(() => {
        if (assistantWorking) return;
        if (voiceStateRef.current !== 'processing') return;

        const lastAssistant = [...messages]
            .reverse()
            .find(m => m.role === 'assistant');
        if (!lastAssistant) return;

        const text = extractSpeakableText(lastAssistant);
        if (!text) return; // Text not ready yet — effect will re-run when messages update

        if (lastAssistant.id === lastSpokenMsgIdRef.current) return; // Already spoken
        lastSpokenMsgIdRef.current = lastAssistant.id;

        applyState('speaking');
        Speech.speak(text, {
            onDone: () => {
                if (
                    isMountedRef.current &&
                    voiceStateRef.current === 'speaking'
                ) {
                    startListeningRef.current();
                }
            },
            onError: () => {
                if (
                    isMountedRef.current &&
                    voiceStateRef.current === 'speaking'
                ) {
                    startListeningRef.current();
                }
            },
        });
    }, [assistantWorking, messages, applyState]);

    // Fallback: if still in 'processing' 500ms after generation ends with no speakable text,
    // restart listening. Covers tool-call-only responses that never emit text.
    useEffect(() => {
        if (assistantWorking) return;
        if (voiceStateRef.current !== 'processing') return;
        const timer = setTimeout(() => {
            if (voiceStateRef.current === 'processing') {
                startListeningRef.current();
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [assistantWorking]);

    // Stop audio when app goes to background
    useEffect(() => {
        const sub = AppState.addEventListener(
            'change',
            (next: AppStateStatus) => {
                if (next === 'background' || next === 'inactive') {
                    Speech.stop();
                    Voice.stop().catch(() => {});
                    clearSilenceTimer();
                    applyState('idle');
                }
            },
        );
        return () => sub.remove();
    }, [clearSilenceTimer]);

    // Auto-start on mount; full cleanup on unmount
    useEffect(() => {
        startListeningRef.current();
        return () => {
            isMountedRef.current = false;
            Speech.stop();
            clearSilenceTimer();
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
            Voice.destroy()
                .then(() => Voice.removeAllListeners())
                .catch(() => {});
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const interrupt = useCallback(() => {
        if (voiceStateRef.current === 'speaking') {
            Speech.stop();
            startListeningRef.current();
        }
    }, []);

    const stop = useCallback(() => {
        Speech.stop();
        clearSilenceTimer();
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        Voice.destroy()
            .then(() => Voice.removeAllListeners())
            .catch(() => {});
        applyState('idle');
    }, [clearSilenceTimer, applyState]);

    const openSettings = useCallback(() => {
        Linking.openSettings();
    }, []);

    return {
        state: voiceState,
        liveTranscript,
        errorKind,
        interrupt,
        stop,
        openSettings,
    };
}

import { useState, useEffect, useRef, useCallback } from 'react';
import Voice from '@react-native-voice/voice';
import { Platform, NativeModules } from 'react-native';

const MAX_RECORDING_DURATION = 60;

type RecordingState = 'idle' | 'recording' | 'processing';

const getDeviceLocale = () => {
    if (Platform.OS === 'ios') {
        return NativeModules.I18nManager?.localeIdentifier || 'en-US';
    }
    return NativeModules.I18nManager?.localeIdentifier || 'en-US';
};

function clearAllIntervals(
    durationRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
    animationRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
) {
    if (durationRef.current) {
        clearInterval(durationRef.current);
        durationRef.current = null;
    }
    if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
    }
}

export function useVoiceRecorder() {
    const [state, setState] = useState<RecordingState>('idle');
    const [audioLevels, setAudioLevels] = useState<number[]>([]);
    const [duration, setDuration] = useState(0);
    const [transcribedText, setTranscribedText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startTimeRef = useRef<number>(0);

    useEffect(() => {
        Voice.onSpeechStart = () => {};
        Voice.onSpeechEnd = () => {};

        Voice.onSpeechResults = (event) => {
            if (event.value && event.value.length > 0) {
                setTranscribedText(event.value[0]);
            }
        };

        Voice.onSpeechError = (event) => {
            if (event.error?.code === 'recognition_fail' && event.error?.message?.includes('No speech detected')) {
                return;
            }
            setError(event.error?.message || 'Speech recognition failed');
        };

        return () => {
            clearAllIntervals(durationIntervalRef, animationIntervalRef);
            Voice.destroy().then(Voice.removeAllListeners);
        };
    }, []);

    const startRecording = useCallback(async (locale?: string) => {
        try {
            setError(null);
            setTranscribedText('');
            setAudioLevels([]);
            setDuration(0);

            const selectedLocale = locale || getDeviceLocale();

            if (Platform.OS === 'ios') {
                await Voice.start(selectedLocale);
            }

            setState('recording');
            startTimeRef.current = Date.now();

            durationIntervalRef.current = setInterval(() => {
                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                setDuration(elapsed);

                if (elapsed >= MAX_RECORDING_DURATION) {
                    stopRecording();
                }
            }, 100);

            const MAX_AUDIO_LEVELS = 60;
            animationIntervalRef.current = setInterval(() => {
                const randomLevel = 0.2 + Math.random() * 0.7;
                setAudioLevels((prev) => {
                    const next = [...prev, randomLevel];
                    return next.length > MAX_AUDIO_LEVELS ? next.slice(-MAX_AUDIO_LEVELS) : next;
                });
            }, 50);
        } catch (err) {
            console.error('Failed to start recording:', err);
            setError('Failed to start recording');
            setState('idle');
        }
    }, []);

    const stopRecording = useCallback(async () => {
        try {
            setState('processing');
            clearAllIntervals(durationIntervalRef, animationIntervalRef);

            if (Platform.OS === 'ios') {
                await Voice.stop();
            }

            await new Promise<void>((resolve) => setTimeout(resolve, 500));
            setState('idle');
        } catch (err) {
            console.error('Failed to stop recording:', err);
            setError('Failed to stop recording');
            setState('idle');
        }
    }, []);

    const reset = useCallback(() => {
        setTranscribedText('');
        setAudioLevels([]);
        setDuration(0);
        setError(null);
    }, []);

    const cancelRecording = useCallback(async () => {
        try {
            clearAllIntervals(durationIntervalRef, animationIntervalRef);
            await Voice.stop();
            setAudioLevels([]);
            setDuration(0);
            setState('idle');
        } catch (err) {
            console.error('Failed to cancel recording:', err);
            setState('idle');
        }
    }, []);

    return {
        state,
        audioLevels,
        duration,
        transcribedText,
        error,
        startRecording,
        stopRecording,
        cancelRecording,
        reset,
        maxDuration: MAX_RECORDING_DURATION,
    };
}

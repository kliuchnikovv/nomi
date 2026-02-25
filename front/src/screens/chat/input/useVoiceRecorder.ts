import { useState, useEffect, useRef, useCallback } from 'react';
import Voice from '@react-native-voice/voice';
import { Platform, NativeModules } from 'react-native';

const MAX_RECORDING_DURATION = 60; // 1 minute in seconds

type RecordingState = 'idle' | 'recording' | 'processing';

const getDeviceLocale = () => {
    if (Platform.OS === 'ios') {
        // iOS uses I18nManager for locale
        return NativeModules.I18nManager?.localeIdentifier || 'en-US';
    }
    // Android
    return NativeModules.I18nManager?.localeIdentifier || 'en-US';
};

export function useVoiceRecorder() {
    const [state, setState] = useState<RecordingState>('idle');
    const [audioLevels, setAudioLevels] = useState<number[]>([]);
    const [duration, setDuration] = useState(0);
    const [transcribedText, setTranscribedText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startTimeRef = useRef<number>(0);

    // Initialize Voice recognition
    useEffect(() => {
        Voice.onSpeechStart = () => {
            console.log('Speech recognition started');
        };

        Voice.onSpeechEnd = () => {
            console.log('Speech recognition ended');
        };

        Voice.onSpeechResults = (event) => {
            if (event.value && event.value.length > 0) {
                setTranscribedText(event.value[0]);
            }
        };

        Voice.onSpeechError = (event) => {
            // Ignore "No speech detected" errors as they're normal
            if (event.error?.code === 'recognition_fail' && event.error?.message?.includes('No speech detected')) {
                return;
            }
            console.error('Speech recognition error:', event.error);
            setError(event.error?.message || 'Speech recognition failed');
        };

        return () => {
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
            console.log('Starting recognition with locale:', selectedLocale);

            // Start speech recognition
            if (Platform.OS === 'ios') {
                await Voice.start(selectedLocale);
            }

            setState('recording');
            startTimeRef.current = Date.now();

            // Start duration timer
            durationIntervalRef.current = setInterval(() => {
                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                setDuration(elapsed);

                // Auto-stop at max duration
                if (elapsed >= MAX_RECORDING_DURATION) {
                    stopRecording();
                }
            }, 100);

            // Simulate audio levels with random values for animation.
            // Use a fixed-size ring buffer (60 entries = 3 seconds at 50ms intervals)
            // to prevent unbounded array growth during long recordings.
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

            // Clear intervals
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
                durationIntervalRef.current = null;
            }
            if (animationIntervalRef.current) {
                clearInterval(animationIntervalRef.current);
                animationIntervalRef.current = null;
            }

            // Stop speech recognition
            if (Platform.OS === 'ios') {
                await Voice.stop();
            }

            // Wait a bit for final transcription results
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
            // Clear intervals
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
                durationIntervalRef.current = null;
            }
            if (animationIntervalRef.current) {
                clearInterval(animationIntervalRef.current);
                animationIntervalRef.current = null;
            }

            // Stop voice recognition
            await Voice.stop();

            // Reset state without saving transcription
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

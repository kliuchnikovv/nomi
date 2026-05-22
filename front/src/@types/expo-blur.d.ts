declare module 'expo-blur' {
    import type { ViewProps } from 'react-native';

    export interface BlurViewProps extends ViewProps {
        intensity?: number;
        tint?: string;
    }

    export function BlurView(props: BlurViewProps): React.ReactElement | null;
}

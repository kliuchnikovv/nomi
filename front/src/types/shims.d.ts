/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- Global shims for React Native / Hermes environments ----
declare const global: any;

declare function atob(data: string): string;
declare function btoa(data: string): string;

declare namespace global {
  // Some code uses `global.NodeJS.Timeout` (Node typings are not included in RN).
  // Provide a minimal type so TS can compile.
  namespace NodeJS {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Timeout {}
  }
}

// React Native doesn't ship full DOM lib typings; provide minimal URLSearchParams.get
interface URLSearchParams {
  get(name: string): string | null;
}

// ---- Vendor module shims (avoid compiling TS sources in node_modules) ----
declare module 'react-native-vector-icons/MaterialCommunityIcons' {
  const Icon: any;
  export default Icon;
}

// expo-file-system typings sometimes differ across Expo/RN versions.
declare module 'expo-file-system' {
  export const documentDirectory: string | null;
  export const cacheDirectory: string | null;
  export const EncodingType: { Base64: 'base64'; UTF8: 'utf8' };
  export function downloadAsync(...args: any[]): Promise<any>;
  export function writeAsStringAsync(fileUri: string, contents: string, options?: { encoding?: string }): Promise<void>;
}


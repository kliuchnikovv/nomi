import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    plugins: [react()],
    define: {
        // react-native-web checks this
        __DEV__: 'true',
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
            '@genie/front': path.resolve(__dirname, '../../front/src'),
        },
        extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js'],
    },
    optimizeDeps: {
        esbuildOptions: {
            resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js'],
            loader: { '.js': 'jsx' },
        },
    },
    build: {
        lib: {
            entry: path.resolve(__dirname, 'src/index.ts'),
            formats: ['es'],
            fileName: () => 'index.js',
        },
        rollupOptions: {
            external: ['react', 'react-dom', 'react-native-web', 'react/jsx-runtime'],
        },
        sourcemap: false,
        minify: false,
    },
});

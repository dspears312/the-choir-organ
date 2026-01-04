import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        vue({
            template: { transformAssetUrls }
        }),
        quasar({
            sassVariables: 'src/css/quasar.variables.scss'
        })
    ],
    resolve: {
        alias: {
            'src': path.resolve(__dirname, './src'),
            '@': path.resolve(__dirname, './src'),
            'src-remote': path.resolve(__dirname, './src-remote'),
            'src-electron': path.resolve(__dirname, './src-electron'),
        },
    },
    root: path.resolve(__dirname, './src-remote'),
    base: './',
    build: {
        outDir: path.resolve(__dirname, './src-electron/remote/dist'),
        emptyOutDir: true,
        target: 'esnext',
    },
    define: {
        'process.env': {}
    }
});

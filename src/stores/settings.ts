import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSettingsStore = defineStore('settings', () => {
    // State
    const recentOdfs = ref<string[]>([]);
    const lastExportDir = ref<string>('');
    const workerCount = ref<number>(1);
    const isWebServerEnabled = ref<boolean>(false);
    const remoteServerPort = ref<number>(56789);
    const useRustEngine = ref<boolean>(false);

    // Actions
    async function loadSettings() {
        const settings = await window.myApi.loadUserSettings();
        if (settings) {
            recentOdfs.value = settings.recentOdfs || [];
            lastExportDir.value = settings.lastExportDir || '';
            workerCount.value = settings.workerCount || 1;
            isWebServerEnabled.value = settings.isWebServerEnabled || false;
            remoteServerPort.value = settings.remoteServerPort || 56789;
            useRustEngine.value = !!settings.useRustEngine;
        }
    }

    async function saveSettings(newSettings: Partial<{
        recentOdfs: string[],
        lastExportDir: string,
        workerCount: number,
        isWebServerEnabled: boolean,
        remoteServerPort: number,
        useRustEngine: boolean
    }>) {
        // Optimistic update
        if (newSettings.recentOdfs) recentOdfs.value = newSettings.recentOdfs;
        if (newSettings.lastExportDir) lastExportDir.value = newSettings.lastExportDir;
        if (newSettings.workerCount) workerCount.value = newSettings.workerCount;
        if (newSettings.isWebServerEnabled !== undefined) isWebServerEnabled.value = newSettings.isWebServerEnabled;
        if (newSettings.remoteServerPort) remoteServerPort.value = newSettings.remoteServerPort;
        if (newSettings.useRustEngine !== undefined) useRustEngine.value = newSettings.useRustEngine;

        // Use JSON copy to ensure we send a plain object, stripping Proxies
        await window.myApi.saveUserSettings(JSON.parse(JSON.stringify({
            recentOdfs: recentOdfs.value,
            lastExportDir: lastExportDir.value,
            workerCount: workerCount.value,
            isWebServerEnabled: isWebServerEnabled.value,
            remoteServerPort: remoteServerPort.value,
            useRustEngine: useRustEngine.value
        })));
    }

    async function setWorkerCount(count: number) {
        if (count !== workerCount.value) {
            workerCount.value = count;
            await saveSettings({ workerCount: count });
        }
    }

    return {
        recentOdfs,
        lastExportDir,
        workerCount,
        isWebServerEnabled,
        remoteServerPort,
        useRustEngine,
        loadSettings,
        saveSettings,
        setWorkerCount
    };
});

import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSettingsStore = defineStore('settings', () => {
    // State
    const recentOdfs = ref<string[]>([]);
    const lastExportDir = ref<string>('');
    const workerCount = ref<number>(1);

    // Actions
    async function loadSettings() {
        const settings = await window.myApi.loadUserSettings();
        if (settings) {
            recentOdfs.value = settings.recentOdfs || [];
            lastExportDir.value = settings.lastExportDir || '';
            workerCount.value = settings.workerCount || 1;
        }
    }

    async function saveSettings(newSettings: Partial<{ recentOdfs: string[], lastExportDir: string, workerCount: number }>) {
        // Optimistic update
        if (newSettings.recentOdfs) recentOdfs.value = newSettings.recentOdfs;
        if (newSettings.lastExportDir) lastExportDir.value = newSettings.lastExportDir;
        if (newSettings.workerCount) workerCount.value = newSettings.workerCount;

        // Use JSON copy to ensure we send a plain object, stripping Proxies
        await window.myApi.saveUserSettings(JSON.parse(JSON.stringify({
            recentOdfs: recentOdfs.value,
            lastExportDir: lastExportDir.value,
            workerCount: workerCount.value
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
        loadSettings,
        saveSettings,
        setWorkerCount
    };
});

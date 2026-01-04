<template>
    <div class="worker-page">
        <h1>TCO Audio Worker</h1>
        <div class="status">
            Status: {{ status }}
        </div>
        <div class="logs">
            <div v-for="(log, i) in logs" :key="i">{{ log }}</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { synth } from '../services/synth-engine';

const status = ref('Initializing...');
const logs = ref<string[]>([]);

function log(msg: string) {
    logs.value.push(`[${new Date().toISOString()}] ${msg}`);
    if (logs.value.length > 20) logs.value.shift();
    console.log(`[Worker] ${msg}`);
    if (window.myApi) window.myApi.logToMain(msg);
}

onMounted(async () => {
    log('Worker mounted');

    // Initialize IPC listeners
    if (window.myApi) {
        status.value = 'Ready';
        window.myApi.notifyWorkerReady();

        // Listen for port transfer
        window.myApi.onWorkerInit((event: any) => {
            log('Received initialization command');
            // Port handling will be implemented here
        });

        window.myApi.onWorkerCommand(async (command: any) => {
            // Fallback IPC command handling
            handleCommand(command);
        });

        // Start Stats Loop
        if (!(window as any).statsStarted) {
            (window as any).statsStarted = true;
            setInterval(async () => {
                if (!synth) return;
                const stats = synth.getStats();
                window.myApi.sendWorkerStats(stats);
            }, 1000);
        }

    } else {
        status.value = 'Error: No IPC';
    }
});

async function handleCommand(cmd: any) {
    if (cmd.type === 'note-on') {
        log(`Note On: Stop=${cmd.stopId} Path=${cmd.pipePath}`);
    } else {
        if (cmd.type != 'load-sample') {
            log(`Received command: ${cmd.type}`);
        }
    }

    switch (cmd.type) {
        case 'load-sample':
            // log(`Loading sample: ${cmd.pipePath} (Type: ${cmd.loadType}, Params: ${JSON.stringify(cmd.params)})`);
            try {
                await synth.loadSample(cmd.stopId, cmd.pipePath, cmd.loadType, cmd.params);
            } catch (e) {
                log(`Error loading sample: ${cmd.pipePath} (Type: ${cmd.loadType}, Params: ${JSON.stringify(cmd.params)})`);
            } finally {
                window.myApi.sendSampleLoaded({ pipePath: cmd.pipePath });
            }
            break;
        case 'note-on':
            synth.noteOn(
                cmd.note,
                cmd.stopId,
                cmd.pipePath,
                cmd.releasePath,
                cmd.volume,
                cmd.gainDb,
                cmd.tuning,
                cmd.harmonicNumber,
                cmd.isPedal,
                cmd.manualId,
                cmd.activeTremulants,
                cmd.pitchOffsetCents,
                cmd.renderingNote,
                cmd.delay
            );
            break;
        case 'note-off':
            synth.noteOff(cmd.note, cmd.stopId);
            break;
        case 'set-global-gain':
            log(`Setting global gain: ${cmd.db}dB`);
            synth.setGlobalGain(cmd.db);
            break;
        case 'set-release-mode':
            log(`Setting release mode: ${cmd.mode}`);
            synth.setReleaseMode(cmd.mode);
            break;
        case 'configure-reverb':
            log(`Configuring reverb: Length=${cmd.length}, Mix=${cmd.mix}`);
            synth.configureReverb(cmd.length, cmd.mix);
            break;
        case 'update-tremulants':
            synth.updateTremulants(cmd.allActiveTremulants);
            break;
    }
}
</script>

<style scoped>
.worker-page {
    padding: 20px;
    background: #111;
    color: #0f0;
    font-family: monospace;
    height: 100vh;
}
</style>

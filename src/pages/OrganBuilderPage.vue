<template>
    <q-page class="organ-page text-white column no-wrap">
        <!-- Organ Console -->
        <div class="organ-console column" style="flex: 1 1 auto">
            <!-- Info Header (Fixed Height) -->
            <div class="console-header row items-center justify-between q-py-md q-px-md col-auto">
                <q-btn flat round icon="arrow_back" color="grey-6" @click="goBack" class="q-mr-md" />
                <div class="text-h4 font-cinzel text-amber-8 text-shadow">{{ organStore.organData?.name }}</div>

                <div class="row items-center q-gutter-x-lg">
                    <!-- Audio Meter & Master Volume -->
                    <AudioMeter />

                    <q-separator vertical color="grey-9" />

                    <!-- Recording Controls -->
                    <div class="row items-center q-gutter-x-sm">
                        <q-btn round flat dense :color="organStore.isRecording ? 'red' : 'grey-6'"
                            :icon="organStore.isRecording ? 'stop' : 'fiber_manual_record'"
                            :class="{ 'animate-blink': organStore.isRecording }" @click="toggleRecording">
                            <q-tooltip>{{ organStore.isRecording ? 'Stop Recording' : 'Start Recording' }}</q-tooltip>
                        </q-btn>

                        <div v-if="organStore.isRecording" class="font-cinzel text-red text-caption">
                            Recording...
                        </div>

                        <q-btn flat dense icon="list" color="amber"
                            @click="showRecordingsDrawer = !showRecordingsDrawer">
                            <q-tooltip>View Recordings</q-tooltip>
                            <q-badge v-if="organStore.recordings.length > 0" color="red" floating>{{
                                organStore.recordings.length }}</q-badge>
                        </q-btn>
                    </div>

                    <q-separator vertical color="grey-9" />

                    <div class="ram-indicator row items-center q-gutter-x-sm" v-if="ramUsage > 0">
                        <q-icon name="memory" :style="{ color: ramColor }" size="16px" />
                        <span class="text-caption font-cinzel" :style="{ color: ramColor }">RAM: {{ formattedRam
                            }}</span>
                        <q-tooltip class="bg-grey-10 text-white shadow-4">
                            App Memory Usage: {{ formattedRam }}
                        </q-tooltip>
                    </div>

                    <div class="status-indicator row items-center q-gutter-x-sm cursor-pointer hover-opacity-100"
                        @click="organStore.initMIDI" :class="{ 'opacity-50': organStore.midiStatus !== 'Connected' }">
                        <q-icon name="circle" :color="midiColor" size="12px" />
                        <span class="text-caption text-uppercase tracking-wide">MIDI {{ organStore.midiStatus }}</span>
                        <q-tooltip class="bg-grey-10 text-amber shadow-4">
                            <div v-if="organStore.midiStatus === 'Connected'">MIDI Connected & Ready</div>
                            <div v-else-if="organStore.midiStatus === 'Error'">
                                <strong>MIDI Error:</strong> {{ organStore.midiError || 'Unknown Error' }}<br />
                                Click to retry connection
                            </div>
                            <div v-else>MIDI Disconnected. Click to retry connection.</div>
                        </q-tooltip>
                    </div>

                    <q-separator vertical color="grey-9" />

                    <q-toggle v-model="organStore.useReleaseSamples"
                        @update:model-value="organStore.setUseReleaseSamples" color="blue-4" label="Release Samples"
                        dense left-label class="text-caption font-cinzel" />

                    <q-separator vertical color="grey-9" />



                    <q-btn flat icon="file_open" round @click="organStore.importFromJSON"><q-tooltip>Open Combination
                            File</q-tooltip></q-btn>
                    <q-btn id="btn-save-json" rounded label="Save" color="green" icon="save"
                        @click="organStore.exportToJSON" />
                </div>
            </div>

            <!-- Main Body (Flex Row taking remaining height) -->
            <div class="console-body col row no-wrap overflow-hidden">

                <!-- Left Area: Tabs for Basic or Organ Screens -->
                <div class="col column no-wrap">
                    <q-tabs v-model="activeTab" dense class="bg-grey-10 text-amber" active-color="amber" align="center"
                        indicator-color="amber" narrow-indicator>
                        <q-tab name="basic" label="Basic" class="font-cinzel" />
                        <q-tab v-for="screen in filteredScreens" :key="screen.id" :name="screen.id" :label="screen.name"
                            class="font-cinzel" />
                    </q-tabs>

                    <q-tab-panels v-model="activeTab" animated class="col bg-transparent overflow-hidden"
                        style="background: transparent;">
                        <!-- Basic Grid View -->
                        <q-tab-panel name="basic" class="q-pa-none overflow-hidden">
                            <q-scroll-area id="stops-container" style="height: 100%" class="col q-pa-lg">
                                <div v-for="manual in organStore.organData?.manuals" :key="manual.id"
                                    class="col-12 q-mb-md">
                                    <div class="manual-section q-pa-md">
                                        <div
                                            class="manual-name font-cinzel text-h6 text-amber-7 q-mb-lg text-center border-bottom-amber">
                                            {{ manual.name }}
                                        </div>
                                        <div class="stops-grid row justify-center q-gutter-md">
                                            <template v-for="stopId in manual.stopIds" :key="`${manual.id}-${stopId}`">
                                                <Drawknob v-if="organStore.organData?.stops[stopId]"
                                                    :name="parseStopLabel(organStore.organData.stops[stopId].name).name"
                                                    :pitch="parseStopLabel(organStore.organData.stops[stopId].name).pitch"
                                                    :active="organStore.currentCombination.includes(stopId)"
                                                    :volume="organStore.stopVolumes[stopId] || 100"
                                                    @toggle="organStore.toggleStop(stopId)"
                                                    @update:volume="organStore.setStopVolume(stopId, $event)">
                                                    <q-menu touch-position context-menu class="bg-grey-10 text-amber">
                                                        <q-list dense style="min-width: 150px">
                                                            <q-item clickable v-close-popup
                                                                @click="openCreateVirtualStop(stopId)">
                                                                <q-item-section avatar><q-icon name="add_circle"
                                                                        color="green" /></q-item-section>
                                                                <q-item-section>Create Virtual stop</q-item-section>
                                                            </q-item>
                                                        </q-list>
                                                    </q-menu>
                                                </Drawknob>

                                                <Drawknob v-for="vs in getVirtualStopsFor(stopId)" :key="vs.id"
                                                    :name="vs.name" :pitch="vs.pitch"
                                                    :active="organStore.currentCombination.includes(vs.id)"
                                                    :volume="organStore.stopVolumes[vs.id] || 100" :is-virtual="true"
                                                    @toggle="organStore.toggleStop(vs.id)"
                                                    @update:volume="organStore.setStopVolume(vs.id, $event)"
                                                    @delete="organStore.deleteVirtualStop(vs.id)">
                                                    <q-menu touch-position context-menu class="bg-grey-10 text-amber">
                                                        <q-list dense style="min-width: 150px">
                                                            <q-item clickable v-close-popup
                                                                @click="openEditVirtualStop(vs)">
                                                                <q-item-section avatar><q-icon name="edit"
                                                                        color="blue" /></q-item-section>
                                                                <q-item-section>Edit Virtual stop</q-item-section>
                                                            </q-item>
                                                            <q-item clickable v-close-popup
                                                                @click="organStore.deleteVirtualStop(vs.id)">
                                                                <q-item-section avatar><q-icon name="delete"
                                                                        color="red" /></q-item-section>
                                                                <q-item-section>Delete Virtual stop</q-item-section>
                                                            </q-item>
                                                        </q-list>
                                                    </q-menu>
                                                </Drawknob>
                                            </template>
                                        </div>
                                    </div>
                                </div>
                            </q-scroll-area>
                        </q-tab-panel>

                        <!-- Organ Screen Views -->
                        <q-tab-panel v-for="screen in organStore.organData?.screens" :key="screen.id" :name="screen.id"
                            class="q-pa-sm overflow-hidden" style="display: flex;">
                            <!-- <q-scroll-area style="height: 100%; width: 100%;"> -->
                            <!-- <div class="flex flex-center q-pa-md" style="min-height: 100%"> -->
                            <OrganScreen :screen="screen" />
                            <!-- </div> -->
                            <!-- </q-scroll-area> -->
                        </q-tab-panel>
                    </q-tab-panels>
                </div>

                <!-- Right: Sidebar (Fixed Width, Flex Column) -->
                <div class="col-auto bg-dark-sidebar column no-wrap border-left" style="width: 350px;">
                    <div class="q-pa-md bg-header-gradient border-bottom-amber"
                        style="display: flex; flex-direction: row; align-items: center;">
                        <q-btn round label="GC" unelevated color="white" text-color="black"
                            @click="organStore.clearCombination">
                            <q-tooltip>General Cancel</q-tooltip>
                        </q-btn>
                        <div class="col">
                            <div class="text-h6 font-cinzel text-amber-9 text-center">Combinations</div>
                            <div class="text-caption text-grey-6 text-center">
                                {{ organStore.banks.length }} / 32 Banks Used
                            </div>
                        </div>
                    </div>

                    <!-- Scrollable Bank List -->
                    <q-scroll-area class="col"
                        :thumb-style="{ width: '5px', borderRadius: '5px', background: '#d4af37', opacity: '0.5' }">
                        <q-list dark separator class="bank-list">
                            <q-item v-for="(bank, index) in organStore.banks" :key="bank.id" clickable v-ripple
                                :active="selectedBank === index" active-class="bank-active" class="bank-item q-py-sm"
                                @click="selectBank(index)">
                                <q-item-section side>
                                    <div class="column q-gutter-xs">
                                        <q-btn flat dense role="img" icon="keyboard_arrow_up" size="xs" color="grey-6"
                                            @click.stop="organStore.moveBank(index, index - 1)"
                                            :disable="index === 0" />
                                        <q-btn flat dense role="img" icon="keyboard_arrow_down" size="xs" color="grey-6"
                                            @click.stop="organStore.moveBank(index, index + 1)"
                                            :disable="index === organStore.banks.length - 1" />
                                    </div>
                                </q-item-section>

                                <q-item-section>
                                    <q-item-label class="text-amber-1 font-cinzel row items-center">
                                        {{ bank.name }}
                                        <q-popup-edit v-model="bank.name" auto-save v-slot="scope"
                                            class="bg-grey-10 text-amber">
                                            <q-input v-model="scope.value" dense autofocus counter
                                                @keyup.enter="scope.set" dark color="amber" label="Rename Bank" />
                                        </q-popup-edit>
                                        <q-icon name="edit" size="xs" color="grey-8"
                                            class="q-ml-sm cursor-pointer opacity-50 hover-opacity-100" />
                                    </q-item-label>
                                    <q-item-label caption class="text-grey-5">{{ bank.combination.length }}
                                        Stops</q-item-label>
                                </q-item-section>

                                <q-item-section side>
                                    <q-btn flat round dense icon="delete" color="red-9" size="sm"
                                        @click.stop="organStore.deleteBank(index)" />
                                </q-item-section>
                            </q-item>

                            <div v-if="organStore.banks.length === 0"
                                class="text-center text-grey-8 q-pa-lg italic text-caption">
                                No banks saved. Set stops and click "Add Bank".
                            </div>
                        </q-list>
                    </q-scroll-area>

                    <!-- Bank Actions (Immediately following list) -->
                    <div class="q-pa-md bg-dark-sidebar  column">
                        <div class="row q-gutter-x-sm">
                            <q-btn id="btn-save-new" color="amber" text-color="black" icon-right="add"
                                label="Save to New" class="col font-cinzel text-caption"
                                :disable="organStore.banks.length >= 32" @click="addNewBank">
                                <q-tooltip v-if="organStore.banks.length >= 32">Bank limit reached (32)</q-tooltip>
                            </q-btn>

                            <q-btn color="grey-9" text-color="grey-5" icon-right="backspace" label="Overwrite"
                                class="col font-cinzel text-caption" outline :disable="!organStore.banks[selectedBank]"
                                @click="organStore.saveToBank(selectedBank)" />
                        </div>
                    </div>

                    <!-- Bottom Action Area (Export) -->
                    <div class="q-pa-md q-pb-lg bg-dark-sidebar border-top-amber column shadow-up-10"
                        style="z-index: 5;">
                        <div class="text-overline text-amber-9" style="line-height: 1">Tsunami Export</div>

                        <div class="q-gutter-y-sm">
                            <!-- 1. Destination picker -->
                            <div v-if="!organStore.isRendering" class="output-destination-area column q-gutter-y-xs">
                                <div class="row items-center justify-between">
                                    <div class="text-caption text-grey-6">Target Device</div>
                                    <q-btn flat dense color="grey-6" icon="settings" size="xs"
                                        @click="showAdvancedDisk = !showAdvancedDisk">
                                        <q-tooltip>Advanced Options</q-tooltip>
                                    </q-btn>
                                </div>

                                <!-- Drive Picker -->
                                <div id="target-device-picker" v-if="!showAdvancedDisk"
                                    class="drive-picker q-gutter-y-xs">
                                    <div v-for="drive in organStore.availableDrives" :key="drive.mountPoint"
                                        class="drive-item q-pa-sm rounded-borders cursor-pointer row items-center no-wrap"
                                        :class="{ 'drive-selected': organStore.outputDir === drive.mountPoint }"
                                        @click="selectDrive(drive)">
                                        <q-icon
                                            :name="(drive.volumeName === 'TCO' || drive.volumeName === organStore.targetVolumeLabel) ? 'sd_card' : 'usb'"
                                            :color="(drive.volumeName === 'TCO' || drive.volumeName === organStore.targetVolumeLabel) ? 'amber' : 'grey-5'"
                                            size="sm" class="q-mr-sm" />
                                        <div class="col overflow-hidden">
                                            <div class="text-caption text-weight-bold ellipsis">{{ drive.volumeName ||
                                                'Untitled' }}
                                            </div>
                                            <div class="text-xs text-grey-6 ellipsis">{{ drive.mountPoint }}</div>
                                        </div>
                                        <q-icon v-if="organStore.outputDir === drive.mountPoint" name="check_circle"
                                            color="amber" size="xs" />
                                    </div>
                                </div>

                                <div v-if="organStore.availableDrives.length === 0"
                                    class="text-center q-pa-md border-dashed rounded-borders text-grey-7 italic text-xs">
                                    No removable drives detected
                                </div>

                                <q-btn v-if="organStore.availableDrives.length === 0 || showAdvancedDisk" outline
                                    color="amber-7" icon="folder_open" label="Select Target Folder"
                                    class="full-width q-mt-sm font-cinzel text-xs" @click="organStore.setOutputDir" />
                            </div>

                            <!-- Advanced Folder View -->
                            <div v-if="showAdvancedDisk"
                                class="advanced-folder q-pa-sm rounded-borders bg-black-50 border-amber-muted">
                                <div class="row items-center justify-between q-mb-xs">
                                    <div class="text-caption text-amber-8">Selected Path</div>
                                    <q-btn flat dense color="amber-7" icon="folder_open" size="xs"
                                        @click="organStore.setOutputDir" />
                                </div>
                                <div class="text-xs text-grey-5 ellipsis dir-path">
                                    {{ organStore.outputDir || 'Not selected' }}
                                </div>
                            </div>
                        </div>

                        <!-- 2. Burn Button -->
                        <div class="row q-gutter-x-sm q-gutter-y-sm">
                            <q-btn id="btn-burn-card" color="red-10"
                                :label="organStore.isOutputRemovable ? 'Burn to Card' : 'Copy to Folder'"
                                class="col font-cinzel q-py-sm shadow-10" :loading="organStore.isRendering"
                                :disable="organStore.banks.length === 0" @click="handleRenderClick"
                                :icon-right="organStore.isOutputRemovable ? 'sd_card' : 'folder'">
                            </q-btn>
                        </div>

                        <!-- 3. Progress / Preview Area -->
                        <div v-if="organStore.isRendering">
                            <div class="text-caption text-amber text-center q-mb-xs">
                                {{ organStore.renderStatus || 'Rendering...' }}
                            </div>
                            <q-linear-progress :value="organStore.renderProgress" color="amber" size="8px" rounded
                                class="q-linear-progress--animate" />
                            <div class="row items-center justify-between">
                                <div class="text-xs text-grey-6">{{ Math.round(organStore.renderProgress * 100) }}%
                                </div>
                                <q-btn flat dense color="red-5" label="Cancel" size="sm" icon="close"
                                    @click="organStore.cancelRendering" />
                            </div>
                        </div>

                        <div v-else-if="organStore.outputDir"
                            class="row items-center justify-between q-px-sm bg-green-10 rounded-borders animate-fade q-py-xs">
                            <div class="text-caption text-white semi-bold">
                                {{ organStore.isOutputRemovable ? 'Drive Ready' : 'Folder Ready' }}
                            </div>
                            <q-btn id="btn-preview-ready" flat dense color="white" label="Preview" size="sm"
                                class="text-weight-bold"
                                @click="$router.push({ path: '/preview', query: { folder: organStore.outputDir } })" />
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Create/Edit Virtual Stop Dialog -->
        <q-dialog v-model="showVsDialog" persistent>
            <q-card dark style="min-width: 400px; background: #1a1a1a; border: 1px solid #444;" class="q-pa-sm">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6 font-cinzel text-amber">{{ vsForm.id ? 'Edit' : 'Create' }} Virtual Stop</div>
                    <q-space />
                    <q-btn icon="close" flat round dense v-close-popup />
                </q-card-section>

                <q-card-section class="q-pt-md column q-gutter-y-md">
                    <q-input v-model="vsForm.name" label="Name" dark color="green" filled />
                    <q-input v-model="vsForm.pitch" label="Pitch Label (e.g. 16')" dark color="green" filled />

                    <div class="row q-col-gutter-sm">
                        <div class="col-12 text-caption text-grey-5">Pitch Shift (Cents)</div>
                        <div class="col-12">
                            <q-input v-model.number="vsForm.pitchShift" type="number" dark filled color="green" dense />
                        </div>

                        <div class="col-12 text-caption text-grey-5">Harmonic Multiplier</div>
                        <div class="col-12">
                            <q-input v-model.number="vsForm.harmonicMultiplier" type="number" step="0.01" dark filled
                                color="green" dense />
                        </div>

                        <div class="col-12 text-caption text-grey-5">Note Offset (Semitones)</div>
                        <div class="col-12">
                            <q-input v-model.number="vsForm.noteOffset" type="number" dark filled color="green" dense />
                        </div>

                        <div class="col-12 text-caption text-grey-5">Delay (ms)</div>
                        <div class="col-12">
                            <q-input v-model.number="vsForm.delay" type="number" dark filled color="green" dense />
                        </div>
                    </div>
                </q-card-section>

                <q-card-actions align="right" class="q-pa-md">
                    <q-btn flat label="Cancel" v-close-popup />
                    <q-btn :label="vsForm.id ? 'Save' : 'Create'" color="green" @click="saveVirtualStop"
                        v-close-popup />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- Disk Compatibility Warning Dialog -->
        <q-dialog v-model="showDiskWarning" persistent>
            <q-card dark style="min-width: 450px; background: #1a1a1a; border: 1px solid #444;" class="q-pa-md">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6 font-cinzel text-amber">
                        <q-icon name="warning" color="amber" size="32px" class="q-mr-md" />
                        Compatibility Warning
                    </div>
                </q-card-section>

                <q-card-section class="q-pt-md">
                    <p class="text-body1">The selected output directory is a folder on your computer.</p>
                    <p class="text-grey-5">Tsunami SD cards are very sensitive to file system alignment. Files copied
                        manually
                        to
                        an
                        existing folder may not always play correctly or could cause stuttering.</p>

                    <q-checkbox v-model="organStore.suppressDiskWarning" label="Don't warn me again" dark color="amber"
                        class="q-mt-md" />
                </q-card-section>

                <q-card-actions align="right" class="q-gutter-sm">
                    <q-btn flat label="Cancel" color="grey-6" v-close-popup />
                    <q-btn label="Proceed Anyways" color="amber-9" text-color="black" @click="startRendering"
                        v-close-popup />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- Removable Disk Format Dialog -->
        <q-dialog v-model="showFormatDialog" persistent>
            <q-card dark style="min-width: 500px; background: #1a1a1a; border: 2px solid #d32f2f;"
                class="q-pa-md shadow-24">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h5 font-cinzel text-red-5">
                        <q-icon name="sd_card_alert" color="red-5" size="40px" class="q-mr-md" />
                        Format SD Card?
                    </div>
                </q-card-section>

                <q-card-section class="q-pt-md">
                    <div class="bg-red-10 q-pa-md rounded-borders q-mb-md border-red">
                        <div class="text-subtitle1 text-weight-bold text-white">ALL DATA ON THIS VOLUME WILL BE ERASED
                        </div>
                        <div class="text-caption text-red-2">This is the recommended way to ensure maximum compatibility
                            with
                            Tsunami
                            hardware.</div>
                    </div>

                    <p class="text-body2">The volume will be formatted as <span
                            class="text-amber text-weight-bold">FAT32</span>
                        and
                        named <span class="text-amber text-weight-bold">"{{ organStore.targetVolumeLabel }}"</span>.</p>
                </q-card-section>

                <q-card-actions vertical align="center" class="q-gutter-y-sm">
                    <q-btn label="ERASE AND FORMAT (Recommended)" color="red-7"
                        class="full-width q-py-md text-weight-bold" @click="handleFormatAndRender" v-close-popup />

                    <div class="row full-width q-gutter-x-sm">
                        <q-btn flat label="Just copy files" color="grey-6" class="col" @click="startRendering"
                            v-close-popup>
                            <q-tooltip>May cause compatibility issues with Tsunami</q-tooltip>
                        </q-btn>
                        <q-btn flat label="Cancel" color="white" class="col" v-close-popup />
                    </div>
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- Recordings Drawer -->
        <q-drawer v-model="showRecordingsDrawer" side="right" overlay bordered :width="350" class="bg-dark-sidebar"
            style="display: flex; flex-direction: column;">
            <div class="column" style="flex: 0 0 auto;">
                <div class="q-pa-md bg-header-gradient border-bottom-amber row items-center justify-between">
                    <div class="text-h6 font-cinzel text-amber-9">Recordings</div>
                    <q-btn flat round dense icon="close" color="grey-6" @click="showRecordingsDrawer = false" />
                </div>

                <div v-if="isRenderingExport" class="q-pa-md bg-grey-9 q-mb-sm">
                    <div class="text-caption text-grey-4 q-mb-xs">{{ renderStatus || 'Rendering...' }}</div>
                    <q-linear-progress stripe size="15px" :value="renderProgress / 100" color="amber-9">
                        <div class="absolute-full flex flex-center">
                            <q-badge color="transparent" text-color="black" :label="renderProgress + '%'" />
                        </div>
                    </q-linear-progress>
                </div>
            </div>

            <q-scroll-area class="col" style="flex: 1 1 auto;">
                <q-list dark separator>
                    <q-item v-if="organStore.recordings.length === 0" class="text-grey-6 text-center italic q-pa-lg">
                        No recordings available.
                    </q-item>

                    <q-item v-for="rec in organStore.recordings" :key="rec.id" class="q-py-md">
                        <q-item-section>
                            <q-item-label class="text-amber-1 font-cinzel text-weight-bold">
                                {{ rec.name }}
                                <q-popup-edit v-model="rec.name" auto-save v-slot="scope" class="bg-grey-10 text-amber">
                                    <q-input v-model="scope.value" dense autofocus @keyup.enter="scope.set" dark
                                        color="amber" />
                                </q-popup-edit>
                                <q-icon name="edit" size="xs" color="grey-8"
                                    class="q-ml-sm cursor-pointer opacity-50 hover-opacity-100" />
                            </q-item-label>
                            <q-item-label caption class="text-grey-5">
                                {{ new Date(rec.date).toLocaleString() }}
                            </q-item-label>
                            <q-item-label caption class="text-grey-6">
                                {{ (rec.duration / 1000).toFixed(1) }}s • {{ rec.events.length }} events
                            </q-item-label>
                        </q-item-section>

                        <q-item-section side>
                            <div class="row q-gutter-x-xs">
                                <q-btn flat round dense icon="download" color="green-5"
                                    @click="initRenderRecording(rec)">
                                    <q-tooltip>Render to WAV</q-tooltip>
                                </q-btn>
                                <q-btn flat round dense icon="delete" color="red-9"
                                    @click="organStore.deleteRecording(rec.id)">
                                    <q-tooltip>Delete</q-tooltip>
                                </q-btn>
                            </div>
                        </q-item-section>
                    </q-item>
                </q-list>
            </q-scroll-area>
        </q-drawer>

        <!-- Render Options Dialog -->
        <q-dialog v-model="showRenderOptions" persistent>
            <q-card dark style="min-width: 400px; background: #1a1a1a; border: 1px solid #444;" class="q-pa-md">
                <q-card-section>
                    <div class="text-h6 font-cinzel text-amber">Render Recording</div>
                    <div class="text-caption text-grey-5 q-mb-md">Choose rendering mode for "{{ selectedRecording?.name
                    }}"
                    </div>

                    <q-list dark>
                        <q-item tag="label" v-ripple class="bg-grey-9 rounded-borders q-mb-sm">
                            <q-item-section avatar>
                                <q-radio v-model="renderMode" val="tsunami" color="amber" />
                            </q-item-section>
                            <q-item-section>
                                <q-item-label>Standard (Tsunami Mode)</q-item-label>
                                <q-item-label caption>Fast decay (50ms fade out). Best for hardware/sampler
                                    use.</q-item-label>
                            </q-item-section>
                        </q-item>

                        <q-item tag="label" v-ripple class="bg-grey-9 rounded-borders">
                            <q-item-section avatar>
                                <q-radio v-model="renderMode" val="tails" color="amber" />
                            </q-item-section>
                            <q-item-section>
                                <q-item-label>High Quality (With Tails)</q-item-label>
                                <q-item-label caption>Full natural release samples. Best for listening.</q-item-label>
                            </q-item-section>
                        </q-item>
                    </q-list>
                </q-card-section>

                <q-card-actions align="right">
                    <q-btn flat label="Cancel" color="grey-6" v-close-popup />
                    <q-btn label="Render to Disk..." color="green" icon="save_alt" @click="confirmRenderRecording"
                        v-close-popup />
                </q-card-actions>
            </q-card>
        </q-dialog>

    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useOrganStore } from 'src/stores/organ';
import Drawknob from 'src/components/Drawknob.vue';
import OrganScreen from 'src/components/OrganScreen.vue';
import AudioMeter from 'src/components/AudioMeter.vue';
import { parseStopLabel } from 'src/utils/label-parser';
import { useQuasar } from 'quasar';

const $q = useQuasar();

const organStore = useOrganStore();
const router = useRouter();
const selectedBank = ref(-1);
const activeTab = ref('basic');
const showRecordingsDrawer = ref(false);
const showRenderOptions = ref(false);
const selectedRecording = ref<any>(null);
const renderProgress = ref(0);
const isRenderingExport = ref(false);
const renderStatus = ref('');
const renderMode = ref('tsunami');
const showProgressDialog = ref(false);

const showDiskWarning = ref(false);
const showFormatDialog = ref(false);
const showAdvancedDisk = ref(false);

function toggleRecording() {
    if (organStore.isRecording) {
        organStore.stopRecording();
        showRecordingsDrawer.value = true; // Auto open list
    } else {
        organStore.startRecording();
    }
}

function initRenderRecording(rec: any) {
    selectedRecording.value = rec;
    showRenderOptions.value = true;
}

async function confirmRenderRecording() {
    if (!selectedRecording.value) return;
    const renderTails = renderMode.value === 'tails';
    // Deep clone to strip Vue Proxies and ensure clean object for IPC
    const cleanRecording = JSON.parse(JSON.stringify(selectedRecording.value));
    const cleanOrganData = JSON.parse(JSON.stringify(organStore.organData));

    showProgressDialog.value = true;
    renderProgress.value = 0;

    try {
        isRenderingExport.value = true;
        renderProgress.value = 0;
        renderStatus.value = 'Initializing...';

        await window.myApi.renderPerformance(cleanRecording, cleanOrganData, renderTails);

        // Success handling is done via the result awaiting, but progress events come separately
        $q.notify({
            color: 'positive',
            message: 'Recording rendered successfully!'
        });
    } catch (e: any) {
        console.error(e);
        $q.notify({
            color: 'negative',
            message: 'Failed to render recording: ' + e.message
        });
    } finally {
        isRenderingExport.value = false;
        renderProgress.value = 0;
        renderStatus.value = '';
    }
}

onMounted(() => {
    window.myApi.onRenderProgress((_event, data) => {
        // data can be just a number (from render-bank) or object (from render-performance)
        // Check electron-main.ts:
        // ipcMain: event.sender.send('render-progress', progress); -> number
        // ipcMain: mainWindow?.webContents.send('render-progress', { status: 'Rendering Performance...', progress: msg.progress }); -> object

        if (typeof data === 'number') {
            // This is likely from SD card export
            // We can ignore or handle if we want shared UI
        } else if (data && typeof data.progress === 'number') {
            renderProgress.value = data.progress;
            if (data.status) renderStatus.value = data.status;
            isRenderingExport.value = true; // Ensure visible if triggered
        }
    });
});


const filteredScreens = computed(() => {
    return organStore.organData?.screens.filter(screen => {
        let title = screen.name.toLowerCase();
        if (title.includes('noise')) return false;
        if (title.includes('wind')) return false;
        if (title.includes('blow')) return false;
        if (title.includes('cresc')) return false;
        if (title.includes('detun')) return false; // detune or detuning
        if (title.includes('voic')) return false; // voice or voicing
        return true;
    });
});

// RAM Monitoring
const ramUsage = ref(0);
const formattedRam = computed(() => {
    return (ramUsage.value / 1024 / 1024 / 1024).toFixed(2) + ' GB';
});

const ramColor = computed(() => {
    const usageGB = ramUsage.value / 1024 / 1024 / 1024;

    // RGB Values
    // Green: #4caf50 (76, 175, 80)
    // Yellow/Orange: #ff9800 (255, 152, 0)
    // Red: #f44336 (244, 67, 54)

    if (usageGB <= 1) return '#4caf50'; // Green

    if (usageGB < 2) {
        // Interpolate Green -> Yellow
        const t = (usageGB - 1); // 0 to 1
        const r = Math.round(76 + (255 - 76) * t);
        const g = Math.round(175 + (152 - 175) * t);
        const b = Math.round(80 + (0 - 80) * t);
        return `rgb(${r}, ${g}, ${b})`;
    } else if (usageGB < 4) {
        // Interpolate Yellow -> Red
        const t = (usageGB - 2) / 2; // 0 to 1
        const r = Math.round(255 + (244 - 255) * t);
        const g = Math.round(152 + (67 - 152) * t);
        const b = Math.round(0 + (54 - 0) * t);
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        return '#f44336'; // Red
    }
});

let ramListenerCleanup: (() => void) | null = null;


// Virtual Stop logic
const showVsDialog = ref(false);
const vsForm = ref({
    id: undefined as string | undefined, // undefined for new, set for edit
    originalStopId: '',
    name: '',
    pitch: '',
    pitchShift: 0,
    harmonicMultiplier: 1.0,
    noteOffset: 0,
    delay: 0
});

function goBack() {
    organStore.performCleanup();
    router.push('/');
    // window.location.reload();
}

function getScreenScalingStyle(screen: any) {
    // Dynamic scaling to fit reasonable widths if needed
    // For now we'll just center it, but could add zoom logic here
    return {
        // transform: 'scale(0.8)',
    };
}


function openCreateVirtualStop(stopId: string) {
    const stop = organStore.organData?.stops[stopId];
    if (!stop) return;

    const { name, pitch } = parseStopLabel(stop.name);
    vsForm.value = {
        id: undefined,
        originalStopId: stopId,
        name: name + ' (V)',
        pitch: pitch,
        pitchShift: 0,
        harmonicMultiplier: 1.0,
        noteOffset: 0,
        delay: 0
    };
    showVsDialog.value = true;
}

function openEditVirtualStop(vs: any) {
    vsForm.value = {
        id: vs.id,
        originalStopId: vs.originalStopId,
        name: vs.name,
        pitch: vs.pitch,
        pitchShift: vs.pitchShift,
        harmonicMultiplier: vs.harmonicMultiplier,
        noteOffset: vs.noteOffset,
        delay: vs.delay || 0
    };
    showVsDialog.value = true;
}

function saveVirtualStop() {
    const vs = {
        id: vsForm.value.id || 'VIRT_' + crypto.randomUUID(),
        originalStopId: vsForm.value.originalStopId,
        name: vsForm.value.name,
        pitch: vsForm.value.pitch,
        pitchShift: vsForm.value.pitchShift,
        harmonicMultiplier: vsForm.value.harmonicMultiplier,
        noteOffset: vsForm.value.noteOffset,
        delay: vsForm.value.delay || 0
    };

    if (vsForm.value.id) {
        organStore.updateVirtualStop(vs);
    } else {
        organStore.addVirtualStop(vs);
    }
}

function getVirtualStopsFor(stopId: string) {
    return organStore.virtualStops.filter(v => v.originalStopId === stopId);
}

function selectBank(index: number) {
    selectedBank.value = index;
    organStore.loadBank(index);
}

function addNewBank() {
    if (organStore.addBank()) {
        selectedBank.value = organStore.banks.length - 1;
    }
}

async function handleRenderClick() {
    if (!organStore.outputDir) {
        await organStore.setOutputDir();
        if (!organStore.outputDir) return;
    }

    const check = await organStore.checkOutputPath();
    if (check.type === 'removable_root') {
        showFormatDialog.value = true;
    } else if (check.type === 'local_folder') {
        showDiskWarning.value = true;
    } else {
        startRendering();
    }
}

async function handleFormatAndRender() {
    try {
        await organStore.formatOutputVolume();
        startRendering();
    } catch (e: any) {
        // Error is handled in store status
    }
}

function startRendering() {
    organStore.renderAll();
}

function selectDrive(drive: any) {
    organStore.outputDir = drive.mountPoint;
    organStore.isOutputRemovable = true;
}

const midiColor = computed(() => {
    if (organStore.midiStatus === 'Connected') return 'green-5';
    if (organStore.midiStatus === 'Error') return 'red-5';
    return 'grey-7';
});


// Listen for progress
let progressCleanup: (() => void) | null = null;
onMounted(() => {
    if (!organStore.organData) {
        router.push('/');
        return;
    }
    organStore.initMIDI();

    // Start RAM monitoring
    if ((window as any).myApi?.onMemoryUpdate) {
        ramListenerCleanup = (window as any).myApi.onMemoryUpdate((bytes: number) => {
            ramUsage.value = bytes;
        });
    }

    if (window.myApi?.onRenderProgress) {
        progressCleanup = window.myApi.onRenderProgress((event: any, data: any) => {
            // Handle both old format (progress num) and new format ({status, progress})
            const p = typeof data === 'number' ? data : data.progress;
            renderProgress.value = Math.round(p);
        });
    }
});

onUnmounted(() => {
    if (ramListenerCleanup) ramListenerCleanup();
    if (progressCleanup) progressCleanup();
    organStore.stopMIDI();

    if (organStore.drivePollInterval) {
        clearInterval(organStore.drivePollInterval);
        organStore.drivePollInterval = null;
    }
});

watch(
    () => [organStore.banks, organStore.stopVolumes, organStore.useReleaseSamples, organStore.outputDir, organStore.virtualStops],
    () => {
        if (organStore.organData && !organStore.isRestoring) {
            organStore.saveInternalState();
        }
    },
    { deep: true }
);

watch(() => organStore.organData, (newData) => {
    if (!newData) {
        router.push('/');
    }
});
</script>

<style lang="scss" scoped>
.organ-page {
    background: radial-gradient(circle at center, #111 0%, #050505 100%);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex: 1 1 100%;
}

.font-cinzel {
    font-family: 'Cinzel', serif;
}

.text-shadow {
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}

.tracking-wide {
    letter-spacing: 0.1em;
}

.organ-console {
    background: #080808;
    background-image:
        linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7));
    background-size: cover;
}

.console-header {
    background: linear-gradient(to bottom, #111, #080808);
    border-bottom: 4px solid #332211;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
    z-index: 10;
}

.manual-section {
    background: rgba(30, 25, 20, 0.9);
    border-radius: 8px;
    border: 1px solid #443322;
    box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.8);
}

.border-bottom-amber {
    border-bottom: 2px solid #664422;
    display: inline-block;
}

.bank-active {
    background: rgba(212, 175, 55, 0.15);
    border: 1px solid #d4af37;
    border-radius: 4px;
}

.bg-dark-sidebar {
    background: #0f0f0f;
}

.border-left {
    border-left: 2px solid #332211;
}

.border-top-amber {
    border-top: 1px solid #443322;
}

.bg-header-gradient {
    background: linear-gradient(to bottom, #1a1a1a, #0f0f0f);
}

.opacity-50 {
    opacity: 0.5;
}

.hover-opacity-100:hover {
    opacity: 1;
}

.bg-black-50 {
    background: rgba(0, 0, 0, 0.5);
}

.border-amber-muted {
    border: 1px solid rgba(212, 175, 55, 0.2);
}

.dir-path {
    font-family: monospace;
    font-size: 10px;
    opacity: 0.7;
}

.drive-item {
    background: rgba(40, 40, 40, 0.4);
    border: 1px solid transparent;
    transition: all 0.2s ease;

    &:hover {
        background: rgba(60, 60, 60, 0.6);
        border-color: #444;
    }

    &.drive-selected {
        background: rgba(212, 175, 55, 0.15);
        border-color: rgba(212, 175, 55, 0.5);
    }
}

.border-dashed {
    border: 1px dashed #444;
}

.output-destination-area {
    transition: all 0.3s ease;
}

.animate-blink {
    animation: blink 1.5s infinite;
}

@keyframes blink {
    0% {
        opacity: 1;
    }

    50% {
        opacity: 0.3;
    }

    100% {
        opacity: 1;
    }
}
</style>

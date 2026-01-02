<template>
  <q-drawer :model-value="walkthroughStore.isActive" side="right" bordered dark :width="300" class="bg-dark-sidebar"
    @update:model-value="v => !v && walkthroughStore.stop()">
    <div class="column full-height">
      <!-- Header -->
      <div class="q-pa-md bg-header-gradient border-bottom-amber row items-center no-wrap">
        <q-icon name="explore" color="amber-8" size="sm" class="q-mr-sm" />
        <div class="text-h6 font-cinzel text-amber-8 ellipsis">Guided Tour</div>
        <q-space />
        <q-btn flat round dense icon="close" color="grey-6" @click="walkthroughStore.stop()" />
      </div>

      <!-- Step Content -->
      <div class="col q-pa-lg scroll">
        <div class="text-overline text-amber-9 q-mb-xs">Step {{ walkthroughStore.currentStepIndex + 1 }} of {{
          walkthroughStore.steps.length }}</div>
        <div class="text-h5 font-cinzel text-white q-mb-md">{{ walkthroughStore.currentStep?.title }}</div>
        <div class="text-body1 text-grey-4 line-height-relaxed">
          {{ walkthroughStore.currentStep?.text }}
        </div>

        <div v-if="walkthroughStore.currentStep?.targetId" class="q-mt-xl bg-amber-transparent q-pa-md rounded-borders border-amber-muted">
          <div class="row items-center q-gutter-x-sm">
            <q-icon name="touch_app" color="amber-8" size="xs" class="animate-bounce" />
            <div class="text-caption text-amber-8 text-weight-bold uppercase">Action Required</div>
          </div>
          <div class="text-xs text-grey-5 q-mt-xs">
            Follow the pulsing pointer on the screen.
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <div class="q-pa-md border-top-amber bg-dark-sidebar shadow-up-10">
        <div class="row q-gutter-x-sm">
          <q-btn flat color="grey-7" label="Back" class="col" :disable="walkthroughStore.isFirstStep"
            @click="prevStep" />
          <q-btn color="amber-9" text-color="black" :label="walkthroughStore.isLastStep ? 'Finish' : 'Next'" class="col font-cinzel"
            @click="nextStep" />
        </div>
        <q-btn flat color="red-5" label="Exit Tour" class="full-width q-mt-sm text-caption"
          @click="walkthroughStore.stop()" />
      </div>
    </div>
  </q-drawer>
</template>

<script setup lang="ts">
import { useWalkthroughStore } from 'src/stores/walkthrough';
import { useRouter } from 'vue-router';

const walkthroughStore = useWalkthroughStore();
const router = useRouter();

function nextStep() {
  walkthroughStore.next();
  handleRoute();
}

function prevStep() {
  walkthroughStore.prev();
  handleRoute();
}

function handleRoute() {
  const route = walkthroughStore.currentStep?.route;
  if (route && window.location.hash !== '#' + route && window.location.pathname !== route) {
    router.push(route);
  }
}
</script>

<style lang="scss" scoped>
.bg-dark-sidebar {
  background: #0f0f0f;
}

.bg-header-gradient {
  background: linear-gradient(to bottom, #1a1a1a, #0f0f0f);
}

.border-bottom-amber {
  border-bottom: 2px solid #664422;
}

.border-top-amber {
  border-top: 1px solid #443322;
}

.font-cinzel {
  font-family: 'Cinzel', serif;
}

.line-height-relaxed {
  line-height: 1.6;
}

.bg-amber-transparent {
  background: rgba(212, 175, 55, 0.05);
}

.border-amber-muted {
  border: 1px solid rgba(212, 175, 55, 0.2);
}

.animate-bounce {
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 20%, 50%, 80%, 100% {transform: translateY(0);}
  40% {transform: translateY(-5px);}
  60% {transform: translateY(-3px);}
}
</style>

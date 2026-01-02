<template>
  <div v-if="walkthroughStore.isActive && rect" class="walkthrough-pointer" :style="pointerStyle">
    <div class="pointer-ring"></div>
    <div class="pointer-dot"></div>
    <div class="pointer-label font-cinzel">{{ walkthroughStore.currentStep?.title }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useWalkthroughStore } from 'src/stores/walkthrough';
import { useOrganStore } from 'src/stores/organ';

const walkthroughStore = useWalkthroughStore();
const organStore = useOrganStore();
const rect = ref<DOMRect | null>(null);

function updatePosition() {
  const targetId = walkthroughStore.currentStep?.targetId;
  if (!targetId || targetId === 'center') {
    rect.value = null;
    return;
  }

  const el = document.querySelector(targetId);
  if (el) {
    rect.value = el.getBoundingClientRect();
  } else {
    rect.value = null;
  }
}

const pointerStyle = computed(() => {
  // Logic to hide pointer for specific steps if goals are met
  if (walkthroughStore.currentStep?.id === 'save-bank' && organStore.banks.length > 0) {
    return { display: 'none' };
  }

  if (walkthroughStore.currentStep?.position === 'center') {
    return {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)'
    };
  }

  if (!rect.value) return { display: 'none' };

  // Precise centering
  const x = rect.value.left + rect.value.width / 2;
  const y = rect.value.top + rect.value.height / 2;

  return {
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -50%)'
  };
});

function handleGlobalClick(e: MouseEvent) {
  if (!walkthroughStore.isActive) return;
  const targetId = walkthroughStore.currentStep?.targetId;
  if (!targetId) return;

  const targetEl = document.querySelector(targetId);
  if (targetEl && (targetEl === e.target || targetEl.contains(e.target as Node))) {
    // User clicked the target!
    // Exception: If they are on the "save-bank" step, don't auto-advance because they might want to add more banks
    if (walkthroughStore.currentStep.id !== 'save-bank') {
      setTimeout(() => {
        walkthroughStore.next();
        // Trigger a route sync if needed (usually handled by drawer but good to be safe)
        const nextRoute = walkthroughStore.currentStep?.route;
        if (nextRoute && window.location.hash !== '#' + nextRoute) {
          // The drawer handles this usually
        }
      }, 300); // Small delay for visual feedback
    }
  }
}

let interval: any = null;

onMounted(() => {
  interval = setInterval(updatePosition, 100);
  window.addEventListener('click', handleGlobalClick, true);
});

onUnmounted(() => {
  if (interval) clearInterval(interval);
  window.removeEventListener('click', handleGlobalClick, true);
});

watch(() => walkthroughStore.currentStepIndex, updatePosition);
watch(() => walkthroughStore.isActive, updatePosition);
</script>

<style lang="scss" scoped>
.walkthrough-pointer {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pointer-ring {
  width: 40px;
  height: 40px;
  border: 3px solid #d4af37;
  border-radius: 50%;
  position: absolute;
  animation: pulse-ring 1.5s cubic-bezier(0.24, 0, 0.38, 1) infinite;
}

.pointer-dot {
  width: 12px;
  height: 12px;
  background: #d4af37;
  border-radius: 50%;
  box-shadow: 0 0 10px rgba(212, 175, 55, 0.8);
}

.pointer-label {
  margin-top: 45px;
  background: rgba(212, 175, 55, 0.9);
  color: black;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  white-space: nowrap;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
}

@keyframes pulse-ring {
  0% {
    transform: scale(0.5);
    opacity: 1;
  }

  100% {
    transform: scale(2);
    opacity: 0;
  }
}

.font-cinzel {
  font-family: 'Cinzel', serif;
}
</style>

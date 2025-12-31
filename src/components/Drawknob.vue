<template>
  <div class="drawknob-container q-ma-sm text-center">
    <div class="knob-clickable" :class="{ 'is-active': active, 'is-virtual': isVirtual }" @click="$emit('toggle')">
      <!-- <div class="knob-stem"></div> -->
      <div class="knob-head"
        :style="active ? (isVirtual ? 'background: #00ff88; border-color: #00cc66;' : 'background: #ffcc00; border-color: #d4af37;') : ''">
        <slot></slot>
        <div class="knob-label">
          <div class="stop-name">{{ name }}</div>
          <div class="stop-pitch">{{ pitch }}</div>
        </div>
      </div>
    </div>

    <div class="volume-control q-mt-sm">
      <q-slider :model-value="volume" @update:model-value="$emit('update:volume', $event)" :min="0" :max="200" :step="1"
        dense :color="isVirtual ? 'green' : 'amber'" class="volume-slider" />
      <div class="volume-text">{{ volume }}%</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  pitch: string;
  active: boolean;
  volume: number;
  isVirtual?: boolean;
}>();

defineEmits(['toggle', 'update:volume', 'delete']);
</script>

<style lang="scss" scoped>
.drawknob-container {
  display: inline-block;
  width: 90px;
  vertical-align: top;
  position: relative;
}

.delete-btn {
  position: absolute;
  top: 0;
  right: 0;
  opacity: 0.3;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
  }
}

.knob-clickable {
  cursor: pointer;
  transition: transform 0.2s ease;

  &:hover {
    transform: scale(1.05);
  }

  &.is-active {
    .knob-head {
      box-shadow: 0 5px 20px rgba(255, 204, 0, 0.5);
    }

    &.is-virtual .knob-head {
      box-shadow: 0 5px 20px rgba(0, 255, 136, 0.5);
    }
  }
}

.knob-stem {
  width: 18px;
  height: 10px;
  background: linear-gradient(to right, #222, #555, #222);
  margin: 0 auto;
}

.knob-head {
  width: 76px;
  height: 76px;
  background: radial-gradient(circle at 35% 35%, #ffffff, #e6e6e6 65%, #cccccc);
  border-radius: 50%;
  border: 4px solid #333;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}

.knob-label {
  padding: 8px;
  color: #000;
  font-family: 'Cinzel', serif;
  font-weight: 700;
  pointer-events: none;
  z-index: 1;
}

.stop-name {
  font-size: 9px;
  line-height: 1.1;
  text-transform: uppercase;
}

.stop-pitch {
  font-size: 13px;
  margin-top: 2px;
}

.volume-control {
  padding: 0 4px;
}

.volume-text {
  font-size: 10px;
  color: #aaa;
  font-family: monospace;
}

.volume-slider {
  margin-bottom: -4px;
}
</style>

<template>
  <div class="drawknob-container q-ma-sm text-center">
    <div class="knob-clickable" :class="{ 'is-active': active, 'is-virtual': isVirtual, [classificationClass]: true }"
      @click="$emit('toggle')">
      <!-- <div class="knob-stem"></div> -->
      <div class="knob-head">
        <slot></slot>
        <div class="knob-label">
          <div class="stop-name" v-html="displayLabel"></div>
          <div class="stop-pitch">{{ pitch }}</div>
        </div>
      </div>
    </div>

    <div v-if="!hideVolume" class="volume-control q-mt-sm">
      <q-slider :model-value="volume" @update:model-value="$emit('update:volume', $event)" :min="0" :max="200" :step="1"
        dense :color="isVirtual ? 'green' : 'amber'" class="volume-slider" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { StopClassification } from '../utils/label-parser';

const props = defineProps<{
  name: string;
  pitch: string;
  active: boolean;
  volume: number;
  isVirtual?: boolean;
  classification?: StopClassification;
  hideVolume?: boolean;
}>();

defineEmits(['toggle', 'update:volume', 'delete']);

const classificationClass = computed(() => {
  if (props.isVirtual) return '';
  return props.classification ? `type-${props.classification.toLowerCase()}` : 'type-default';
});

const displayLabel = computed(() => {
  let label = props.name;

  // Dictionary of manual hyphenations / break points
  const breaks: Record<string, string> = {
    'kleingedackt': 'Klein&shy;gedackt',
    'lieblich': 'Lieb&shy;lich',
    'violoncello': 'Violon&shy;cello',
    'nachthoorn': 'Nacht&shy;hoorn',
    'dwarsfluit': 'Dwars&shy;fluit',
    'sesquialtera': 'Sesqui&shy;altera',
    'sesquialter': 'Sesqui&shy;alter',
    'fourniture': 'Fourni&shy;ture',
    'voxhumana': 'Vox&shy;Humana',
    'undamaris': 'Unda&shy;Maris',
    'quintadecima': 'Quinta&shy;decima',
    'quintadeen': 'Quinta&shy;deen',
    'kromhoorn': 'Krom&shy;hoorn',
    'koppelfluit': 'Koppel&shy;fluit',
    'trichterflote': 'Trichter&shy;flote',
    'geigenprincipal': 'Geigen&shy;Principal',
    'geigenflute': 'Geigen&shy;Flute'
  };

  // 1. Check for split words (e.g. "Space String" -> "Space<br>String")
  // If it's 2+ words and > 10 chars, force break
  if (label.includes(' ') && label.length > 8) {
    // Replace last space with non-breaking space if short? No, we want wrapping.
    // Actually CSS might handle space wrapping, but for specific "Nice Breaks", let's rely on CSS word-break usually.
    // But user asked for "smartly broken".
  }

  // 2. Apply dictionary checks for compound words
  Object.keys(breaks).forEach(key => {
    const regex = new RegExp(key, 'gi');
    if (regex.test(label)) {
      // Replace preserving case (tricky with simple replace, but usually casing is standard)
      // Simple hack: if match found, replace with dictionary value respecting capitalization?
      // Let's just do a case-insensitive replace by rebuilding
      label = label.replace(regex, (match) => {
        // If dictionary has hyphen, insert it into match
        const breakWord = breaks[key];
        if (!breakWord) return match;

        if (match.toLowerCase() === key.toLowerCase()) {
          // Try to match case of parts? 
          // Simple approach: Use the dictionary casing if it matches exactly, otherwise just insert shy at index
          // Let's just return the dictionary version which is usually Title Case, or keep generic.
          // Better: find where the split is in key, and insert &shy; in match at same pos.
          const splitIndex = breakWord.indexOf('&shy;');
          return match.slice(0, splitIndex) + '&shy;' + match.slice(splitIndex);
        }
        return match;
      });
    }
  });

  return label;
});

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

  /* Default Active Glow (Restored for all types) */
  &.is-active {
    .knob-head {
      /* Match virtual style but yellow: Light center #ffffe0 -> Vibrant #ffcc00 */
      background: radial-gradient(circle at 35% 35%, #ffffe0, #ffcc00 80%);
      box-shadow: 0 0 15px rgba(255, 204, 0, 0.6), inset 0 0 20px rgba(255, 255, 255, 0.2);
      border-color: #ffd700;
    }
  }

  /* Virtual Knob Styling (Prioritized) */
  &.is-virtual {
    .knob-head {
      color: #333;
      /* Default Text color for virtual */
    }

    &.is-active .knob-head {
      background: radial-gradient(circle at 35% 35%, #e0ffe0, #00ff88 80%);
      border-color: #00cc66;
      box-shadow: 0 0 15px rgba(0, 255, 136, 0.6);
    }
  }

  /* --- Classification TEXT Colors (Applies ALWAYS) --- */
  /* Target .knob-label to override color */

  /* REED: Red Text */
  &.type-reed:not(.is-virtual) .knob-label {
    color: #cc0000;
  }

  /* Active state text might need to be brighter or same? Keep same. */

  /* MIXTURE: Green Text */
  &.type-mixture:not(.is-virtual) .knob-label {
    color: #064506;
  }

  /* PRINCIPAL: Blue Text */
  &.type-principal:not(.is-virtual) .knob-label {
    color: #0a0a7e;
  }

  /* FLUTE: Black Text (Default) */
  &.type-flute:not(.is-virtual) .knob-label {
    color: #412104;
  }

  /* STRING: Purple Text */
  &.type-string:not(.is-virtual) .knob-label {
    color: #3f0c73;
  }

  /* COUPLER: Dark Grey Text */
  &.type-coupler:not(.is-virtual) .knob-label {
    color: #333333;
    font-style: italic;
  }

  /* TREMULANT: Orange/Brown Text */
  &.type-tremulant:not(.is-virtual) .knob-label {
    color: #8b4500;
  }
}

.knob-stem {
  width: 18px;
  height: 10px;
  background: linear-gradient(to right, #222, #555, #222);
  margin: 0 auto;
}

.knob-head {
  width: 84px;
  height: 84px;
  /* Default Inactive State (White/Ivory) */
  background: radial-gradient(circle at 35% 35%, #ffffff, #f0f0f0 65%, #d9d9d9);
  border-radius: 50%;
  border: 4px solid #666;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.2s ease;
  color: #111;
}

.knob-label {
  padding: 4px;
  font-family: 'Cinzel', serif;
  font-weight: 700;
  pointer-events: none;
  z-index: 1;
  width: 100%;
}

.stop-name {
  font-size: 10.5px;
  line-height: 1.1;
  text-transform: uppercase;
  margin-bottom: 2px;
  max-width: 100%;
}

.stop-pitch {
  font-size: 15px;
  font-weight: bold;
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

<template>
  <v-container class="pa-4">
    <v-card elevation="2" class="rounded-lg">
      <v-card-item>
        <v-card-title class="text-h6 font-weight-regular">{{ $t('Codex.Title') }}</v-card-title>
        <v-card-subtitle>{{ $t('Codex.Tip') }}</v-card-subtitle>
      </v-card-item>

      <v-card-text class="pt-0">
        <v-text-field
          v-model.number="modelValue.data.intervalMs"
          :label="$t('Config.Interval')"
          type="number"
          min="5000"
          step="5000"
          density="compact"
          variant="outlined"
        ></v-text-field>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
export default {
  name: 'CodexUsageKey',
  props: {
    modelValue: {
      type: Object,
      required: true
    }
  }
}
</script>

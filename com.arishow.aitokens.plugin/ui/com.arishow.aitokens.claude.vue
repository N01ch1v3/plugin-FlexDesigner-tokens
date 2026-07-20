<template>
  <v-container class="pa-4">
    <v-card elevation="2" class="rounded-lg">
      <v-card-item>
        <v-card-title class="text-h6 font-weight-regular">{{ $t('Claude.Title') }}</v-card-title>
        <v-card-subtitle>{{ $t('Claude.Tip') }}</v-card-subtitle>
      </v-card-item>

      <v-card-text class="pt-0">
        <v-text-field
          v-model.number="modelValue.data.intervalMs"
          :label="$t('Config.Interval') "
          :hint="$t('Config.IntervalHint')"
          type="number"
          min="60000"
          step="30000"
          persistent-hint
          density="compact"
          variant="outlined"
        ></v-text-field>

        <v-alert
          type="info"
          variant="tonal"
          density="compact"
          class="mt-4"
          :text="$t('Config.Note')"
        ></v-alert>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
export default {
  name: 'ClaudeUsageKey',
  props: {
    modelValue: {
      type: Object,
      required: true
    }
  }
}
</script>

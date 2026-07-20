<template>
  <v-container class="pa-4">
    <v-card elevation="2" class="mb-4 rounded-lg">
      <v-card-item prepend-icon="mdi-gauge">
        <v-card-title>{{ $t('PluginName') }}</v-card-title>
        <v-card-subtitle>{{ $t('Config.Interval') }}</v-card-subtitle>
      </v-card-item>
      <v-divider></v-divider>

      <v-card-text>
        <v-text-field
          v-model.number="modelValue.config.intervalMs"
          :label="$t('Config.Interval')"
          :hint="$t('Config.IntervalHint')"
          type="number"
          min="60000"
          step="30000"
          persistent-hint
          density="compact"
          variant="outlined"
        ></v-text-field>
      </v-card-text>
    </v-card>

    <v-alert type="info" variant="tonal" density="comfortable">
      {{ $t('Config.Note') }}
    </v-alert>
  </v-container>
</template>

<script>
export default {
  name: 'AiTokensConfigPage',
  props: {
    modelValue: {
      type: Object,
      required: true
    }
  }
}
</script>

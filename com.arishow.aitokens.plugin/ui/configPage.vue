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

    <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
      {{ $t('Config.Note') }}
    </v-alert>

    <v-card elevation="2" class="rounded-lg">
      <v-card-item prepend-icon="mdi-login-variant">
        <v-card-title>{{ $t('Relogin.Title') }}</v-card-title>
        <v-card-subtitle>{{ $t('Relogin.Subtitle') }}</v-card-subtitle>
      </v-card-item>
      <v-divider></v-divider>

      <v-card-text>
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-open-in-new"
          @click="startRelogin"
        >
          {{ $t('Relogin.Button') }}
        </v-btn>

        <v-text-field
          v-model="reloginCode"
          :label="$t('Relogin.CodeLabel')"
          :hint="$t('Relogin.CodeHint')"
          persistent-hint
          density="compact"
          variant="outlined"
          class="mt-4"
        ></v-text-field>

        <v-alert
          v-if="reloginStatus"
          :type="reloginAlertType"
          variant="tonal"
          density="compact"
          class="mt-4"
        >
          {{ reloginStatusText }}
          <div v-if="reloginStatus === 'error' && modelValue.config.claudeReloginError" class="text-caption mt-1">
            {{ modelValue.config.claudeReloginError }}
          </div>
        </v-alert>
      </v-card-text>
    </v-card>
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
  },
  data() {
    return {
      reloginCode: this.modelValue.config.claudeReloginCode || ''
    }
  },
  computed: {
    reloginStatus() {
      return this.modelValue.config.claudeReloginStatus || ''
    },
    reloginAlertType() {
      if (this.reloginStatus === 'success') return 'success'
      if (this.reloginStatus === 'error') return 'error'
      return 'info'
    },
    reloginStatusText() {
      if (this.reloginStatus === 'awaiting-code') return this.$t('Relogin.StatusAwaitingCode')
      if (this.reloginStatus === 'success') return this.$t('Relogin.StatusSuccess')
      if (this.reloginStatus === 'error') return this.$t('Relogin.StatusError')
      return ''
    }
  },
  methods: {
    startRelogin() {
      this.reloginCode = ''
      this.modelValue.config.claudeReloginRequestedAt = Date.now()
    }
  },
  watch: {
    reloginCode(value) {
      this.modelValue.config.claudeReloginCode = value
    },
    'modelValue.config.claudeReloginCode'(value) {
      if (value === '') this.reloginCode = ''
    }
  }
}
</script>

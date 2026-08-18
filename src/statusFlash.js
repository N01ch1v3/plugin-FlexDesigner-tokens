const COMPLETE_FLASH_DURATION_MS = 10_000;
const COMPLETE_FLASH_INTERVAL_MS = 500;
const THINKING_RUN_INTERVAL_MS = 160;

function shouldFlashComplete(previousStatus, nextStatus) {
  return (
    previousStatus?.state === "working" &&
    previousStatus?.action === "THINKING" &&
    nextStatus?.state === "complete"
  );
}

module.exports = {
  shouldFlashComplete,
  COMPLETE_FLASH_DURATION_MS,
  COMPLETE_FLASH_INTERVAL_MS,
  THINKING_RUN_INTERVAL_MS
};

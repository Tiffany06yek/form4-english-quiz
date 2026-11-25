/* SPM writing practice config. The teacher passcode is stored only as a hash. */
window.WRITING_CONFIG = {
  /* SHA-256 of the class passcode (same as the Form 4 English teacher page). */
  passHash: "5ab82462146e5e0747cb8ea4187c26a50f62fa7dc1612e3e8a9099b79eae9254",
  store: {
    binUrl: "https://jsonstorage.com/m-g2II6L3w1W7h",
    writeKey: "IvEyL5OYe-WzSo0baNg9Psg4gXCQjGz7",
    writeHeader: "X-Bin-Key",
    expiresAt: "2026-12-25T04:49:24.316Z"
  },
  webhook: {
    postUrl: "https://webhook.site/343ee412-f448-4d86-ba7f-047ac869dbea",
    inboxUrl: "https://webhook.site/#!/343ee412-f448-4d86-ba7f-047ac869dbea",
    expiresAt: "2026-12-02T04:49:25.000Z"
  },
  saveTimeoutMs: 5000
};

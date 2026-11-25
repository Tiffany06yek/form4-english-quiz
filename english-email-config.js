/* Email practice config. The teacher passcode is stored only as a hash. */
window.EMAIL_CONFIG = {
  /* SHA-256 of the class passcode (same as the Form 4 English teacher page). */
  passHash: "5ab82462146e5e0747cb8ea4187c26a50f62fa7dc1612e3e8a9099b79eae9254",
  /* jsonstorage.com is used in the same role as keepjson (public read, write key to update).
     The public keepjson demo now caps TTL at 60 seconds, which is too short for class results. */
  store: {
    binUrl: "https://jsonstorage.com/TBSBDDWr5KRg9b",
    writeKey: "8rOSlX77hK1yx2tNInFVSRqfOPrpj89c",
    writeHeader: "X-Bin-Key",
    expiresAt: "2026-12-25T04:27:35.456Z"
  },
  webhook: {
    postUrl: "https://webhook.site/1d8c9892-602c-46d4-bbf9-32f0f53003e8",
    inboxUrl: "https://webhook.site/#!/1d8c9892-602c-46d4-bbf9-32f0f53003e8",
    expiresAt: "2026-12-02T04:23:15.000Z"
  },
  saveTimeoutMs: 5000
};

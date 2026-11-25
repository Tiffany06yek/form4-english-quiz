(function () {
  const cfg = window.EMAIL_CONFIG;

  function wordCount(text) {
    const t = (text || "").trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }

  function nowKL() {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
    return fmt.format(new Date()) + " (Asia/Kuala_Lumpur)";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Rough content check only — not a mark. Keeps cues general so this is not a model answer. */
  function pointChecks(text) {
    const t = String(text || "").toLowerCase();
    const tipCues = t.match(/\b(you should|you can|you could|try to|remember to|make sure|one tip|another tip|first,|second,|also, you|my advice)\b/g) || [];
    return [
      {
        id: "felt",
        label: "How you felt when you started Form 4",
        ok: /\b(felt|feeling|feel|nervous|excited|scared|worried|confused|overwhelmed|same as you|when i (first )?start)/i.test(t)
      },
      {
        id: "tips",
        label: "Two useful tips for doing well this year",
        ok: tipCues.length >= 2
      },
      {
        id: "activity",
        label: "One after-school activity he might enjoy",
        ok: /\b(club|societ|sport|activit|after[- ]school|join (a|the|our)|football|basketball|badminton|netball|volleyball|choir|debate|drama|music|art club|uniform body)\b/i.test(t)
      },
      {
        id: "invite",
        label: "An invitation to a study session this weekend",
        ok: /\b(study session|this weekend|on saturday|on sunday|come (over|to|and)|meet (up|me)|let'?s study|would you like to (study|come|join)|join me this weekend)\b/i.test(t)
      },
      {
        id: "length",
        label: "Word count is between 80 and 100",
        ok: (function () { const n = wordCount(text); return n >= 80 && n <= 100; })()
      }
    ];
  }

  const writing = document.getElementById("writing");
  const wc = document.getElementById("wordCount");
  function updateWords() {
    const n = wordCount(writing.value);
    wc.textContent = "Word count: " + n + "   (aim for 80–100 words)";
    wc.className = "wordcount" + (n >= 80 && n <= 100 ? " ok" : n > 0 ? " warn" : "");
  }
  writing.addEventListener("input", updateWords);
  updateWords();

  const form = document.getElementById("quiz");
  const errBox = document.getElementById("formError");
  const results = document.getElementById("results");
  const submitBtn = document.getElementById("submitBtn");

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.add("show");
    errBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errBox.classList.remove("show");
    const name = (form.studentName.value || "").trim();
    if (!name) {
      showError("Please type your name.");
      return;
    }
    const email = (writing.value || "").trim();
    if (!email) {
      showError("Please write your email.");
      return;
    }

    const words = wordCount(email);
    const payload = {
      _id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      kind: "email",
      name: name,
      timeKL: nowKL(),
      timeISO: new Date().toISOString(),
      writing: email,
      wordCount: words,
      teacherMark: ""
    };

    submitBtn.disabled = true;
    const actions = form.querySelector(".actions");
    if (actions) actions.style.display = "none";
    Array.from(form.elements).forEach(function (el) { el.disabled = true; });

    renderResults(payload);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
    saveInBackground(payload);
  });

  function fetchWithTimeout(url, options, timeoutMs, controller) {
    const opts = options || {};
    opts.signal = controller.signal;
    return fetch(url, opts);
  }

  function storeGetUrl() {
    return cfg.store.binUrl + (cfg.store.binUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
  }

  async function saveStore(payload, controller) {
    const s = cfg.store;
    const get = await fetchWithTimeout(storeGetUrl(), { method: "GET" }, cfg.saveTimeoutMs, controller);
    if (!get.ok) throw new Error("Read failed (" + get.status + ")");
    const data = await get.json();
    const list = (data && Array.isArray(data.submissions)) ? data.submissions.slice() : [];
    list.push(payload);
    const headers = { "Content-Type": "application/json" };
    headers[s.writeHeader || "X-Bin-Key"] = s.writeKey;
    const put = await fetchWithTimeout(s.binUrl, {
      method: "PUT",
      headers: headers,
      body: JSON.stringify({ submissions: list })
    }, cfg.saveTimeoutMs, controller);
    if (!put.ok) throw new Error("Save failed (" + put.status + ")");
  }

  async function saveWebhook(payload, controller) {
    const res = await fetchWithTimeout(cfg.webhook.postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, cfg.saveTimeoutMs, controller);
    if (!res.ok) throw new Error("Backup save failed (" + res.status + ")");
  }

  async function saveBoth(payload) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, cfg.saveTimeoutMs || 5000);
    try {
      const settled = await Promise.allSettled([
        saveStore(payload, controller),
        saveWebhook(payload, controller)
      ]);
      const primary = settled[0].status === "fulfilled";
      const backup = settled[1].status === "fulfilled";
      let error = "";
      if (!primary && !backup) {
        const reason = settled[0].reason || settled[1].reason;
        if (reason && reason.name === "AbortError") error = "Save timed out";
        else error = (reason && reason.message) || "Save failed";
      }
      return { ok: primary || backup, primary: primary, backup: backup, error: error };
    } finally {
      clearTimeout(timer);
    }
  }

  function setSaveStatus(kind, html) {
    const el = document.getElementById("saveStatus");
    if (!el) return;
    el.className = kind === "ok" ? "ok-msg" : kind === "saving" ? "saving-msg" : "warn-msg";
    el.innerHTML = html;
  }

  async function saveInBackground(payload) {
    setSaveStatus("saving", "Saving your email for your teacher…");
    const outcome = await saveBoth(payload);
    const summary = buildSummary(payload);
    if (outcome.ok) {
      setSaveStatus("ok", "Saved. Your teacher can see your email. You can leave this page when you are ready.");
    } else {
      setSaveStatus(
        "warn",
        "<b>Your email is ready on this page, but it could not be sent to your teacher automatically</b> (" +
          escapeHtml(outcome.error) +
          "). Please copy the summary below and send it to her." +
          '<div class="copy-box" id="copyBox"></div>' +
          '<button type="button" class="secondary" id="copyBtn">Copy summary</button>'
      );
      const box = document.getElementById("copyBox");
      if (box) {
        box.textContent = summary;
        const btn = document.getElementById("copyBtn");
        if (btn) {
          btn.addEventListener("click", function () {
            navigator.clipboard.writeText(summary).then(function () {
              btn.textContent = "Copied";
            }).catch(function () {
              btn.textContent = "Select the text and copy it";
            });
          });
        }
      }
    }
  }

  function renderResults(payload) {
    const checks = pointChecks(payload.writing).map(function (it) {
      return (
        "<li>" +
          '<span class="badge ' + (it.ok ? "ok" : "no") + '">' + (it.ok ? "Seen" : "Not clearly seen") + "</span>" +
          "<div>" + escapeHtml(it.label) + "</div>" +
        "</li>"
      );
    }).join("");

    results.innerHTML =
      '<div class="confirmbox">' +
        '<div class="big">Submitted</div>' +
        "<p>Thank you, " + escapeHtml(payload.name) + ". Your teacher will mark this email.</p>" +
        "<p>Word count: " + payload.wordCount + ".</p>" +
      "</div>" +
      '<div id="saveStatus" class="saving-msg">Saving your email for your teacher…</div>' +
      "<h2>Quick checklist</h2>" +
      '<p class="check-note">This is only a rough check of whether the required points seem to appear in your writing. It is <b>not</b> a score. Your teacher will mark the email.</p>' +
      '<ul class="check-list">' + checks + "</ul>" +
      "<h2>Your email</h2>" +
      '<div class="writing-view">' + escapeHtml(payload.writing) + "</div>";
    results.classList.add("show");
  }

  function buildSummary(p) {
    return [
      "Form 4 English DLP — Mini Writing (Email)",
      "Name: " + p.name,
      "Time: " + p.timeKL,
      "Word count: " + p.wordCount,
      "",
      "Email:",
      p.writing
    ].join("\n");
  }
})();

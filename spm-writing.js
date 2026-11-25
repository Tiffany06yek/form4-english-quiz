(function () {
  const cfg = window.WRITING_CONFIG;
  const TARGETS = {
    1: { min: 70, max: 90, label: "about 80 words" },
    2: { min: 70, max: 90, label: "about 80 words" },
    3: { min: 125, max: 150, label: "125–150 words" },
    4: { min: 125, max: 150, label: "125–150 words" }
  };
  const TITLES = {
    1: "Question 1 (SPM 2024, Paper 2, Part 1)",
    2: "Question 2 (SPM 2022, Paper 2, Part 1)",
    3: "Question 3 (SPM 2024, Paper 2, Part 2)",
    4: "Question 4 (SPM 2021, Paper 2, Part 2)"
  };

  function wordCount(text) {
    const t = (text || "").trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }

  function nowKL() {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
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

  function updateWords(i) {
    const el = document.getElementById("writing" + i);
    const wc = document.getElementById("wordCount" + i);
    const n = wordCount(el.value);
    const t = TARGETS[i];
    wc.textContent = "Word count: " + n + "   (aim for " + t.label + ")";
    wc.className = "wordcount" + (n >= t.min && n <= t.max ? " ok" : n > 0 ? " warn" : "");
  }

  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById("writing" + i);
    el.addEventListener("input", updateWords.bind(null, i));
    updateWords(i);
  }

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
    const writings = {};
    const counts = {};
    for (let i = 1; i <= 4; i++) {
      const text = (document.getElementById("writing" + i).value || "").trim();
      if (!text) {
        showError("Please write your answer for Question " + i + ".");
        return;
      }
      writings[i] = text;
      counts[i] = wordCount(text);
    }

    const payload = {
      _id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      kind: "spm-writing",
      name: name,
      timeKL: nowKL(),
      timeISO: new Date().toISOString(),
      writings: writings,
      wordCounts: counts,
      teacherMarks: { 1: "", 2: "", 3: "", 4: "" }
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
    setSaveStatus("saving", "Saving your answers for your teacher…");
    const outcome = await saveBoth(payload);
    const summary = buildSummary(payload);
    if (outcome.ok) {
      setSaveStatus("ok", "Saved. Your teacher can see your writing. You can leave this page when you are ready.");
    } else {
      setSaveStatus(
        "warn",
        "<b>Your writing is ready on this page, but it could not be sent to your teacher automatically</b> (" +
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
    const blocks = [1, 2, 3, 4].map(function (i) {
      return (
        "<h2>" + TITLES[i] + "</h2>" +
        "<p class='meta'>Word count: " + payload.wordCounts[i] + " (aim for " + TARGETS[i].label + ")</p>" +
        '<div class="writing-view">' + escapeHtml(payload.writings[i]) + "</div>"
      );
    }).join("");

    results.innerHTML =
      '<div class="confirmbox">' +
        '<div class="big">Submitted</div>' +
        "<p>Thank you, " + escapeHtml(payload.name) + ". Your teacher will mark these four pieces of writing. There is no automatic score.</p>" +
      "</div>" +
      '<div id="saveStatus" class="saving-msg">Saving your answers for your teacher…</div>' +
      blocks;
    results.classList.add("show");
  }

  function buildSummary(p) {
    const lines = [
      "Form 4 English DLP — SPM Writing Practice",
      "Name: " + p.name,
      "Time: " + p.timeKL,
      ""
    ];
    [1, 2, 3, 4].forEach(function (i) {
      lines.push(TITLES[i] + " — Word count: " + p.wordCounts[i]);
      lines.push(p.writings[i]);
      lines.push("");
    });
    return lines.join("\n");
  }
})();

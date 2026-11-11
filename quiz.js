(function () {
  const cfg = window.QUIZ_CONFIG;
  const MCQ = new Set(["1","2","3","4","5","6","7","8","22","23","24"]);

  function unpackKey() {
    const bin = atob(cfg.packedKey);
    const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return JSON.parse(new TextDecoder().decode(bytes));
  }

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

  function normFill(s) {
    return String(s || "").trim().toLowerCase();
  }

  function isCorrect(id, value, key) {
    const expected = key.a[id];
    if (Array.isArray(expected)) {
      return expected.map(normFill).includes(normFill(value));
    }
    return String(value || "").trim().toUpperCase() === String(expected).toUpperCase();
  }

  function collectAnswers(form) {
    const answers = {};
    for (let i = 1; i <= 24; i++) {
      const name = "q" + i;
      if (MCQ.has(String(i))) {
        const el = form.querySelector('input[name="' + name + '"]:checked');
        answers[String(i)] = el ? el.value : "";
      } else {
        answers[String(i)] = (form.elements[name].value || "").trim();
      }
    }
    return answers;
  }

  function grade(answers, key) {
    const items = [];
    let score = 0;
    for (let i = 1; i <= 24; i++) {
      const id = String(i);
      const ok = isCorrect(id, answers[id], key);
      if (ok) score += 1;
      items.push({
        id: id,
        student: answers[id] || "(blank)",
        correct: key.d[id],
        ok: ok
      });
    }
    return { score: score, items: items };
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
    const answers = collectAnswers(form);
    for (let i = 1; i <= 24; i++) {
      if (!answers[String(i)]) {
        showError("Please answer question " + i + " before submitting.");
        return;
      }
    }
    const email = (writing.value || "").trim();
    if (!email) {
      showError("Please write your email in Part F.");
      return;
    }

    const words = wordCount(email);
    const key = unpackKey();
    const g = grade(answers, key);
    const payload = {
      _id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      name: name,
      timeKL: nowKL(),
      timeISO: new Date().toISOString(),
      score: g.score,
      total: 24,
      answers: answers,
      itemResults: g.items,
      writing: email,
      wordCount: words
    };

    submitBtn.disabled = true;
    const actions = form.querySelector(".actions");
    if (actions) actions.style.display = "none";
    Array.from(form.elements).forEach(function (el) { el.disabled = true; });

    // Show the score immediately. Save in the background so a slow store cannot block it.
    renderResults(payload);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
    saveInBackground(payload);
  });

  function fetchWithTimeout(url, options, timeoutMs, controller) {
    const opts = options || {};
    opts.signal = controller.signal;
    return fetch(url, opts);
  }

  async function saveKeepjson(payload, controller) {
    const k = cfg.keepjson;
    const get = await fetchWithTimeout(k.binUrl, { method: "GET" }, cfg.saveTimeoutMs, controller);
    if (!get.ok) throw new Error("Read failed (" + get.status + ")");
    const data = await get.json();
    const list = (data && Array.isArray(data.submissions)) ? data.submissions.slice() : [];
    list.push(payload);
    const put = await fetchWithTimeout(k.binUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + k.writeKey
      },
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
        saveKeepjson(payload, controller),
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
      setSaveStatus("ok", "Saved. Your teacher can see your score and email. You can leave this page when you are ready.");
    } else {
      setSaveStatus(
        "warn",
        "<b>Your score is ready, but it could not be sent to your teacher automatically</b> (" +
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
    const rows = payload.itemResults.map(function (it) {
      return (
        '<div class="item-result">' +
          '<span class="badge ' + (it.ok ? "ok" : "no") + '">' + (it.ok ? "Correct" : "Wrong") + "</span>" +
          "<div><b>Q" + it.id + ".</b> Your answer: " + escapeHtml(it.student) +
          (it.ok ? "" : "<br>Correct answer: <b>" + escapeHtml(it.correct) + "</b>") +
          "</div>" +
        "</div>"
      );
    }).join("");

    results.innerHTML =
      '<div class="scorebox">' +
        '<div class="big">' + payload.score + " / 24</div>" +
        "<p>Grammar score for " + escapeHtml(payload.name) + "</p>" +
        "<p>The short email is marked by your teacher and is not included in this score. Word count: " +
        payload.wordCount + ".</p>" +
      "</div>" +
      '<div id="saveStatus" class="saving-msg">Saving your answers for your teacher…</div>' +
      "<h2>Question review</h2>" +
      rows +
      "<h2>Your email</h2>" +
      '<div class="writing-view">' + escapeHtml(payload.writing) + "</div>";
    results.classList.add("show");
  }

  function buildSummary(p) {
    const lines = [
      "Form 4 English DLP — Grammar & Mini Writing",
      "Name: " + p.name,
      "Time: " + p.timeKL,
      "Grammar score: " + p.score + " / 24",
      "Word count: " + p.wordCount,
      "",
      "Answers:"
    ];
    p.itemResults.forEach(function (it) {
      lines.push("Q" + it.id + ": " + it.student + (it.ok ? " (correct)" : " (wrong; correct: " + it.correct + ")"));
    });
    lines.push("", "Email:", p.writing);
    return lines.join("\n");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();

(function () {
  const cfg = window.MATH_CONFIG;
  const items = window.MATH_ITEMS || [];
  const form = document.getElementById("quiz");
  const errBox = document.getElementById("formError");
  const results = document.getElementById("results");
  const submitBtn = document.getElementById("submitBtn");
  const paperLink = document.getElementById("paperLink");
  if (paperLink && cfg.paperUrl) paperLink.href = cfg.paperUrl;

  const host = document.getElementById("items");
  host.innerHTML = items.map(function (it) {
    const name = "q" + it.id;
    const opts = ["A", "B", "C", "D"].map(function (L) {
      return '<label><input type="radio" name="' + name + '" value="' + L + '" /> ' + L + "</label>";
    }).join("");
    return (
      '<div class="q" data-q="' + it.id + '">' +
        '<p class="prompt"><span class="num">' + it.id + '.</span> ' +
        escapeHtml(it.topic) +
        '<span class="topic-tag">1 mark</span></p>' +
        '<p class="cite">Kedah 2025 Module, Mathematics Paper 1, Question ' + it.paperQ +
        " · page " + it.page + "</p>" +
        '<div class="options mcq">' + opts + "</div>" +
      "</div>"
    );
  }).join("");

  function unpackKey() {
    const bin = atob(cfg.packedKey);
    const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return JSON.parse(new TextDecoder().decode(bytes));
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

  function isCorrect(id, value, key) {
    return String(value || "").trim().toUpperCase() === String(key.a[id] || "").toUpperCase();
  }

  function collectAnswers() {
    const answers = {};
    items.forEach(function (it) {
      const el = form.querySelector('input[name="q' + it.id + '"]:checked');
      answers[it.id] = el ? el.value : "";
    });
    return answers;
  }

  function grade(answers, key) {
    const out = [];
    let score = 0;
    items.forEach(function (it) {
      const ok = isCorrect(it.id, answers[it.id], key);
      if (ok) score += 1;
      out.push({
        id: it.id,
        paperQ: it.paperQ,
        topic: it.topic,
        student: answers[it.id] || "(blank)",
        correct: key.d[it.id],
        ok: ok
      });
    });
    return { score: score, items: out };
  }

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
    const answers = collectAnswers();
    for (let i = 0; i < items.length; i++) {
      if (!answers[items[i].id]) {
        showError("Please answer question " + items[i].id + " (Paper 1 Question " + items[i].paperQ + ") before submitting.");
        return;
      }
    }

    const key = unpackKey();
    const g = grade(answers, key);
    const payload = {
      _id: "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      quiz: "spm-math",
      name: name,
      timeKL: nowKL(),
      timeISO: new Date().toISOString(),
      score: g.score,
      total: items.length,
      answers: answers,
      itemResults: g.items
    };

    submitBtn.disabled = true;
    const actions = form.querySelector(".actions");
    if (actions) actions.style.display = "none";
    Array.from(form.elements).forEach(function (el) { el.disabled = true; });

    renderResults(payload);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
    saveInBackground(payload);
  });

  function fetchWithTimeout(url, options, controller) {
    const opts = options || {};
    opts.signal = controller.signal;
    return fetch(url, opts);
  }

  async function saveKeepjson(payload, controller) {
    const k = cfg.keepjson;
    const get = await fetchWithTimeout(k.binUrl, { method: "GET" }, controller);
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
    }, controller);
    if (!put.ok) throw new Error("Save failed (" + put.status + ")");
  }

  async function saveWebhook(payload, controller) {
    const res = await fetchWithTimeout(cfg.webhook.postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, controller);
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
      setSaveStatus("ok", "Saved. Your teacher can see your score and answers. You can leave this page when you are ready.");
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
          "<div><b>" + escapeHtml(it.id) + ".</b> Paper 1 Q" + escapeHtml(String(it.paperQ)) +
          " · " + escapeHtml(it.topic) + "<br>Your answer: " + escapeHtml(it.student) +
          (it.ok ? "" : "<br>Correct answer: <b>" + escapeHtml(it.correct) + "</b>") +
          "</div>" +
        "</div>"
      );
    }).join("");

    results.hidden = false;
    results.innerHTML =
      '<div class="scorebox">' +
        '<div class="big">' + payload.score + " / " + payload.total + "</div>" +
        "<p>Mathematics diagnostic score for " + escapeHtml(payload.name) + "</p>" +
        "<p>Use the review below, and your workings in the paper, to see which topics to revise first.</p>" +
      "</div>" +
      '<div id="saveStatus" class="saving-msg">Saving your answers for your teacher…</div>' +
      "<h2>Question review</h2>" +
      rows;
    results.classList.add("show");
  }

  function buildSummary(p) {
    const lines = [
      "SPM Mathematics Diagnostic",
      "Name: " + p.name,
      "Time: " + p.timeKL,
      "Score: " + p.score + " / " + p.total,
      "",
      "Answers:"
    ];
    p.itemResults.forEach(function (it) {
      lines.push(
        it.id + " (Paper 1 Q" + it.paperQ + " " + it.topic + "): " +
        it.student + (it.ok ? " (correct)" : " (wrong; correct: " + it.correct + ")")
      );
    });
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

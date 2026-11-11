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

  form.addEventListener("submit", async function (e) {
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
    submitBtn.textContent = "Submitting…";
    let saved = false;
    let saveError = "";
    try {
      const res = await fetch(cfg.apiBase + "/" + cfg.resource, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Save failed (" + res.status + ")");
      saved = true;
    } catch (err) {
      saveError = err && err.message ? err.message : "Network error";
    }

    renderResults(payload, saved, saveError);
    form.querySelector(".actions").style.display = "none";
    Array.from(form.elements).forEach(function (el) { el.disabled = true; });
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function renderResults(payload, saved, saveError) {
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

    let saveBlock;
    const summary = buildSummary(payload);
    if (saved) {
      saveBlock = '<div class="ok-msg">Your grammar score and email have been sent to your teacher. You can leave this page when you are ready.</div>';
    } else {
      saveBlock =
        '<div class="warn-msg"><b>Your score is ready, but it could not be sent to your teacher automatically</b> (' +
        escapeHtml(saveError) +
        "). Please copy the summary below and send it to her." +
        '<div class="copy-box" id="copyBox"></div>' +
        '<button type="button" class="secondary" id="copyBtn">Copy summary</button></div>';
    }

    results.innerHTML =
      '<div class="scorebox">' +
        '<div class="big">' + payload.score + " / 24</div>" +
        "<p>Grammar score for " + escapeHtml(payload.name) + "</p>" +
        "<p>The short email is marked by your teacher and is not included in this score. Word count: " +
        payload.wordCount + ".</p>" +
      "</div>" +
      saveBlock +
      "<h2>Question review</h2>" +
      rows +
      "<h2>Your email</h2>" +
      '<div class="writing-view">' + escapeHtml(payload.writing) + "</div>";
    results.classList.add("show");

    const box = document.getElementById("copyBox");
    if (box) {
      box.textContent = summary;
      document.getElementById("copyBtn").addEventListener("click", function () {
        navigator.clipboard.writeText(summary).then(function () {
          document.getElementById("copyBtn").textContent = "Copied";
        });
      });
    }
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

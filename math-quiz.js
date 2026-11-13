(function () {
  const cfg = window.MATH_CONFIG;
  const items = window.MATH_ITEMS || [];
  const TOTAL = window.MATH_TOTAL_MARKS || 29;
  const form = document.getElementById("quiz");
  const errBox = document.getElementById("formError");
  const results = document.getElementById("results");
  const submitBtn = document.getElementById("submitBtn");

  function unpackKey() {
    const bin = atob(cfg.packedKey);
    const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function nowKL() {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    });
    return fmt.format(new Date()) + " (Asia/Kuala_Lumpur)";
  }

  function strip(s) {
    return String(s == null ? "" : s).trim();
  }

  function tight(s) {
    return strip(s).replace(/\s+/g, "").replace(/−/g, "-").replace(/–/g, "-");
  }

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }

  function parseNumber(s) {
    const t = tight(s).replace(/,/g, "");
    if (t === "" || t === "+" || t === "-" || t === ".") return null;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function parseFraction(s) {
    const t = tight(s);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) && t.indexOf("/") === -1) return null; // format must be a fraction
    const m = t.match(/^([+-]?\d+)\s*\/\s*([+-]?\d+)$/);
    if (!m) return null;
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (!b) return null;
    if (b < 0) { a = -a; b = -b; }
    const g = gcd(a, b);
    return [a / g, b / g];
  }

  function parseCoord(s) {
    const t = tight(s).replace(/^\(/, "").replace(/\)$/, "");
    const parts = t.split(",");
    if (parts.length !== 2) return null;
    const x = parseNumber(parts[0]), y = parseNumber(parts[1]);
    if (x == null || y == null) return null;
    return [x, y];
  }

  function parseSet(s) {
    let t = tight(s);
    t = t.replace(/^\{/, "").replace(/\}$/, "");
    if (!t) return null;
    const parts = t.split(",");
    const nums = [];
    for (let i = 0; i < parts.length; i++) {
      const n = parseNumber(parts[i]);
      if (n == null || !Number.isInteger(n)) return null;
      nums.push(n);
    }
    return nums;
  }

  function normIneq(s) {
    let t = tight(s).toLowerCase();
    t = t.replace(/≤|≦|=</g, "<=").replace(/≥|≧|=>/g, ">=");
    t = t.replace(/\*/g, "");
    return t;
  }

  function ineqOk(value, spec) {
    const got = normIneq(value);
    const opts = [spec.value].concat(spec.alts || []).map(normIneq);
    return opts.indexOf(got) !== -1;
  }

  function axisOk(value, spec) {
    const t = tight(value).toLowerCase().replace(/ /g, "");
    const m = t.match(/^x=(.+)$/);
    if (!m) return false;
    const n = parseNumber(m[1]);
    const exp = parseNumber(String(spec.value).replace(/^x=/i, ""));
    return n != null && exp != null && n === exp;
  }

  function nearEq(a, b) {
    return Math.abs(a - b) < 1e-9;
  }

  function isCorrect(id, value, keyObj) {
    const spec = keyObj.k[id];
    if (!spec) return false;
    const raw = strip(value);
    if (!raw) return false;
    const typ = spec.type;
    if (typ === "integer" || typ === "money") {
      const n = parseNumber(raw);
      const exp = Number(spec.value);
      return n != null && nearEq(n, exp);
    }
    if (typ === "decimal2") {
      const t = tight(raw).replace(/,/g, "");
      // require a decimal point and exactly 2 digits after it (optional trailing zeros already exactly 2)
      if (!/^[+-]?\d+\.\d{2}$/.test(t)) return false;
      const n = Number(t);
      return Number.isFinite(n) && nearEq(n, Number(spec.value));
    }
    if (typ === "fraction") {
      const t = tight(raw);
      const m = t.match(/^([+-]?\d+)\s*\/\s*([+-]?\d+)$/);
      if (!m) return false;
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (!b) return false;
      if (b < 0) { a = -a; b = -b; }
      const g = gcd(a, b);
      if (g !== 1) return false; // not in simplest form
      const exp = parseFraction(spec.value);
      return !!exp && a === exp[0] && b === exp[1];
    }
    if (typ === "coord") {
      const got = parseCoord(raw);
      const exp = parseCoord(spec.value);
      return got && exp && nearEq(got[0], exp[0]) && nearEq(got[1], exp[1]);
    }
    if (typ === "set") {
      const got = parseSet(raw);
      const exp = parseSet(spec.value);
      if (!got || !exp || got.length !== exp.length) return false;
      for (let i = 0; i < exp.length; i++) if (got[i] !== exp[i]) return false; // must be ascending as listed
      return true;
    }
    if (typ === "inequality") return ineqOk(raw, spec);
    if (typ === "axis") return axisOk(raw, spec);
    return tight(raw).toLowerCase() === tight(spec.value).toLowerCase();
  }

  function collectAnswers() {
    const answers = {};
    items.forEach(function (it) {
      const el = form.elements["q" + it.id];
      answers[it.id] = el ? strip(el.value) : "";
    });
    return answers;
  }

  function grade(answers, keyObj) {
    const out = [];
    let score = 0;
    items.forEach(function (it) {
      const ok = isCorrect(it.id, answers[it.id], keyObj);
      if (ok) score += it.marks;
      out.push({
        id: it.id,
        q: it.q,
        part: it.part,
        topic: it.topic,
        marks: it.marks,
        student: answers[it.id] || "(blank)",
        correct: keyObj.d[it.id],
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
    const name = strip(form.studentName.value);
    if (!name) { showError("Please type your name."); return; }
    const answers = collectAnswers();
    for (let i = 0; i < items.length; i++) {
      if (!answers[items[i].id]) {
        showError("Please answer Question " + items[i].q + " " + items[i].part + " before submitting.");
        return;
      }
    }
    const keyObj = unpackKey();
    const g = grade(answers, keyObj);
    const payload = {
      _id: "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      quiz: "spm-math-p2",
      name: name,
      timeKL: nowKL(),
      timeISO: new Date().toISOString(),
      score: g.score,
      total: TOTAL,
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
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + k.writeKey },
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
    } finally { clearTimeout(timer); }
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

  function topicSummary(itemResults) {
    const map = {};
    itemResults.forEach(function (it) {
      if (!map[it.topic]) map[it.topic] = { got: 0, max: 0 };
      map[it.topic].max += it.marks;
      if (it.ok) map[it.topic].got += it.marks;
    });
    return map;
  }

  function renderResults(payload) {
    const rows = payload.itemResults.map(function (it) {
      return (
        '<div class="item-result">' +
          '<span class="badge ' + (it.ok ? "ok" : "no") + '">' + (it.ok ? "Correct" : "Wrong") + "</span>" +
          "<div><b>Q" + it.q + " " + escapeHtml(it.part) + "</b> · " + escapeHtml(it.topic) +
          " (" + it.marks + " mark" + (it.marks === 1 ? "" : "s") + ")<br>Your answer: " +
          escapeHtml(it.student) +
          (it.ok ? "" : "<br>Correct answer: <b>" + escapeHtml(it.correct) + "</b>") +
          "</div></div>"
      );
    }).join("");
    const ts = topicSummary(payload.itemResults);
    const trows = Object.keys(ts).map(function (t) {
      const r = ts[t];
      return "<tr><td>" + escapeHtml(t) + "</td><td>" + r.got + " / " + r.max + "</td></tr>";
    }).join("");
    results.hidden = false;
    results.innerHTML =
      '<div class="scorebox">' +
        '<div class="big">' + payload.score + " / " + payload.total + "</div>" +
        "<p>Mathematics Paper 2 diagnostic score for " + escapeHtml(payload.name) + "</p>" +
      "</div>" +
      '<div id="saveStatus" class="saving-msg">Saving your answers for your teacher…</div>' +
      "<h2>Score by topic</h2>" +
      '<table class="checklist"><thead><tr><th>Topic</th><th>Marks</th></tr></thead><tbody>' + trows + "</tbody></table>" +
      "<h2>Question review</h2>" + rows;
    results.classList.add("show");
  }

  function buildSummary(p) {
    const lines = [
      "SPM Mathematics Paper 2 Diagnostic",
      "Name: " + p.name,
      "Time: " + p.timeKL,
      "Score: " + p.score + " / " + p.total,
      "",
      "Answers:"
    ];
    p.itemResults.forEach(function (it) {
      lines.push("Q" + it.q + " " + it.part + ": " + it.student + (it.ok ? " (correct)" : " (wrong; correct: " + it.correct + ")"));
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

  // expose matcher for a tiny self-test hook if needed
  window.__mathMark = { isCorrect: isCorrect, unpackKey: unpackKey };
})();

(function () {
  const cfg = window.QUIZ_CONFIG;
  const gate = document.getElementById("gate");
  const panel = document.getElementById("panel");
  const list = document.getElementById("list");
  const loadErr = document.getElementById("loadErr");
  let cache = [];

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  async function unlock() {
    const entered = document.getElementById("pass").value || "";
    const hash = await sha256(entered);
    const err = document.getElementById("gateErr");
    if (hash !== cfg.passHash) {
      err.classList.add("show");
      return;
    }
    err.classList.remove("show");
    sessionStorage.setItem("f4quiz_ok", "1");
    gate.style.display = "none";
    panel.style.display = "block";
    await load();
  }

  document.getElementById("unlockBtn").addEventListener("click", unlock);
  document.getElementById("pass").addEventListener("keydown", function (e) {
    if (e.key === "Enter") unlock();
  });
  if (sessionStorage.getItem("f4quiz_ok") === "1") {
    gate.style.display = "none";
    panel.style.display = "block";
    load();
  }

  async function load() {
    loadErr.classList.remove("show");
    list.innerHTML = "<p class='empty'>Loading…</p>";
    try {
      const res = await fetch(cfg.apiBase + "/" + cfg.resource);
      if (!res.ok) throw new Error("Could not load submissions (" + res.status + "). The store may have expired.");
      const data = await res.json();
      cache = Array.isArray(data) ? data.slice() : [];
      cache.sort(function (a, b) {
        return String(b.timeISO || "").localeCompare(String(a.timeISO || ""));
      });
      render();
    } catch (e) {
      list.innerHTML = "";
      loadErr.textContent = e.message || "Could not load submissions.";
      loadErr.classList.add("show");
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    if (!cache.length) {
      list.innerHTML = "<p class='empty'>No submissions yet.</p>";
      return;
    }
    list.innerHTML = cache.map(function (row, idx) {
      const items = (row.itemResults || []).map(function (it) {
        return (
          '<div class="item-result">' +
            '<span class="badge ' + (it.ok ? "ok" : "no") + '">' + (it.ok ? "Correct" : "Wrong") + "</span>" +
            "<div><b>Q" + escapeHtml(it.id) + ".</b> " + escapeHtml(it.student) +
            (it.ok ? "" : " &nbsp;→&nbsp; <b>" + escapeHtml(it.correct) + "</b>") +
            "</div></div>"
        );
      }).join("");
      return (
        '<article class="card sub-card" data-id="' + escapeHtml(row._id || "") + '">' +
          '<div class="sub-head">' +
            "<h2>" + escapeHtml(row.name || "Unnamed") + "</h2>" +
            "<div><b>" + escapeHtml(row.score) + " / " + escapeHtml(row.total || 24) + "</b> grammar</div>" +
          "</div>" +
          '<p class="meta">' + escapeHtml(row.timeKL || row.timeISO || "") +
            " · Email word count: " + escapeHtml(row.wordCount) +
          "</p>" +
          "<h3>Answers</h3>" + items +
          "<h3>Email (mark /10 yourself)</h3>" +
          '<div class="writing-view">' + escapeHtml(row.writing || "") + "</div>" +
          '<div class="toolbar" style="margin-top:0.8rem;">' +
            '<button type="button" class="secondary del" data-idx="' + idx + '">Delete this entry</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");

    Array.from(list.querySelectorAll(".del")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        const row = cache[Number(btn.getAttribute("data-idx"))];
        if (!row || !row._id) return;
        if (!confirm("Delete the submission from " + (row.name || "this student") + "?")) return;
        deleteEntry(row._id);
      });
    });
  }

  async function deleteEntry(id) {
    try {
      const res = await fetch(cfg.apiBase + "/" + cfg.resource + "/" + id, { method: "DELETE" });
      if (!res.ok && res.status !== 200 && res.status !== 204) throw new Error("Delete failed");
      await load();
    } catch (e) {
      alert("Could not delete: " + (e.message || "error"));
    }
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.getElementById("refreshBtn").addEventListener("click", load);
  document.getElementById("exportJsonBtn").addEventListener("click", function () {
    const clean = cache.map(function (r) {
      const c = Object.assign({}, r);
      return c;
    });
    download("form4-quiz-results.json", JSON.stringify(clean, null, 2), "application/json");
  });
  document.getElementById("exportCsvBtn").addEventListener("click", function () {
    const headers = ["name","timeKL","score","total","wordCount","writing"];
    for (let i = 1; i <= 24; i++) headers.push("q" + i);
    const lines = [headers.join(",")];
    cache.forEach(function (r) {
      const ans = r.answers || {};
      const cols = [
        csv(r.name), csv(r.timeKL), csv(r.score), csv(r.total), csv(r.wordCount), csv(r.writing)
      ];
      for (let i = 1; i <= 24; i++) cols.push(csv(ans[String(i)]));
      lines.push(cols.join(","));
    });
    download("form4-quiz-results.csv", lines.join("\n"), "text/csv");
  });

  function csv(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
})();

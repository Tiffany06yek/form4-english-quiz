(function () {
  const cfg = window.MATH_CONFIG;
  const items = window.MATH_ITEMS || [];
  const gate = document.getElementById("gate");
  const panel = document.getElementById("panel");
  const list = document.getElementById("list");
  const loadErr = document.getElementById("loadErr");
  const inbox = document.getElementById("backupInboxLink");
  if (inbox && cfg.webhook && cfg.webhook.inboxUrl) inbox.href = cfg.webhook.inboxUrl;
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
    sessionStorage.setItem("f5math_ok", "1");
    gate.style.display = "none";
    panel.style.display = "block";
    await load();
  }

  document.getElementById("unlockBtn").addEventListener("click", unlock);
  document.getElementById("pass").addEventListener("keydown", function (e) {
    if (e.key === "Enter") unlock();
  });
  if (sessionStorage.getItem("f5math_ok") === "1") {
    gate.style.display = "none";
    panel.style.display = "block";
    load();
  }

  function expiredNote() {
    const exp = cfg.keepjson && cfg.keepjson.expiresAt;
    if (!exp) return "";
    const t = new Date(exp);
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    return " The fast list expired at " + fmt.format(t) + " (Asia/Kuala_Lumpur).";
  }

  async function readBin() {
    const res = await fetch(cfg.keepjson.binUrl);
    if (!res.ok) throw new Error("Could not load submissions (" + res.status + "). The store may have expired.");
    const data = await res.json();
    return (data && Array.isArray(data.submissions)) ? data.submissions.slice() : [];
  }

  async function writeBin(submissions) {
    const res = await fetch(cfg.keepjson.binUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg.keepjson.writeKey
      },
      body: JSON.stringify({ submissions: submissions })
    });
    if (!res.ok) throw new Error("Update failed (" + res.status + ")");
  }

  async function load() {
    loadErr.classList.remove("show");
    list.innerHTML = "<p class='empty'>Loading…</p>";
    try {
      cache = await readBin();
      cache.sort(function (a, b) {
        return String(b.timeISO || "").localeCompare(String(a.timeISO || ""));
      });
      render();
    } catch (e) {
      list.innerHTML = "";
      loadErr.innerHTML = escapeHtml(e.message || "Could not load submissions.") +
        expiredNote() +
        (cfg.webhook && cfg.webhook.inboxUrl
          ? ' Open the <a href="' + escapeHtml(cfg.webhook.inboxUrl) + '" target="_blank" rel="noopener">backup inbox</a> (kept until about 12:56 pm, 20 Nov 2026, Asia/Kuala_Lumpur).'
          : "");
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

  function topicSummary(row) {
    const wr = (row.itemResults || []).filter(function (it) { return !it.ok; });
    if (!wr.length) return '<p class="meta">All topics correct.</p>';
    return '<p class="meta"><b>Topics to review:</b> ' +
      wr.map(function (it) {
        return escapeHtml(it.topic) + " (P1 Q" + escapeHtml(String(it.paperQ)) + ")";
      }).join("; ") + "</p>";
  }

  function render() {
    if (!cache.length) {
      list.innerHTML = "<p class='empty'>No submissions yet.</p>";
      return;
    }
    list.innerHTML = cache.map(function (row, idx) {
      const itemHtml = (row.itemResults || []).map(function (it) {
        return (
          '<div class="item-result">' +
            '<span class="badge ' + (it.ok ? "ok" : "no") + '">' + (it.ok ? "Correct" : "Wrong") + "</span>" +
            "<div><b>" + escapeHtml(it.id) + ".</b> Paper 1 Q" + escapeHtml(String(it.paperQ)) +
            " · " + escapeHtml(it.topic || "") + "<br>" +
            escapeHtml(it.student) +
            (it.ok ? "" : " &nbsp;→&nbsp; <b>" + escapeHtml(it.correct) + "</b>") +
            "</div></div>"
        );
      }).join("");
      return (
        '<article class="card sub-card">' +
          '<div class="sub-head">' +
            "<h2>" + escapeHtml(row.name || "Unnamed") + "</h2>" +
            "<div><b>" + escapeHtml(row.score) + " / " + escapeHtml(row.total || items.length) + "</b></div>" +
          "</div>" +
          '<p class="meta">' + escapeHtml(row.timeKL || row.timeISO || "") + "</p>" +
          topicSummary(row) +
          "<h3>Answers</h3>" + itemHtml +
          '<div class="toolbar" style="margin-top:0.8rem;">' +
            '<button type="button" class="secondary del" data-idx="' + idx + '">Delete this entry</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");

    Array.from(list.querySelectorAll(".del")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        const row = cache[Number(btn.getAttribute("data-idx"))];
        if (!row) return;
        if (!confirm("Delete the submission from " + (row.name || "this student") + "?")) return;
        deleteEntry(row);
      });
    });
  }

  async function deleteEntry(row) {
    try {
      const current = await readBin();
      const next = current.filter(function (item) {
        if (row._id && item._id) return item._id !== row._id;
        return !(item.name === row.name && item.timeISO === row.timeISO);
      });
      await writeBin(next);
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
    download("spm-math-results.json", JSON.stringify(cache, null, 2), "application/json");
  });
  document.getElementById("exportCsvBtn").addEventListener("click", function () {
    const headers = ["name", "timeKL", "score", "total"];
    items.forEach(function (it) { headers.push("item" + it.id + "_P1Q" + it.paperQ); });
    const lines = [headers.join(",")];
    cache.forEach(function (r) {
      const ans = r.answers || {};
      const cols = [csv(r.name), csv(r.timeKL), csv(r.score), csv(r.total)];
      items.forEach(function (it) { cols.push(csv(ans[it.id])); });
      lines.push(cols.join(","));
    });
    download("spm-math-results.csv", lines.join("\n"), "text/csv");
  });

  function csv(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
})();

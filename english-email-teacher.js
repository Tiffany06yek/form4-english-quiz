(function () {
  const cfg = window.EMAIL_CONFIG;
  const gate = document.getElementById("gate");
  const panel = document.getElementById("panel");
  const list = document.getElementById("list");
  const loadErr = document.getElementById("loadErr");
  const inbox = document.getElementById("backupInboxLink");
  if (inbox && cfg.webhook && cfg.webhook.inboxUrl) inbox.href = cfg.webhook.inboxUrl;
  let cache = [];

  function formatKL(iso) {
    if (!iso) return "";
    const t = new Date(iso);
    if (isNaN(t.getTime())) return "";
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    return fmt.format(t) + " (Asia/Kuala_Lumpur)";
  }

  (function fillExpiryNote() {
    const el = document.getElementById("introNote");
    if (!el) return;
    const main = formatKL(cfg.store && cfg.store.expiresAt);
    const backup = formatKL(cfg.webhook && cfg.webhook.expiresAt);
    el.textContent =
      "Newest first. There is no auto-score for this writing task — record a mark /10 yourself. Please export a JSON or CSV copy after class. The main results list is kept until about " +
      (main || "30 days after the last save") +
      ". Each new submission or saved mark moves that date forward by 30 days. A backup inbox is also linked below" +
      (backup ? " (kept until about " + backup + ")" : " (kept for about 7 days)") +
      ".";
  })();

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

  function storeGetUrl() {
    return cfg.store.binUrl + (cfg.store.binUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
  }

  async function readBin() {
    const res = await fetch(storeGetUrl());
    if (!res.ok) throw new Error("Could not load submissions (" + res.status + "). The store may have expired.");
    const data = await res.json();
    return (data && Array.isArray(data.submissions)) ? data.submissions.slice() : [];
  }

  async function writeBin(submissions) {
    const headers = { "Content-Type": "application/json" };
    headers[cfg.store.writeHeader || "X-Bin-Key"] = cfg.store.writeKey;
    const res = await fetch(cfg.store.binUrl, {
      method: "PUT",
      headers: headers,
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
        (cfg.webhook && cfg.webhook.inboxUrl
          ? ' You can also open the <a href="' + escapeHtml(cfg.webhook.inboxUrl) + '" target="_blank" rel="noopener">backup inbox</a> (kept for about 7 days).'
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

  function render() {
    if (!cache.length) {
      list.innerHTML = "<p class='empty'>No submissions yet.</p>";
      return;
    }
    list.innerHTML = cache.map(function (row, idx) {
      const mark = row.teacherMark == null ? "" : String(row.teacherMark);
      return (
        '<article class="card sub-card">' +
          '<div class="sub-head">' +
            "<h2>" + escapeHtml(row.name || "Unnamed") + "</h2>" +
            "<div>" + (mark === "" ? "Not marked yet" : "<b>" + escapeHtml(mark) + " / 10</b>") + "</div>" +
          "</div>" +
          '<p class="meta">' + escapeHtml(row.timeKL || row.timeISO || "") +
            " · Word count: " + escapeHtml(row.wordCount) +
          "</p>" +
          "<h3>Email</h3>" +
          '<div class="writing-view">' + escapeHtml(row.writing || "") + "</div>" +
          '<div class="mark-row">' +
            '<label for="mark-' + idx + '">Mark /10</label>' +
            '<input type="number" id="mark-' + idx + '" min="0" max="10" step="0.5" value="' + escapeHtml(mark) + '" />' +
            '<button type="button" class="secondary save-mark" data-idx="' + idx + '">Save mark</button>' +
            '<span class="mark-status" id="markStatus-' + idx + '"></span>' +
          "</div>" +
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
    Array.from(list.querySelectorAll(".save-mark")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-idx"));
        const row = cache[idx];
        if (!row) return;
        const input = document.getElementById("mark-" + idx);
        saveMark(row, input ? input.value : "", idx);
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

  async function saveMark(row, value, idx) {
    const status = document.getElementById("markStatus-" + idx);
    const trimmed = String(value == null ? "" : value).trim();
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || n > 10) {
        if (status) {
          status.className = "mark-status";
          status.textContent = "Please enter a mark from 0 to 10.";
        }
        return;
      }
    }
    try {
      if (status) {
        status.className = "mark-status";
        status.textContent = "Saving…";
      }
      const current = await readBin();
      let found = false;
      const next = current.map(function (item) {
        const same = (row._id && item._id) ? item._id === row._id : (item.name === row.name && item.timeISO === row.timeISO);
        if (!same) return item;
        found = true;
        const copy = Object.assign({}, item);
        copy.teacherMark = trimmed;
        copy.teacherMarkTimeISO = new Date().toISOString();
        return copy;
      });
      if (!found) {
        throw new Error("That submission is no longer in the list. Refresh and try again.");
      }
      await writeBin(next);
      await load();
    } catch (e) {
      if (status) {
        status.className = "mark-status";
        status.textContent = "Could not save: " + (e.message || "error");
      } else {
        alert("Could not save mark: " + (e.message || "error"));
      }
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
    download("form4-email-results.json", JSON.stringify(cache, null, 2), "application/json");
  });
  document.getElementById("exportCsvBtn").addEventListener("click", function () {
    const headers = ["name","timeKL","wordCount","teacherMark","writing"];
    const lines = [headers.join(",")];
    cache.forEach(function (r) {
      lines.push([csv(r.name), csv(r.timeKL), csv(r.wordCount), csv(r.teacherMark), csv(r.writing)].join(","));
    });
    download("form4-email-results.csv", lines.join("\n"), "text/csv");
  });

  function csv(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
})();

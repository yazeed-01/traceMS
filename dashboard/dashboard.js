(function () {
  const JAEGER_BASE = "http://localhost:16686";
  const PAYLOAD_TYPES = ["any", "text", "json", "image", "video", "binary"];
  const STATIONS_PER_ROW = 5;
  let STATION_ORDER = ["gateway"];
  let currentServices = [];
  let currentTrainIndex = -1;

  const form = document.getElementById("process-form");
  const textArea = document.getElementById("text");
  const fileInput = document.getElementById("file");
  const inputTextArea = document.getElementById("input-text-area");
  const inputFileArea = document.getElementById("input-file-area");
  const fileHint = document.getElementById("file-hint");
  const submitBtn = document.getElementById("submit-btn");
  const processError = document.getElementById("process-error");
  const traceInfo = document.getElementById("trace-info");
  const traceIdEl = document.getElementById("trace-id");
  const jaegerLink = document.getElementById("jaeger-link");
  const train = document.getElementById("train");
  const track = document.getElementById("track");
  const railPath = document.getElementById("rail-path");
  const railSvg = document.getElementById("rail-svg");
  const stations = document.getElementById("stations");
  const stationsLoading = document.getElementById("stations-loading");
  const resultSection = document.getElementById("result-section");
  const resultBody = document.getElementById("result-body");
  const expandBtn = document.getElementById("expand-btn");
  const expandOverlay = document.getElementById("expand-overlay");
  const expandBoard = document.getElementById("expand-board");
  const expandViewport = document.getElementById("expand-viewport");
  const expandTrack = document.getElementById("expand-track");
  const expandStations = document.getElementById("expand-stations");
  const expandTrain = document.getElementById("expand-train");
  const expandRailPath = document.getElementById("expand-rail-path");
  const expandCloseBtn = document.getElementById("expand-close-btn");
  const configToggle = document.getElementById("config-toggle");
  const configPanel = document.getElementById("config-panel");
  const configError = document.getElementById("config-error");
  const configSuccess = document.getElementById("config-success");
  const addServiceBtn = document.getElementById("add-service-btn");
  const savePipelineBtn = document.getElementById("save-pipeline-btn");
  const servicesEditor = document.getElementById("services-editor");

  configToggle.addEventListener("click", function () {
    var open = configPanel.hidden;
    configPanel.hidden = !open;
    configToggle.parentElement.classList.toggle("open", open);
    if (open) renderServicesEditor();
  });

  function renderServicesEditor() {
    servicesEditor.innerHTML = "";
    currentServices.forEach(function (s, i) {
      var row = document.createElement("div");
      row.className = "service-row";
      var inputOpts = PAYLOAD_TYPES.map(function (t) {
        return "<option value=\"" + t + "\"" + (s.input_type === t ? " selected" : "") + ">" + t + "</option>";
      }).join("");
      var outputOpts = PAYLOAD_TYPES.map(function (t) {
        return "<option value=\"" + t + "\"" + (s.output_type === t ? " selected" : "") + ">" + t + "</option>";
      }).join("");
      row.innerHTML =
        "<label class=\"field-name\">Name<input type=\"text\" data-field=\"name\" value=\"" + escapeAttr(s.name) + "\" placeholder=\"e.g. validator\"></label>" +
        "<label class=\"field-url\">URL<input type=\"text\" data-field=\"url\" value=\"" + escapeAttr(s.url) + "\" placeholder=\"http://localhost:8001\"></label>" +
        "<label class=\"field-icon\">Icon<input type=\"text\" data-field=\"icon\" value=\"" + escapeAttr(s.icon || "•") + "\" placeholder=\"•\"></label>" +
        "<label class=\"field-desc\">Description<input type=\"text\" data-field=\"description\" value=\"" + escapeAttr(s.description || "") + "\" placeholder=\"Optional\"></label>" +
        "<label class=\"field-input-type\">Input type<select data-field=\"input_type\">" + inputOpts + "</select></label>" +
        "<label class=\"field-output-type\">Output type<select data-field=\"output_type\">" + outputOpts + "</select></label>" +
        "<div class=\"row-actions\">" +
        "<button type=\"button\" class=\"move-up\" title=\"Move up\">↑</button>" +
        "<button type=\"button\" class=\"move-down\" title=\"Move down\">↓</button>" +
        "<button type=\"button\" class=\"remove\" title=\"Remove\">✕</button>" +
        "</div>";
      row.querySelector(".move-up").addEventListener("click", function () { moveRow(i, -1); });
      row.querySelector(".move-down").addEventListener("click", function () { moveRow(i, 1); });
      row.querySelector(".remove").addEventListener("click", function () { removeRow(i); });
      servicesEditor.appendChild(row);
    });
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function getServicesFromEditor() {
    var rows = servicesEditor.querySelectorAll(".service-row");
    var out = [];
    rows.forEach(function (row) {
      var name = (row.querySelector('[data-field="name"]') || {}).value;
      var url = (row.querySelector('[data-field="url"]') || {}).value;
      if (!name) return;
      out.push({
        name: name.trim(),
        url: url.trim(),
        icon: (row.querySelector('[data-field="icon"]') || {}).value.trim() || "•",
        description: (row.querySelector('[data-field="description"]') || {}).value.trim() || "",
        input_type: (row.querySelector('[data-field="input_type"]') || {}).value || "",
        output_type: (row.querySelector('[data-field="output_type"]') || {}).value || ""
      });
    });
    return out;
  }

  function moveRow(index, delta) {
    var newIndex = index + delta;
    if (newIndex < 0 || newIndex >= currentServices.length) return;
    var tmp = currentServices[index];
    currentServices[index] = currentServices[newIndex];
    currentServices[newIndex] = tmp;
    renderServicesEditor();
  }

  function removeRow(index) {
    currentServices.splice(index, 1);
    renderServicesEditor();
  }

  addServiceBtn.addEventListener("click", function () {
    currentServices.push({
      name: "",
      url: "",
      icon: "•",
      description: "",
      input_type: "any",
      output_type: "any"
    });
    renderServicesEditor();
  });

  savePipelineBtn.addEventListener("click", function () {
    configError.hidden = true;
    configSuccess.hidden = true;
    var list = getServicesFromEditor();
    if (list.length === 0) {
      configError.textContent = "Add at least one microservice (name and URL required).";
      configError.hidden = false;
      return;
    }
    var hasEmptyName = list.some(function (s) { return !s.name.trim(); });
    var hasEmptyUrl = list.some(function (s) { return !s.url.trim(); });
    if (hasEmptyName || hasEmptyUrl) {
      configError.textContent = "Every service must have a name and URL.";
      configError.hidden = false;
      return;
    }
    fetch("/api/pipeline", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        services: list.map(function (s) {
          return {
            name: s.name,
            url: s.url,
            icon: s.icon,
            description: s.description,
            input_type: s.input_type || null,
            output_type: s.output_type || null
          };
        })
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          configSuccess.textContent = "Pipeline saved." + (data.saved ? " Config persisted to file." : " (In-memory only; set WRITABLE_PIPELINE_PATH to persist.)");
          configSuccess.hidden = false;
          currentServices = list;
          refetchPipelineAndBuildStations();
        } else {
          configError.textContent = data.detail || "Save failed";
          configError.hidden = false;
        }
      })
      .catch(function (err) {
        configError.textContent = err.message || "Request failed";
        configError.hidden = false;
      });
  });

  function refetchPipelineAndBuildStations() {
    fetch("/api/pipeline")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = (data && data.services) ? data.services : [];
        currentServices = list;
        if (configPanel && !configPanel.hidden) renderServicesEditor();
        buildStations(list);
      });
  }

  function showInputArea() {
    var type = (form.querySelector('input[name="inputType"]:checked') || {}).value || "text";
    if (type === "text" || type === "json") {
      inputTextArea.hidden = false;
      inputFileArea.hidden = true;
      textArea.placeholder = type === "json" ? 'e.g. {"key": "value"}' : "e.g. hello world";
    } else {
      inputTextArea.hidden = true;
      inputFileArea.hidden = false;
      fileInput.accept = type === "image" ? "image/*" : type === "video" ? "video/*" : "*";
      fileHint.textContent = type === "image" ? "Image (any)" : type === "video" ? "Video (any)" : "Any file";
    }
  }
  form.querySelectorAll('input[name="inputType"]').forEach(function (r) {
    r.addEventListener("change", showInputArea);
  });
  showInputArea();

  function setStationState(service, state) {
    const el = stations.querySelector('[data-service="' + service + '"]');
    if (!el) return;
    el.classList.remove("current", "done", "error");
    const statusEl = el.querySelector('[data-detail="status"]');
    const inputEl = el.querySelector('[data-detail="input"]');
    const outputEl = el.querySelector('[data-detail="output"]');
    if (state === "processing") {
      el.classList.add("current");
      if (statusEl) { statusEl.textContent = "Processing…"; statusEl.classList.add("processing"); statusEl.classList.remove("ok"); }
      if (inputEl) { inputEl.textContent = "—"; inputEl.innerHTML = ""; inputEl.classList.remove("payload-preview"); }
      if (outputEl) { outputEl.textContent = "—"; outputEl.innerHTML = ""; outputEl.classList.remove("payload-preview"); }
    } else if (state === "done" || state === "ok") {
      el.classList.add("done");
      if (statusEl) { statusEl.textContent = "OK"; statusEl.classList.remove("processing"); statusEl.classList.add("ok"); }
    } else if (state === "error") {
      el.classList.add("error");
      if (statusEl) { statusEl.textContent = "Error"; statusEl.classList.remove("processing"); }
    } else {
      if (statusEl) { statusEl.textContent = "—"; statusEl.classList.remove("processing", "ok"); }
      if (inputEl) { inputEl.textContent = "—"; inputEl.innerHTML = ""; inputEl.classList.remove("payload-preview"); }
      if (outputEl) { outputEl.textContent = "—"; outputEl.innerHTML = ""; outputEl.classList.remove("payload-preview"); }
    }
    if (expandOverlay && !expandOverlay.hidden) syncExpandStationStates();
  }

  function renderPayloadPreview(container, value, payloadType) {
    if (value == null || value === "") {
      container.textContent = "—";
      container.classList.remove("payload-preview");
      return;
    }
    container.classList.add("payload-preview");
    var str = typeof value === "string" ? value : JSON.stringify(value);
    if (payloadType === "image" && str.match(/^[A-Za-z0-9+/=]+$/)) {
      container.innerHTML = "";
      var img = document.createElement("img");
      img.src = "data:image/png;base64," + str;
      img.alt = "output";
      img.style.maxWidth = "100%";
      img.style.maxHeight = "80px";
      img.style.borderRadius = "4px";
      container.appendChild(img);
      return;
    }
    if (payloadType === "video" && str.match(/^[A-Za-z0-9+/=]+$/)) {
      container.innerHTML = "";
      var vid = document.createElement("video");
      vid.src = "data:video/mp4;base64," + str;
      vid.controls = true;
      vid.style.maxWidth = "100%";
      vid.style.maxHeight = "80px";
      container.appendChild(vid);
      return;
    }
    if (payloadType === "json") {
      try {
        var parsed = JSON.parse(str);
        container.textContent = JSON.stringify(parsed).slice(0, 120) + (JSON.stringify(parsed).length > 120 ? "…" : "");
      } catch (e) {
        container.textContent = str.slice(0, 80) + (str.length > 80 ? "…" : "");
      }
      return;
    }
    if (payloadType === "binary" || payloadType === "video" || payloadType === "image") {
      if (str.length > 60) str = "[" + payloadType + "] " + str.length + " chars";
      else str = "[" + payloadType + "]";
    } else {
      str = str.slice(0, 80) + (str.length > 80 ? "…" : "");
    }
    container.textContent = str;
  }

  function setStationData(service, input, output, payloadType) {
    const el = stations.querySelector('[data-service="' + service + '"]');
    if (!el) return;
    const inputEl = el.querySelector('[data-detail="input"]');
    const outputEl = el.querySelector('[data-detail="output"]');
    payloadType = payloadType || "text";
    if (inputEl) renderPayloadPreview(inputEl, input, payloadType);
    if (outputEl) renderPayloadPreview(outputEl, output, payloadType);
    if (expandOverlay && !expandOverlay.hidden) syncExpandStationStates();
  }

  function getGridPosition(index) {
    var n = STATION_ORDER.length;
    var numRows = n ? Math.ceil(n / STATIONS_PER_ROW) : 1;
    if (index < 0) return { col: 0, row: 0, numRows: numRows };
    var row = Math.floor(index / STATIONS_PER_ROW);
    var col = index % STATIONS_PER_ROW;
    if (index >= n) {
      row = numRows - 1;
      col = (n - 1) % STATIONS_PER_ROW;
    }
    return { col: col, row: row, numRows: numRows };
  }

  function drawRailPath() {
    if (!railPath || !STATION_ORDER.length) return;
    var n = STATION_ORDER.length;
    var numRows = Math.ceil(n / STATIONS_PER_ROW);
    var pts = [];
    for (var r = 0; r < numRows; r++) {
      var count = Math.min(STATIONS_PER_ROW, n - r * STATIONS_PER_ROW);
      var cols = [];
      for (var c = 0; c < count; c++) cols.push(c);
      if (r % 2 === 1) cols.reverse();
      var y = (r + 0.5) / numRows * 100;
      for (var i = 0; i < cols.length; i++) {
        var x = (cols[i] + 0.5) / STATIONS_PER_ROW * 100;
        pts.push(x + " " + y);
      }
      if (r < numRows - 1) {
        var lastX = (cols[cols.length - 1] + 0.5) / STATIONS_PER_ROW * 100;
        var nextY = (r + 1.5) / numRows * 100;
        pts.push(lastX + " " + nextY);
      }
    }
    railPath.setAttribute("d", "M " + pts.join(" L "));
    railSvg.setAttribute("viewBox", "0 0 100 100");
    railSvg.setAttribute("preserveAspectRatio", "none");
  }

  function moveTrain(index) {
    currentTrainIndex = index;
    if (!train) return;
    var n = STATION_ORDER.length;
    if (index < 0) {
      train.classList.remove("visible");
      train.style.left = "";
      train.style.top = "";
      if (expandTrain) expandTrain.classList.remove("visible");
      return;
    }
    train.classList.add("visible");
    var pos = getGridPosition(index);
    var leftPct = (pos.col + 0.5) / STATIONS_PER_ROW * 100;
    var topPct = (pos.row + 0.5) / pos.numRows * 100;
    train.style.left = "calc(" + leftPct + "% - 14px)";
    train.style.top = "calc(" + topPct + "% - 14px)";
    if (expandOverlay && !expandOverlay.hidden) moveExpandTrain(index);
  }

  function resetStations() {
    STATION_ORDER.forEach(function (s) {
      setStationState(s, "");
      setStationData(s, "", "", "text");
    });
    moveTrain(-1);
    traceInfo.hidden = true;
    resultSection.hidden = true;
  }

  function parseSSE(buffer) {
    var events = [];
    var parts = buffer.split("\n\n");
    for (var i = 0; i < parts.length - 1; i++) {
      var block = parts[i];
      var event = "message";
      var data = null;
      block.split("\n").forEach(function (line) {
        if (line.startsWith("event:")) event = line.replace("event:", "").trim();
        if (line.startsWith("data:")) {
          try { data = JSON.parse(line.replace("data:", "").trim()); } catch (e) { data = line.replace("data:", "").trim(); }
        }
      });
      if (data !== null) events.push({ event: event, data: data });
    }
    return { events: events, remainder: parts[parts.length - 1] };
  }

  function buildRequestBody() {
    var type = (form.querySelector('input[name="inputType"]:checked') || {}).value || "text";
    if (type === "text") {
      return { text: textArea.value };
    }
    if (type === "json") {
      return { type: "json", data: textArea.value, metadata: {} };
    }
    if (type === "image" || type === "video" || type === "file") {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return null;
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () {
          var b64 = r.result.split(",")[1] || r.result;
          var payloadType = type === "file" ? "binary" : type;
          resolve({
            type: payloadType,
            data: b64,
            metadata: { filename: file.name, content_type: file.type || "application/octet-stream" }
          });
        };
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }
    return { text: textArea.value };
  }

  function renderResult(payload, steps, stored) {
    resultBody.innerHTML = "";
    if (!payload && steps) {
      var pre = document.createElement("pre");
      pre.textContent = JSON.stringify({ steps: steps, stored: stored }, null, 2);
      resultBody.appendChild(pre);
      return;
    }
    var type = (payload && payload.type) || "text";
    var data = payload && payload.data;
    if (type === "image" && typeof data === "string" && data.length > 0) {
      var img = document.createElement("img");
      img.src = "data:image/png;base64," + data;
      img.alt = "Result";
      img.style.maxWidth = "100%";
      resultBody.appendChild(img);
    } else if (type === "video" && typeof data === "string" && data.length > 0) {
      var vid = document.createElement("video");
      vid.src = "data:video/mp4;base64," + data;
      vid.controls = true;
      vid.style.maxWidth = "100%";
      resultBody.appendChild(vid);
    } else if (type === "json") {
      var pre = document.createElement("pre");
      try {
        pre.textContent = JSON.stringify(JSON.parse(data), null, 2);
      } catch (e) {
        pre.textContent = data;
      }
      resultBody.appendChild(pre);
    } else if (type === "binary" && payload.metadata && payload.metadata.filename) {
      var p = document.createElement("p");
      p.textContent = "Download: " + payload.metadata.filename + " (" + (data ? data.length : 0) + " chars base64)";
      resultBody.appendChild(p);
    } else {
      var pre = document.createElement("pre");
      pre.textContent = typeof data !== "undefined" ? String(data) : JSON.stringify({ payload: payload, steps: steps, stored: stored }, null, 2);
      resultBody.appendChild(pre);
    }
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    processError.hidden = true;
    processError.textContent = "";
    submitBtn.disabled = true;
    submitBtn.classList.add("running");
    resetStations();

    var bodyPromise = buildRequestBody();
    if (bodyPromise && typeof bodyPromise.then === "function") {
      try {
        bodyPromise = await bodyPromise;
      } catch (err) {
        processError.textContent = "Failed to read file: " + (err.message || "error");
        processError.hidden = false;
        submitBtn.disabled = false;
        submitBtn.classList.remove("running");
        return;
      }
    }
    if (!bodyPromise) {
      processError.textContent = "Choose a file for Image/Video/File input.";
      processError.hidden = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove("running");
      return;
    }

    try {
      var res = await fetch("/process/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPromise),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return { detail: res.statusText }; });
        processError.textContent = (err.detail && (Array.isArray(err.detail) ? err.detail.join(" ") : err.detail)) || res.statusText;
        processError.hidden = false;
        return;
      }
      setStationState("gateway", "processing");
      moveTrain(0);
      var payloadType = bodyPromise.type || (bodyPromise.text != null ? "text" : "text");
      setStationState("gateway", "done");
      setStationData("gateway", bodyPromise.data || bodyPromise.text || "", "Sent", payloadType);
      setStationState(STATION_ORDER[1] || "validator", "processing");
      moveTrain(1);

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var parsed = parseSSE(buf);
        buf = parsed.remainder;
        parsed.events.forEach(function (ev) {
          if (ev.event === "started") {
            if (ev.data.trace_id) {
              traceIdEl.textContent = ev.data.trace_id;
              jaegerLink.href = JAEGER_BASE + "/trace/" + ev.data.trace_id;
              traceInfo.hidden = false;
            }
          } else if (ev.event === "step") {
            var svc = (ev.data.service || "").toLowerCase();
            setStationState(svc, "done");
            setStationData(svc, ev.data.input, ev.data.output, ev.data.payload_type || "text");
            var idx = STATION_ORDER.indexOf(svc);
            var nextIdx = idx + 1;
            if (nextIdx < STATION_ORDER.length) {
              setStationState(STATION_ORDER[nextIdx], "processing");
              moveTrain(nextIdx);
            } else {
              moveTrain(STATION_ORDER.length);
            }
          } else if (ev.event === "error") {
            var svc = (ev.data.service || "").toLowerCase();
            setStationState(svc, "error");
            setStationData(svc, "", ev.data.error || "Error", "text");
            processError.textContent = (ev.data.service || "Service") + ": " + (ev.data.error || "error");
            processError.hidden = false;
          } else if (ev.event === "done") {
            moveTrain(STATION_ORDER.length);
            if (STATION_ORDER.length > 0) setStationState(STATION_ORDER[STATION_ORDER.length - 1], "done");
            if (ev.data.trace_id) {
              traceIdEl.textContent = ev.data.trace_id;
              jaegerLink.href = JAEGER_BASE + "/trace/" + ev.data.trace_id;
              traceInfo.hidden = false;
            }
            if (ev.data.payload || ev.data.steps) {
              renderResult(ev.data.payload, ev.data.steps, ev.data.stored);
              resultSection.hidden = false;
            }
          }
        });
      }
      if (buf.trim()) {
        var last = parseSSE(buf + "\n\n");
        last.events.forEach(function (ev) {
          if (ev.event === "done" && ev.data && resultSection.hidden) {
            renderResult(ev.data.payload, ev.data.steps, ev.data.stored);
            resultSection.hidden = false;
          }
        });
      }
    } catch (err) {
      processError.textContent = err.message || "Request failed";
      processError.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove("running");
    }
  });

  function buildStations(services) {
    STATION_ORDER = ["gateway"].concat(services.map(function (s) { return s.name; }));
    stationsLoading.hidden = true;
    stations.innerHTML = "";
    STATION_ORDER.forEach(function (name, i) {
      var icon = "•";
      var label = name;
      if (name === "gateway") {
        icon = "🚉";
        label = "Gateway";
      } else {
        var svc = services.find(function (s) { return s.name === name; });
        if (svc) { icon = svc.icon || "•"; label = svc.name; }
      }
      var div = document.createElement("div");
      div.className = "station";
      div.setAttribute("data-service", name);
      div.innerHTML =
        '<div class="station-icon">' + icon + '</div>' +
        '<div class="station-name">' + label + '</div>' +
        '<div class="station-detail" data-detail="status">—</div>' +
        '<div class="station-detail" data-detail="input">—</div>' +
        '<div class="station-detail" data-detail="output">—</div>';
      stations.appendChild(div);
    });
    requestAnimationFrame(function () { drawRailPath(); });
  }

  function buildExpandStations() {
    if (!expandStations) return;
    expandStations.innerHTML = "";
    var services = currentServices.length ? currentServices : [
      { name: "validator", icon: "✓" }, { name: "transformer", icon: "⇅" },
      { name: "enricher", icon: "⊕" }, { name: "persister", icon: "💾" }
    ];
    STATION_ORDER.forEach(function (name) {
      var icon = "•";
      var label = name;
      if (name === "gateway") { icon = "🚉"; label = "Gateway"; }
      else {
        var s = services.find(function (x) { return x.name === name; });
        if (s) { icon = s.icon || "•"; label = s.name; }
      }
      var div = document.createElement("div");
      div.className = "station";
      div.setAttribute("data-service", name);
      div.innerHTML =
        '<div class="station-icon">' + icon + '</div>' +
        '<div class="station-name">' + label + '</div>' +
        '<div class="station-detail" data-detail="status">—</div>' +
        '<div class="station-detail" data-detail="input">—</div>' +
        '<div class="station-detail" data-detail="output">—</div>';
      expandStations.appendChild(div);
    });
    syncExpandStationStates();
    drawExpandRail();
  }

  function syncExpandStationStates() {
    if (!expandStations) return;
    STATION_ORDER.forEach(function (name) {
      var mainEl = stations.querySelector('[data-service="' + name + '"]');
      var expandEl = expandStations.querySelector('[data-service="' + name + '"]');
      if (!expandEl || !mainEl) return;
      expandEl.classList.remove("current", "done", "error");
      if (mainEl.classList.contains("current")) expandEl.classList.add("current");
      if (mainEl.classList.contains("done")) expandEl.classList.add("done");
      if (mainEl.classList.contains("error")) expandEl.classList.add("error");
      var es = expandEl.querySelector('[data-detail="status"]');
      var ei = expandEl.querySelector('[data-detail="input"]');
      var eo = expandEl.querySelector('[data-detail="output"]');
      if (es) es.textContent = (mainEl.querySelector('[data-detail="status"]') || {}).textContent || "—";
      if (ei) ei.innerHTML = (mainEl.querySelector('[data-detail="input"]') || {}).innerHTML || "—";
      if (eo) eo.innerHTML = (mainEl.querySelector('[data-detail="output"]') || {}).innerHTML || "—";
    });
  }

  function drawExpandRail() {
    if (!expandRailPath || !STATION_ORDER.length) return;
    var n = STATION_ORDER.length;
    var numRows = Math.ceil(n / STATIONS_PER_ROW);
    var pts = [];
    for (var r = 0; r < numRows; r++) {
      var count = Math.min(STATIONS_PER_ROW, n - r * STATIONS_PER_ROW);
      var cols = [];
      for (var c = 0; c < count; c++) cols.push(c);
      if (r % 2 === 1) cols.reverse();
      var y = (r + 0.5) / numRows * 100;
      for (var i = 0; i < cols.length; i++) {
        var x = (cols[i] + 0.5) / STATIONS_PER_ROW * 100;
        pts.push(x + " " + y);
      }
      if (r < numRows - 1) {
        var lastX = (cols[cols.length - 1] + 0.5) / STATIONS_PER_ROW * 100;
        var nextY = (r + 1.5) / numRows * 100;
        pts.push(lastX + " " + nextY);
      }
    }
    expandRailPath.setAttribute("d", "M " + pts.join(" L "));
    expandRailPath.parentElement.setAttribute("viewBox", "0 0 100 100");
    expandRailPath.parentElement.setAttribute("preserveAspectRatio", "none");
  }

  function moveExpandTrain(index) {
    if (!expandTrain) return;
    if (index < 0) {
      expandTrain.classList.remove("visible");
      return;
    }
    var pos = getGridPosition(index);
    var leftPct = (pos.col + 0.5) / STATIONS_PER_ROW * 100;
    var topPct = (pos.row + 0.5) / pos.numRows * 100;
    expandTrain.style.left = leftPct + "%";
    expandTrain.style.top = topPct + "%";
    expandTrain.classList.add("visible");
  }

  (function initExpand() {
    if (!expandBtn || !expandOverlay) return;
    var pan = { x: 0, y: 0 };
    var scale = 1;
    var isPanning = false;
    var startX, startY, startPanX, startPanY;

    function applyTransform() {
      if (!expandViewport) return;
      expandViewport.style.transform = "translate(" + pan.x + "px, " + pan.y + "px) scale(" + scale + ")";
    }

    expandBtn.addEventListener("click", function () {
      expandOverlay.hidden = false;
      expandOverlay.setAttribute("aria-hidden", "false");
      expandOverlay.focus();
      buildExpandStations();
      moveExpandTrain(currentTrainIndex);
      pan = { x: 0, y: 0 };
      scale = 1;
      applyTransform();
    });

    expandCloseBtn.addEventListener("click", function () {
      expandOverlay.hidden = true;
      expandOverlay.setAttribute("aria-hidden", "true");
    });

    expandOverlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { expandCloseBtn.click(); return; }
      if (e.key === "+" || e.key === "=") { scale = Math.min(3, scale + 0.15); applyTransform(); e.preventDefault(); return; }
      if (e.key === "-") { scale = Math.max(0.2, scale - 0.15); applyTransform(); e.preventDefault(); return; }
      var step = 40;
      if (e.key === "ArrowLeft") { pan.x += step; applyTransform(); e.preventDefault(); return; }
      if (e.key === "ArrowRight") { pan.x -= step; applyTransform(); e.preventDefault(); return; }
      if (e.key === "ArrowUp") { pan.y += step; applyTransform(); e.preventDefault(); return; }
      if (e.key === "ArrowDown") { pan.y -= step; applyTransform(); e.preventDefault(); return; }
    });

    expandBoard.addEventListener("mousedown", function (e) {
      if (e.target.closest("button")) return;
      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      startPanX = pan.x;
      startPanY = pan.y;
    });
    document.addEventListener("mousemove", function (e) {
      if (!isPanning) return;
      pan.x = startPanX + (e.clientX - startX);
      pan.y = startPanY + (e.clientY - startY);
      applyTransform();
    });
    document.addEventListener("mouseup", function () { isPanning = false; });

    expandBoard.addEventListener("wheel", function (e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      scale = Math.max(0.2, Math.min(3, scale + delta));
      applyTransform();
    }, { passive: false });
  })();

  fetch("/api/pipeline")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var list = (data && data.services) ? data.services : [];
      currentServices = list.length ? list : [
        { name: "validator", url: "http://validator:8001", icon: "✓", description: "", input_type: "", output_type: "" },
        { name: "transformer", url: "http://transformer:8002", icon: "⇅", description: "", input_type: "", output_type: "" },
        { name: "enricher", url: "http://enricher:8003", icon: "⊕", description: "", input_type: "", output_type: "" },
        { name: "persister", url: "http://persister:8004", icon: "💾", description: "", input_type: "", output_type: "" }
      ];
      if (list.length === 0) buildStations(currentServices);
      else buildStations(list);
    })
    .catch(function () {
      currentServices = [
        { name: "validator", url: "http://validator:8001", icon: "✓" },
        { name: "transformer", url: "http://transformer:8002", icon: "⇅" },
        { name: "enricher", url: "http://enricher:8003", icon: "⊕" },
        { name: "persister", url: "http://persister:8004", icon: "💾" }
      ];
      buildStations(currentServices);
    });
})();

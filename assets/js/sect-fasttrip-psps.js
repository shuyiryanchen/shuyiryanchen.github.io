(() => {
  const root = document.getElementById("sect-fasttrip-psps");
  if (!root) return;

  const basePath = root.dataset.basePath || "";
  const manifestUrl = `${basePath}/assets/website_plots/manifest.json`;

  const csvUpload = document.getElementById("csv-upload");
  const loadCsvButton = document.getElementById("load-csv");
  const xAxisSelect = document.getElementById("x-axis");
  const yMetricSelect = document.getElementById("y-metric");
  const filterControls = document.getElementById("filter-controls");
  const trendPlot = document.getElementById("trend-plot");

  const imageBasePathInput = document.getElementById("image-base-path");
  const imageFilenameInput = document.getElementById("image-filename");
  const imagePatternInput = document.getElementById("image-pattern");
  const imageUpload = document.getElementById("image-upload");
  const updateImageButton = document.getElementById("update-image");
  const imageStatus = document.getElementById("image-status");
  const imageParams = document.getElementById("image-params");
  const decisionImage = document.getElementById("decision-image");

  const hyperparams = [
    "B_budget",
    "B_budget_multiplier",
    "C_budget",
    "C_budget_multiplier",
    "K_groups",
    "W_cap",
    "W_cap_multiplier",
    "alpha",
    "effective_alpha",
    "gamma_i_multiplier",
    "grouping_method",
    "ignitions",
    "mht_method"
  ];

  let dataset = [];
  let columns = [];
  let numericColumns = [];
  let availableParams = [];
  let defaultCsvFile = "";
  let usingDefaultCsv = false;

  const hiddenParamsForDefault = new Set(["W_cap", "C_budget", "ignitions"]);

  imageBasePathInput.value = `${basePath}/assets/website_plots`;
  imagePatternInput.value =
    "{B_budget}_{B_budget_multiplier}_{C_budget}_{C_budget_multiplier}_{K_groups}_" +
    "{W_cap}_{W_cap_multiplier}_{alpha}_{effective_alpha}_{gamma_i_multiplier}_" +
    "{grouping_method}_{ignitions}_{mht_method}.png";

  const setStatus = (el, message, isError = false) => {
    el.textContent = message;
    el.style.color = isError ? "#a40000" : "#555";
  };

  const getDisplayParams = () => {
    const params = availableParams.length ? availableParams : hyperparams;
    if (!usingDefaultCsv) return params;
    return params.filter((param) => !hiddenParamsForDefault.has(param));
  };

  const parseCsvText = (text) => {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (result.errors && result.errors.length) {
      throw new Error(result.errors[0].message);
    }
    return result.data;
  };

  const isNumericColumn = (rows, key) => {
    let hasValue = false;
    for (const row of rows) {
      const value = row[key];
      if (value === undefined || value === null || value === "") continue;
      hasValue = true;
      if (Number.isNaN(Number(value))) return false;
    }
    return hasValue;
  };

  const getUniqueValues = (rows, key) => {
    const values = new Set();
    rows.forEach((row) => {
      const value = row[key];
      if (value !== undefined && value !== null && value !== "") {
        values.add(value);
      }
    });
    const list = Array.from(values);
    if (list.every((val) => !Number.isNaN(Number(val)))) {
      return list.sort((a, b) => Number(a) - Number(b));
    }
    return list.sort();
  };

  const buildAxisSelects = () => {
    xAxisSelect.innerHTML = "";
    yMetricSelect.innerHTML = "";

    getDisplayParams().forEach((param) => {
      const option = document.createElement("option");
      option.value = param;
      option.textContent = param;
      xAxisSelect.appendChild(option);
    });

    numericColumns.forEach((metric) => {
      const option = document.createElement("option");
      option.value = metric;
      option.textContent = metric;
      yMetricSelect.appendChild(option);
    });

    const displayParams = getDisplayParams();
    if (displayParams.length) {
      xAxisSelect.value = displayParams[0];
    }
    if (numericColumns.includes("true_cost")) {
      yMetricSelect.value = "true_cost";
    }
  };

  const buildFilterControls = () => {
    filterControls.innerHTML = "";
    const xAxis = xAxisSelect.value;

    getDisplayParams()
      .filter((param) => param !== xAxis)
      .forEach((param) => {
        const wrapper = document.createElement("div");
        wrapper.className = "sfps-field";
        const label = document.createElement("label");
        label.textContent = param;
        label.setAttribute("for", `filter-${param}`);
        const select = document.createElement("select");
        select.id = `filter-${param}`;
        select.dataset.param = param;

        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "All (average)";
        select.appendChild(allOption);

        getUniqueValues(dataset, param).forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          select.appendChild(option);
        });

        select.addEventListener("change", renderPlot);
        wrapper.appendChild(label);
        wrapper.appendChild(select);
        filterControls.appendChild(wrapper);
      });
  };

  const computeStats = (values) => {
    const nums = values.map((val) => Number(val)).filter((val) => !Number.isNaN(val));
    if (!nums.length) return { mean: 0, std: 0 };
    const mean = nums.reduce((sum, val) => sum + val, 0) / nums.length;
    const variance =
      nums.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / nums.length;
    return { mean, std: Math.sqrt(variance) };
  };

  const renderPlot = () => {
    if (!dataset.length) return;
    const xAxis = xAxisSelect.value;
    const yMetric = yMetricSelect.value;

    const filters = {};
    filterControls.querySelectorAll("select").forEach((select) => {
      if (select.value) {
        filters[select.dataset.param] = select.value;
      }
    });

    const filteredRows = dataset.filter((row) =>
      Object.entries(filters).every(([key, value]) => String(row[key]) === value)
    );

    const grouped = new Map();
    filteredRows.forEach((row) => {
      const xValue = row[xAxis];
      if (xValue === undefined || xValue === null || xValue === "") return;
      if (!grouped.has(xValue)) grouped.set(xValue, []);
      grouped.get(xValue).push(row[yMetric]);
    });

    const xValues = Array.from(grouped.keys());
    const sortedXValues = xValues.every((val) => !Number.isNaN(Number(val)))
      ? xValues.sort((a, b) => Number(a) - Number(b))
      : xValues.sort();

    const means = [];
    const uppers = [];
    const lowers = [];

    sortedXValues.forEach((xValue) => {
      const stats = computeStats(grouped.get(xValue));
      means.push(stats.mean);
      uppers.push(stats.mean + stats.std);
      lowers.push(stats.mean - stats.std);
    });

    const meanTrace = {
      x: sortedXValues,
      y: means,
      type: "scatter",
      mode: "lines+markers",
      name: `${yMetric} mean`,
      line: { color: "#1f77b4" }
    };

    const upperTrace = {
      x: sortedXValues,
      y: uppers,
      type: "scatter",
      mode: "lines",
      line: { width: 0 },
      hoverinfo: "skip",
      showlegend: false
    };

    const lowerTrace = {
      x: sortedXValues,
      y: lowers,
      type: "scatter",
      mode: "lines",
      fill: "tonexty",
      fillcolor: "rgba(31, 119, 180, 0.2)",
      line: { width: 0 },
      name: "±1 std",
      hoverinfo: "skip"
    };

    const layout = {
      xaxis: { title: xAxis },
      yaxis: { title: yMetric },
      margin: { t: 20, r: 20, b: 50, l: 60 }
    };

    Plotly.newPlot(trendPlot, [upperTrace, lowerTrace, meanTrace], layout, {
      responsive: true
    });
  };

  const handleCsvData = (rows) => {
    dataset = rows;
    columns = rows.length ? Object.keys(rows[0]) : [];
    numericColumns = columns.filter((col) => isNumericColumn(rows, col));
    availableParams = hyperparams.filter((param) => columns.includes(param));

    if (!numericColumns.length || !availableParams.length) {
      return;
    }

    buildAxisSelects();
    buildFilterControls();
    buildImageControls();
    renderPlot();
  };

  const loadCsvFromUrl = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch CSV.");
    return await response.text();
  };

  const loadCsv = async () => {
    try {
      let text = "";
      if (csvUpload.files && csvUpload.files[0]) {
        text = await csvUpload.files[0].text();
        usingDefaultCsv = false;
      } else if (defaultCsvFile) {
        const csvUrl = `${basePath}/assets/website_plots/${defaultCsvFile}`;
        text = await loadCsvFromUrl(csvUrl);
        usingDefaultCsv = true;
      } else {
        return;
      }
      const rows = parseCsvText(text);
      handleCsvData(rows);
    } catch (error) {
      usingDefaultCsv = false;
    }
  };

  const buildImageControls = () => {
    imageParams.innerHTML = "";
    getDisplayParams().forEach((param) => {
      const wrapper = document.createElement("div");
      wrapper.className = "sfps-field";
      const label = document.createElement("label");
      label.textContent = param;
      const input = document.createElement("select");
      input.id = `image-${param}`;
      input.dataset.param = param;

      if (dataset.length && columns.includes(param)) {
        getUniqueValues(dataset, param).forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          input.appendChild(option);
        });
      } else {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Enter manually below";
        input.appendChild(option);
      }

      const manualInput = document.createElement("input");
      manualInput.type = "text";
      manualInput.placeholder = "manual value (optional)";
      manualInput.dataset.param = param;

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      wrapper.appendChild(manualInput);
      imageParams.appendChild(wrapper);
    });
  };

  const renderImage = () => {
    if (imageUpload.files && imageUpload.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        decisionImage.src = event.target.result;
        setStatus(imageStatus, "Loaded image from upload.");
      };
      reader.readAsDataURL(imageUpload.files[0]);
      return;
    }

    const params = {};
    imageParams.querySelectorAll("select").forEach((select) => {
      params[select.dataset.param] = select.value;
    });
    imageParams.querySelectorAll("input[type='text']").forEach((input) => {
      if (input.value) params[input.dataset.param] = input.value;
    });

    let filename = imageFilenameInput.value.trim();
    if (!filename) {
      filename = imagePatternInput.value;
      Object.entries(params).forEach(([key, value]) => {
        filename = filename.replaceAll(`{${key}}`, value || "");
      });
    }

    if (!filename) {
      setStatus(imageStatus, "Provide an image filename or pattern.", true);
      return;
    }

    const base = imageBasePathInput.value.trim() || `${basePath}/assets/website_plots`;
    const imageUrl = filename.includes("/") ? filename : `${base}/${filename}`;
    decisionImage.src = imageUrl;
    setStatus(imageStatus, `Loading ${imageUrl}`);
  };

  const init = async () => {
    buildImageControls();
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error("No manifest.");
      const manifest = await response.json();
      defaultCsvFile = (manifest.csvFiles || [])[0] || "";
      await loadCsv();
    } catch (error) {
      defaultCsvFile = "";
    }
  };

  loadCsvButton.addEventListener("click", loadCsv);
  xAxisSelect.addEventListener("change", () => {
    buildFilterControls();
    renderPlot();
  });
  yMetricSelect.addEventListener("change", renderPlot);
  updateImageButton.addEventListener("click", renderImage);
  decisionImage.addEventListener("error", () => {
    setStatus(imageStatus, "Image failed to load. Check the path.", true);
  });
  decisionImage.addEventListener("load", () => {
    setStatus(imageStatus, "Image loaded.");
  });

  init();
})();

(() => {
  const root = document.getElementById("sect-fasttrip-psps");
  if (!root) return;

  const basePath = root.dataset.basePath || "";
  const manifestUrl = `${basePath}/assets/website_plots/manifest.json`;

  const xAxisSelect = document.getElementById("x-axis");
  const yAxisLeftSelect = document.getElementById("y-axis-left");
  const yAxisRightSelect = document.getElementById("y-axis-right");
  const filterControls = document.getElementById("filter-controls");
  const trendPlotOpt = document.getElementById("trend-plot-opt");
  const trendPlotTrue = document.getElementById("trend-plot-true");
  const plotTitleLeft = document.getElementById("plot-title-left");
  const plotTitleRight = document.getElementById("plot-title-right");

  const imageSuffixControl = document.getElementById("image-suffix-control");
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

  const paramLabels = {
    B_budget: "Fast-trip budget",
    B_budget_multiplier: "Fast-trip budget (ratio of circuits)",
    C_budget: "PSPS budget",
    C_budget_multiplier: "PSPS budget (ratio of circuits)",
    K_groups: "Number of groups",
    W_cap: "Reliability constraint (absolute)",
    W_cap_multiplier: "Reliability constraint (ratio)",
    alpha: "FWER",
    effective_alpha: "Effectiveness of fast-trip",
    gamma_i_multiplier: "Fast-trip average reliability cost",
    grouping_method: "Declustering method",
    ignitions: "Ignitions",
    mht_method: "MHT method"
  };

  const yMetricOptions = [
    { key: "opt_cost", label: "Optimization cost", type: "direct" },
    { key: "true_cost", label: "Evaluation cost", type: "direct" },
    { key: "x_size", label: "X size", type: "direct" },
    { key: "y_size", label: "Y size", type: "direct" },
    {
      key: "prevented_fast_trip_pct",
      label: "Prevented by fast-trip (% of ignitions)",
      type: "ratio",
      numerator: "prevented_by_fast_trip_y_total",
      denominator: "ignitions"
    },
    {
      key: "prevented_psps_pct",
      label: "Prevented by PSPS (% of ignitions)",
      type: "ratio",
      numerator: "prevented_by_psps_z_total",
      denominator: "ignitions"
    }
  ];

  let dataset = [];
  let columns = [];
  let numericColumns = [];
  let availableParams = [];
  let defaultCsvFile = "";
  let usingDefaultCsv = false;
  let imageMeta = [];
  let imageSuffixOptions = [];
  let imageSelection = {
    suffix: ""
  };

  const hiddenParamsForDefault = new Set([
    "B_budget",
    "W_cap",
    "C_budget",
    "ignitions"
  ]);

  const imageBasePath = `${basePath}/assets/website_plots/`;

  const setStatus = (el, message, isError = false) => {
    if (!isError) {
      el.textContent = "";
      return;
    }
    el.textContent = message;
    el.style.color = "#a40000";
  };

  const getLabel = (param) => paramLabels[param] || param;
  const getMetricLabel = (key) =>
    (yMetricOptions.find((option) => option.key === key) || {}).label || key;

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

  const parseImageName = (path) => {
    if (!path) return null;
    const filename = path.split("/").pop() || "";
    const withoutExt = filename.replace(/\.(png|jpg|jpeg)$/i, "");
    let base = withoutExt;

    const suffixes = {
      hftd: base.includes("_with_hftd"),
      inset: base.includes("_with_inset")
    };

    base = base.replace(/_with_hftd/g, "").replace(/_with_inset/g, "");

    const mhtMarker = "_mht_method=";
    const mhtIndex = base.lastIndexOf(mhtMarker);
    if (mhtIndex === -1) return null;

    const prefix = base.slice(0, mhtIndex);
    const mhtMethod = base.slice(mhtIndex + mhtMarker.length);

    const rowMatch = prefix.match(/^map_row(\d+)_/);
    if (!rowMatch) return null;
    const row = Number(rowMatch[1]);
    const remainder = prefix.slice(rowMatch[0].length);

    const params = {};
    const regex = /([A-Za-z]+(?:_[A-Za-z]+)*)=([^_]+)/g;
    let match = regex.exec(remainder);
    while (match) {
      const key = match[1];
      const value = match[2];
      if (key && value !== undefined) {
        params[key] = value;
      }
      match = regex.exec(remainder);
    }

    return {
      path,
      row: Number.isNaN(row) ? null : row,
      params: {
        ...params,
        mht_method: mhtMethod
      },
      suffix: {
        hftd: suffixes.hftd,
        inset: suffixes.inset
      }
    };
  };

  const getSuffixLabel = (suffix) => {
    if (suffix.hftd && suffix.inset) return "With HFTD + Inset";
    if (suffix.hftd) return "With HFTD";
    if (suffix.inset) return "With Inset";
    return "No suffix";
  };

  const getSuffixKey = (suffix) => {
    if (suffix.hftd && suffix.inset) return "with_hftd_with_inset";
    if (suffix.hftd) return "with_hftd";
    if (suffix.inset) return "with_inset";
    return "none";
  };

  const normalizeImagePath = (path) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("assets/")) return `${basePath}/${path}`;
    return `${imageBasePath}${path}`;
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
    yAxisLeftSelect.innerHTML = "";
    yAxisRightSelect.innerHTML = "";

    getDisplayParams().forEach((param) => {
      const option = document.createElement("option");
      option.value = param;
      option.textContent = getLabel(param);
      xAxisSelect.appendChild(option);
    });

    yMetricOptions.forEach((metric) => {
      const optionLeft = document.createElement("option");
      optionLeft.value = metric.key;
      optionLeft.textContent = metric.label;
      yAxisLeftSelect.appendChild(optionLeft);

      const optionRight = document.createElement("option");
      optionRight.value = metric.key;
      optionRight.textContent = metric.label;
      yAxisRightSelect.appendChild(optionRight);
    });

    const displayParams = getDisplayParams();
    if (displayParams.length) {
      xAxisSelect.value = displayParams[0];
    }

    yAxisLeftSelect.value = "opt_cost";
    yAxisRightSelect.value = "true_cost";
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
        label.textContent = getLabel(param);
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
    const leftMetric = yAxisLeftSelect.value;
    const rightMetric = yAxisRightSelect.value;

    const filters = {};
    filterControls.querySelectorAll("select").forEach((select) => {
      if (select.value) {
        filters[select.dataset.param] = select.value;
      }
    });

    const filteredRows = dataset.filter((row) =>
      Object.entries(filters).every(([key, value]) => String(row[key]) === value)
    );

    const getMetricConfig = (metricKey) =>
      yMetricOptions.find((metric) => metric.key === metricKey);

    const isMetricAvailable = (metric) => {
      if (!metric) return false;
      if (metric.type === "direct") {
        return numericColumns.includes(metric.key);
      }
      if (metric.type === "ratio") {
        return columns.includes(metric.numerator) && columns.includes(metric.denominator);
      }
      return false;
    };

    const getMetricValue = (row, metric) => {
      if (metric.type === "direct") {
        return Number(row[metric.key]);
      }
      if (metric.type === "ratio") {
        const numerator = Number(row[metric.numerator]);
        const denominator = Number(row[metric.denominator]);
        if (Number.isNaN(numerator) || Number.isNaN(denominator) || denominator === 0) {
          return NaN;
        }
        return (numerator / denominator) * 100;
      }
      return NaN;
    };

    const renderMetricPlot = (targetEl, metricKey) => {
      const metric = getMetricConfig(metricKey);
      const yLabel = getMetricLabel(metricKey);
      if (!isMetricAvailable(metric)) {
        targetEl.innerHTML = `<div class="sfps-status">${yLabel} unavailable</div>`;
        return;
      }

      const grouped = new Map();
      filteredRows.forEach((row) => {
        const xValue = row[xAxis];
        if (xValue === undefined || xValue === null || xValue === "") return;
        if (!grouped.has(xValue)) grouped.set(xValue, []);
        grouped.get(xValue).push(getMetricValue(row, metric));
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
        name: `${yLabel} mean`,
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

      const yAxisConfig = { title: yLabel };
      if (metric.type === "ratio") {
        yAxisConfig.rangemode = "tozero";
      }

      const layout = {
        xaxis: { title: getLabel(xAxis) },
        yaxis: yAxisConfig,
        margin: { t: 20, r: 20, b: 80, l: 60 },
        legend: {
          orientation: "h",
          x: 0.5,
          xanchor: "center",
          y: -0.25,
          yanchor: "top"
        }
      };

      Plotly.newPlot(targetEl, [upperTrace, lowerTrace, meanTrace], layout, {
        responsive: true
      });
    };

    renderMetricPlot(trendPlotOpt, leftMetric);
    renderMetricPlot(trendPlotTrue, rightMetric);
    plotTitleLeft.textContent = getMetricLabel(leftMetric);
    plotTitleRight.textContent = getMetricLabel(rightMetric);
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
    renderImage();
  };

  const loadCsvFromUrl = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch CSV.");
    return await response.text();
  };

  const loadCsv = async () => {
    try {
      let text = "";
      if (defaultCsvFile) {
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
    imageSelection = { suffix: imageSelection.suffix || "" };
    const sliderParams = [
      "B_budget_multiplier",
      "C_budget_multiplier",
      "W_cap_multiplier",
      "effective_alpha"
    ];
    const dropdownParams = ["mht_method", "K_groups", "alpha"];
    const orderedParams = [...sliderParams, ...dropdownParams];

    orderedParams.forEach((param) => {
      const wrapper = document.createElement("div");
      wrapper.className = "sfps-field";
      const label = document.createElement("label");
      label.textContent = getLabel(param);

      const values = imageMeta
        .map((meta) => meta.params[param])
        .filter((value) => value !== undefined && value !== "");

      const uniqueValues = Array.from(new Set(values));
      if (!uniqueValues.length) return;

      const numericValues = uniqueValues.filter((val) => !Number.isNaN(Number(val)));
      const allNumeric = numericValues.length === uniqueValues.length;
      const sortedValues = allNumeric
        ? uniqueValues.sort((a, b) => Number(a) - Number(b))
        : uniqueValues.sort();

      if (sliderParams.includes(param) && allNumeric) {
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = String(Math.max(sortedValues.length - 1, 0));
        slider.step = "1";
        slider.value = "0";
        slider.dataset.param = param;
        slider.dataset.values = JSON.stringify(sortedValues);

        const valueDisplay = document.createElement("div");
        valueDisplay.className = "sfps-status sfps-slider-value";
        valueDisplay.textContent = sortedValues[0];
        valueDisplay.dataset.param = param;

        slider.addEventListener("input", () => {
          const list = JSON.parse(slider.dataset.values || "[]");
          const current = list[Number(slider.value)] ?? "";
          valueDisplay.textContent = current;
          imageSelection[param] = current;
          renderImage();
        });

        wrapper.appendChild(label);
        wrapper.appendChild(slider);
        wrapper.appendChild(valueDisplay);
        imageParams.appendChild(wrapper);
        imageSelection[param] = sortedValues[0];
      } else {
        const input = document.createElement("select");
        input.id = `image-${param}`;
        input.dataset.param = param;

        sortedValues.forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          input.appendChild(option);
        });

        input.addEventListener("change", () => {
          imageSelection[param] = input.value;
          renderImage();
        });
        wrapper.appendChild(label);
        wrapper.appendChild(input);
        imageParams.appendChild(wrapper);
        imageSelection[param] = sortedValues[0];
      }
    });
  };

  const buildSuffixControl = () => {
    imageSuffixControl.innerHTML = "";
    if (!imageSuffixOptions.length) return;

    const label = document.createElement("label");
    label.setAttribute("for", "image-suffix");
    label.textContent = "Plot suffix";

    const select = document.createElement("select");
    select.id = "image-suffix";
    imageSuffixOptions.forEach((suffix) => {
      const option = document.createElement("option");
      option.value = suffix.key;
      option.textContent = suffix.label;
      select.appendChild(option);
    });

    imageSelection.suffix = imageSuffixOptions[0].key;
    select.value = imageSelection.suffix;
    select.addEventListener("change", () => {
      imageSelection.suffix = select.value;
      renderImage();
    });

    imageSuffixControl.appendChild(label);
    imageSuffixControl.appendChild(select);
  };

  const renderImage = () => {
    if (!imageMeta.length) {
      setStatus(imageStatus, "No plot images available.", true);
      return;
    }

    const suffixKey = imageSelection.suffix || "none";
    const matches = imageMeta.filter((meta) => {
      const metaSuffixKey = getSuffixKey(meta.suffix);
      if (metaSuffixKey !== suffixKey) return false;

      return Object.entries(imageSelection).every(([key, value]) => {
        if (key === "suffix") return true;
        if (key === "W_cap") return true;
        if (key === "B_budget") return true;
        if (key === "C_budget") return true;
        return String(meta.params[key]) === String(value);
      });
    });

    const sortedMatches = matches.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    const selected = sortedMatches[0];
    if (!selected) {
      setStatus(imageStatus, "No matching plot found for the selected settings.", true);
      decisionImage.removeAttribute("src");
      return;
    }

    const imageUrl = normalizeImagePath(selected.path);
    decisionImage.src = imageUrl;
    setStatus(imageStatus, "", false);
  };

  const init = async () => {
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error("No manifest.");
      const manifest = await response.json();
      defaultCsvFile = (manifest.csvFiles || [])[0] || "";
      const images = manifest.images || manifest.imageFiles || [];
      imageMeta = images.map(parseImageName).filter(Boolean);
      imageSuffixOptions = Array.from(
        new Map(
          imageMeta.map((meta) => {
            const key = getSuffixKey(meta.suffix);
            return [key, { key, label: getSuffixLabel(meta.suffix) }];
          })
        ).values()
      );

      buildSuffixControl();
      buildImageControls();
      renderImage();
      await loadCsv();
    } catch (error) {
      defaultCsvFile = "";
    }
  };

  xAxisSelect.addEventListener("change", () => {
    buildFilterControls();
    renderPlot();
  });
  yAxisLeftSelect.addEventListener("change", renderPlot);
  yAxisRightSelect.addEventListener("change", renderPlot);
  decisionImage.addEventListener("error", () => {
    setStatus(imageStatus, "Image failed to load. Check the path.", true);
  });
  decisionImage.addEventListener("load", () => {
    setStatus(imageStatus, "", false);
  });

  init();
})();

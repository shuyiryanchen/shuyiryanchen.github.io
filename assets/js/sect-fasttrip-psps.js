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
  const resetPart1Button = document.getElementById("reset-part1");

  const imageStatus = document.getElementById("image-status");
  const imageParams = document.getElementById("image-params");
  const decisionImage = document.getElementById("decision-image");
  const resetPart2Button = document.getElementById("reset-part2");

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
    C_budget_multiplier: "Sect. budget (ratio of circuits)",
    K_groups: "Number of groups",
    W_cap: "Reliability constraint (absolute)",
    W_cap_multiplier: "Reliability constraint (ratio of pop.)",
    alpha: "FWER",
    effective_alpha: "Effectiveness of fast-trip",
    gamma_i_multiplier: "Fast-trip average reliability cost",
    grouping_method: "Declustering method",
    ignitions: "Ignitions",
    mht_method: "Decluster + MHT method"
  };

  const yMetricOptions = [
    { key: "opt_cost", label: "Worst Case Cost", type: "direct" },
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
  const userSelected = new Set();

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

    base = base
      .replace(/_with_hftd/g, "")
      .replace(/_with_inset/g, "")
      .replace(/_no_inset/g, "");

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
    if (suffix.hftd && suffix.inset) return "HFTD + Inset";
    if (suffix.hftd) return "HFTD";
    if (suffix.inset) return "Inset";
    return "None";
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

    const availableMetricOptions = yMetricOptions.filter((metric) => {
      if (metric.type === "direct") {
        return columns.includes(metric.key);
      }
      if (metric.type === "ratio") {
        return columns.includes(metric.numerator) && columns.includes(metric.denominator);
      }
      return false;
    });

    availableMetricOptions.forEach((metric) => {
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

    const leftDefault =
      availableMetricOptions.find((metric) => metric.key === "opt_cost") ||
      availableMetricOptions[0];
    const rightDefault =
      availableMetricOptions.find((metric) => metric.key === "true_cost") ||
      availableMetricOptions[1] ||
      availableMetricOptions[0];

    if (leftDefault) yAxisLeftSelect.value = leftDefault.key;
    if (rightDefault) yAxisRightSelect.value = rightDefault.key;
  };

  const getCurrentFilters = () => {
    const filters = {};
    filterControls.querySelectorAll("select").forEach((select) => {
      if (select.value) {
        filters[select.dataset.param] = select.value;
      }
    });
    return filters;
  };

  const buildFilterControls = () => {
    filterControls.innerHTML = "";
    const xAxis = xAxisSelect.value;
    const currentFilters = getCurrentFilters();

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

        const filteredRows = dataset.filter((row) =>
          Object.entries(currentFilters).every(([key, value]) => {
            if (key === param) return true;
            return String(row[key]) === value;
          })
        );

        getUniqueValues(filteredRows, param).forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          select.appendChild(option);
        });

        select.addEventListener("change", renderPlot);
        if (currentFilters[param]) {
          select.value = currentFilters[param];
          if (select.value !== currentFilters[param]) {
            select.value = "";
          }
        }
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

    const filters = getCurrentFilters();

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

  const requiredSliderParams = new Set([
    "B_budget_multiplier",
    "C_budget_multiplier",
    "effective_alpha",
    "gamma_i_multiplier",
    "W_cap_multiplier"
  ]);

  const getFilteredImageMeta = (excludeParam) => {
    return imageMeta.filter((meta) => {
      if (excludeParam !== "suffix" && userSelected.has("suffix")) {
        if (getSuffixKey(meta.suffix) !== imageSelection.suffix) return false;
      }

      return Object.entries(imageSelection).every(([key, value]) => {
        if (key === "suffix" || key === excludeParam) return true;
        if (!userSelected.has(key)) return true;
        if (value === undefined || value === null || value === "") return true;
        if (key === "B_budget" || key === "C_budget" || key === "W_cap") return true;
        return String(meta.params[key]) === String(value);
      });
    });
  };

  const getImageValues = (param) => {
    return imageMeta
      .map((meta) => meta.params[param])
      .filter((value) => value !== undefined && value !== "");
  };

  const getMetaForSelection = (selection, excludeParam) => {
    return imageMeta.filter((meta) => {
      if (excludeParam !== "suffix" && selection.suffix) {
        if (getSuffixKey(meta.suffix) !== selection.suffix) return false;
      }
      return Object.entries(selection).every(([key, value]) => {
        if (key === "suffix" || key === excludeParam) return true;
        if (value === undefined || value === null || value === "") return true;
        if (key === "B_budget" || key === "C_budget" || key === "W_cap") return true;
        return String(meta.params[key]) === String(value);
      });
    });
  };

  const buildImageControls = () => {
    imageParams.innerHTML = "";
    const previousSelection = { ...imageSelection };
    const workingSelection = { suffix: imageSelection.suffix || "" };
    const excludedImageParams = new Set(["B_budget", "C_budget", "W_cap"]);
    const imageParamSet = new Set();
    imageMeta.forEach((meta) => {
      Object.keys(meta.params || {}).forEach((key) => {
        if (!excludedImageParams.has(key)) {
          imageParamSet.add(key);
        }
      });
    });

    const preferredOrder = [
      "mht_method",
      "K_groups",
      "alpha",
      "B_budget_multiplier",
      "C_budget_multiplier",
      "W_cap_multiplier",
      "effective_alpha",
      "gamma_i_multiplier"
    ];

    const orderedParams = [
      ...preferredOrder.filter((param) => imageParamSet.has(param)),
      ...Array.from(imageParamSet)
        .filter((param) => !preferredOrder.includes(param))
        .sort()
    ];
    const selectControls = [];
    const sliderControls = [];

    const suffixControl = buildSuffixControl(previousSelection);
    if (suffixControl) {
      selectControls.push(suffixControl);
      workingSelection.suffix = imageSelection.suffix;
    }

    orderedParams.forEach((param) => {
      const wrapper = document.createElement("div");
      wrapper.className = "sfps-field";
      const label = document.createElement("label");
      label.textContent = getLabel(param);

      const values = getImageValues(param);

      const uniqueValues = Array.from(new Set(values));
      if (!uniqueValues.length) return;

      const numericValues = uniqueValues.filter((val) => !Number.isNaN(Number(val)));
      const allNumeric = numericValues.length === uniqueValues.length;
      const sortedValues = allNumeric
        ? uniqueValues.sort((a, b) => Number(a) - Number(b))
        : uniqueValues.sort();

      const defaultValue = sortedValues[0];
      if (requiredSliderParams.has(param) || (allNumeric && sortedValues.length > 1)) {
        const preferredValue =
          previousSelection[param] && sortedValues.includes(previousSelection[param])
            ? previousSelection[param]
            : defaultValue;
        const preferredIndex = Math.max(0, sortedValues.indexOf(preferredValue));
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = String(Math.max(sortedValues.length - 1, 0));
        slider.step = "1";
        slider.value = String(preferredIndex);
        slider.dataset.param = param;
        slider.dataset.values = JSON.stringify(sortedValues);
        const updateSliderFill = () => {
          const max = Number(slider.max) || 0;
          const val = Number(slider.value) || 0;
          const percent = max ? (val / max) * 100 : 0;
          slider.style.setProperty("--value", `${percent}%`);
        };
        updateSliderFill();

        const valueDisplay = document.createElement("div");
        valueDisplay.className = "sfps-status sfps-slider-value";
        valueDisplay.textContent = preferredValue;
        valueDisplay.dataset.param = param;

        slider.addEventListener("input", () => {
          const list = JSON.parse(slider.dataset.values || "[]");
          const current = list[Number(slider.value)] ?? "";
          valueDisplay.textContent = current;
          imageSelection[param] = current;
          if (current === defaultValue) {
            userSelected.delete(param);
          } else {
            userSelected.add(param);
          }
          updateSliderFill();
          renderImage();
        });
        slider.addEventListener("change", () => {
          updateSliderFill();
          renderImage();
        });

        wrapper.appendChild(label);
        wrapper.appendChild(slider);
        wrapper.appendChild(valueDisplay);
        sliderControls.push(wrapper);
        imageSelection[param] = preferredValue;
        workingSelection[param] = preferredValue;
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

        const preferredValue =
          previousSelection[param] && sortedValues.includes(previousSelection[param])
            ? previousSelection[param]
            : defaultValue;
        input.value = preferredValue;
        input.addEventListener("change", () => {
          imageSelection[param] = input.value;
          if (input.value === defaultValue) {
            userSelected.delete(param);
          } else {
            userSelected.add(param);
          }
          renderImage();
        });
        wrapper.appendChild(label);
        wrapper.appendChild(input);
        selectControls.push(wrapper);
        imageSelection[param] = preferredValue;
        workingSelection[param] = preferredValue;
      }
    });

    selectControls.forEach((node) => imageParams.appendChild(node));
    sliderControls.forEach((node) => imageParams.appendChild(node));
  };

  const buildSuffixControl = (previousSelection) => {
    const filtered = getFilteredImageMeta("suffix");
    const source = filtered.length ? filtered : imageMeta;
    const options = Array.from(
      new Map(
        source.map((meta) => {
          const key = getSuffixKey(meta.suffix);
          return [key, { key, label: getSuffixLabel(meta.suffix) }];
        })
      ).values()
    );

    if (!options.length) return null;

    const label = document.createElement("label");
    label.setAttribute("for", "image-suffix");
    label.textContent = "Layer option";

    const select = document.createElement("select");
    select.id = "image-suffix";
    options.forEach((suffix) => {
      const option = document.createElement("option");
      option.value = suffix.key;
      option.textContent = suffix.label;
      select.appendChild(option);
    });

    const defaultOption =
      options.find((option) => option.key === "with_hftd_with_inset") || options[0];
    const preferredSuffix =
      previousSelection?.suffix && options.some((option) => option.key === previousSelection.suffix)
        ? previousSelection.suffix
        : defaultOption.key;
    imageSelection.suffix = preferredSuffix;
    select.value = imageSelection.suffix;
    userSelected.add("suffix");
    select.addEventListener("change", () => {
      imageSelection.suffix = select.value;
      userSelected.add("suffix");
      buildImageControls();
      renderImage();
    });

    const wrapper = document.createElement("div");
    wrapper.className = "sfps-field";
    wrapper.appendChild(label);
    wrapper.appendChild(select);
    return wrapper;
  };

  const renderImage = () => {
    if (!imageMeta.length) {
      setStatus(imageStatus, "No plot images available.", true);
      return;
    }

    const matches = imageMeta.filter((meta) => {
      const metaSuffixKey = getSuffixKey(meta.suffix);
      if (metaSuffixKey !== imageSelection.suffix) return false;

      return Object.entries(imageSelection).every(([key, value]) => {
        if (key === "suffix") return true;
        if (value === undefined || value === null || value === "") return true;
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

  const fetchManifest = async () => {
    const cacheBustUrl = `${manifestUrl}?t=${Date.now()}`;
    const response = await fetch(cacheBustUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("No manifest.");
    return await response.json();
  };

  const refreshImageMeta = async () => {
    const manifest = await fetchManifest();
    const images = manifest.images || manifest.imageFiles || [];
    imageMeta = images.map(parseImageName).filter(Boolean);
  };

  const init = async () => {
    try {
      const manifest = await fetchManifest();
      defaultCsvFile = (manifest.csvFiles || [])[0] || "";
      const images = manifest.images || manifest.imageFiles || [];
      imageMeta = images.map(parseImageName).filter(Boolean);

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
  resetPart1Button.addEventListener("click", () => {
    buildAxisSelects();
    filterControls.querySelectorAll("select").forEach((select) => {
      select.value = "";
    });
    buildFilterControls();
    renderPlot();
  });
  resetPart2Button.addEventListener("click", async () => {
    imageSelection = { suffix: "" };
    userSelected.clear();
    try {
      await refreshImageMeta();
    } catch (error) {
      // ignore refresh failures, keep existing options
    }
    buildImageControls();
    renderImage();
  });
  decisionImage.addEventListener("error", () => {
    setStatus(imageStatus, "Image failed to load. Check the path.", true);
  });
  decisionImage.addEventListener("load", () => {
    setStatus(imageStatus, "", false);
  });

  init();
})();

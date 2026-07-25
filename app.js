/* ==============================================================
   EXPLAINABLE BI DASHBOARD — APPLICATION LOGIC
   Causal Retention Optimizer | Plotly.js Charts
   ============================================================== */

// ---- CONSTANTS ----
const COLORS = {
    persuadables: '#10b981',
    sureThings:   '#3b82f6',
    lostCauses:   '#ef4444',
    sleepingDogs: '#f59e0b',
    accent:       '#3b82f6',
    positive:     '#10b981',
    negative:     '#ef4444',
};

const SEG_COLOR_MAP = {
    'Persuadables':  COLORS.persuadables,
    'Sure Things':   COLORS.sureThings,
    'Lost Causes':   COLORS.lostCauses,
    'Sleeping Dogs': COLORS.sleepingDogs,
};

const PLOTLY_LAYOUT = {
    paper_bgcolor: 'transparent',
    plot_bgcolor:  'rgba(15, 23, 42, 0.35)',
    font: { color: '#94a3b8', family: 'Inter, sans-serif', size: 12 },
    margin: { t: 44, r: 16, b: 48, l: 56 },
    xaxis: { gridcolor: 'rgba(148,163,184,0.08)', zerolinecolor: 'rgba(148,163,184,0.15)' },
    yaxis: { gridcolor: 'rgba(148,163,184,0.08)', zerolinecolor: 'rgba(148,163,184,0.15)' },
    legend: { font: { size: 11 }, bgcolor: 'rgba(15,23,42,0.6)' },
    hoverlabel: { bgcolor: '#1e293b', font: { family: 'Inter', size: 12, color: '#f1f5f9' } },
};

const PLOTLY_CONFIG = { responsive: true, displayModeBar: false };

// ---- STATE ----
const state = {
    raw: [],            // all employee records
    filtered: [],       // after department filter
    kpis: {},
    shapImportance: [],
    segmentProfiles: {},
    classifiers: {},
    fairness: {},
    decileAnalysis: [],
    departments: [],
    selectedDepts: new Set(),
    cateThreshold: -0.07,
    replacementCostMult: 1.5,
    interventionCost: 2500,
    activeTab: 'segmentation',
};

// ---- DATA LOADING ----
async function loadData() {
    try {
        const resp = await fetch('data/dashboard_data.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        state.raw = data.employees;
        state.kpis = data.kpis;
        state.shapImportance = data.shapImportance;
        state.segmentProfiles = data.segmentProfiles;
        state.classifiers = data.classifiers;
        state.fairness = data.fairness;
        state.decileAnalysis = data.decileAnalysis || [];
        // Unique departments
        state.departments = [...new Set(state.raw.map(e => e.Department))].sort();
        state.selectedDepts = new Set(state.departments);
        return true;
    } catch (err) {
        console.error('Failed to load data:', err);
        document.getElementById('loading-overlay').innerHTML =
            '<p style="color:#ef4444;">Error loading data. Run <code>python preprocess.py</code> first.</p>';
        return false;
    }
}

// ---- INITIALISATION ----
async function init() {
    const ok = await loadData();
    if (!ok) return;
    initSidebar();
    initTabs();
    applyFilters();
    document.getElementById('loading-overlay').classList.add('hidden');

    // Sidebar drawer toggle
    const btn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');

    // Create overlay backdrop
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebar-overlay';
    document.body.appendChild(overlay);

    // Create close button inside sidebar
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sidebar-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.setAttribute('aria-label', 'Close sidebar');
    sidebar.insertBefore(closeBtn, sidebar.firstChild);

    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    btn.addEventListener('click', openSidebar);
    closeBtn.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });
}

// ---- SIDEBAR SETUP ----
function initSidebar() {
    // Department checkboxes
    const container = document.getElementById('dept-filters');
    container.innerHTML = '';
    state.departments.forEach(dept => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.innerHTML = `<input type="checkbox" checked data-dept="${dept}"><span>${dept}</span>`;
        label.querySelector('input').addEventListener('change', e => {
            if (e.target.checked) state.selectedDepts.add(dept);
            else state.selectedDepts.delete(dept);
            applyFilters();
        });
        container.appendChild(label);
    });

    // Replacement cost slider
    const rcSlider = document.getElementById('replacement-cost');
    const rcVal = document.getElementById('rc-value');
    rcSlider.addEventListener('input', () => {
        state.replacementCostMult = parseFloat(rcSlider.value);
        rcVal.textContent = state.replacementCostMult.toFixed(1) + '×';
        updateKPIs();
        if (state.activeTab === 'roi') renderROI();
    });

    // Intervention cost slider
    const icSlider = document.getElementById('intervention-cost');
    const icVal = document.getElementById('ic-value');
    icSlider.addEventListener('input', () => {
        state.interventionCost = parseInt(icSlider.value);
        icVal.textContent = '$' + state.interventionCost.toLocaleString();
        updateKPIs();
        if (state.activeTab === 'roi') renderROI();
    });

    // CATE threshold slider
    const ctSlider = document.getElementById('cate-threshold');
    const ctVal = document.getElementById('cate-value');
    ctSlider.addEventListener('input', () => {
        state.cateThreshold = parseFloat(ctSlider.value);
        ctVal.textContent = state.cateThreshold.toFixed(2);
        updateKPIs();
        if (state.activeTab === 'roi') renderROI();
        if (state.activeTab === 'governance') renderGovernance();
    });
}

// ---- TAB MANAGEMENT ----
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + tab).classList.add('active');
            state.activeTab = tab;
            renderActiveTab();
        });
    });

    // Employee select handler (Tab 3)
    document.getElementById('emp-select').addEventListener('change', renderSHAPEmployee);
    // Audit attribute handler (Tab 4)
    document.getElementById('audit-attr-select').addEventListener('change', renderGovernance);
}

// ---- FILTERING ----
function applyFilters() {
    state.filtered = state.raw.filter(e => state.selectedDepts.has(e.Department));
    updateKPIs();
    renderActiveTab();
    populateEmployeeSelect();
}

function populateEmployeeSelect() {
    const sel = document.getElementById('emp-select');
    const prev = sel.value;
    sel.innerHTML = '';
    state.filtered.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.EmployeeID;
        opt.textContent = `EMP-${e.EmployeeID}`;
        sel.appendChild(opt);
    });
    if (prev && state.filtered.some(e => String(e.EmployeeID) === prev)) {
        sel.value = prev;
    }
}

// ---- KPI CALCULATION ----
function updateKPIs() {
    const f = state.filtered;
    const n = f.length;
    const targeted = f.filter(e => e.CATE_XLearner <= state.cateThreshold);
    const nTargeted = targeted.length;

    const avgSalary = f.reduce((s, e) => s + e.MonthlyIncome, 0) / (n || 1) * 12;
    const costPerTurnover = avgSalary * state.replacementCostMult;
    const totalSpend = nTargeted * state.interventionCost;
    const retainedStaff = targeted.reduce((s, e) => s + Math.abs(e.CATE_XLearner), 0);
    const grossSavings = retainedStaff * costPerTurnover;
    const netSavings = grossSavings - totalSpend;
    const roi = totalSpend > 0 ? (netSavings / totalSpend * 100) : 0;

    // Store for ROI tab
    state._nTargeted = nTargeted;
    state._totalSpend = totalSpend;
    state._netSavings = netSavings;
    state._roi = roi;
    state._retainedStaff = retainedStaff;
    state._costPerTurnover = costPerTurnover;

    // Render KPI cards
    document.getElementById('kpi-workforce-val').textContent = n.toLocaleString();

    document.getElementById('kpi-targeted-val').textContent = nTargeted.toLocaleString();
    const targetDelta = document.getElementById('kpi-targeted-delta');
    targetDelta.textContent = `${(nTargeted / (n || 1) * 100).toFixed(1)}% of total`;
    targetDelta.className = 'kpi-delta';

    document.getElementById('kpi-spend-val').textContent = '$' + totalSpend.toLocaleString(undefined, {maximumFractionDigits: 0});

    const savingsEl = document.getElementById('kpi-savings-val');
    savingsEl.textContent = '$' + Math.round(netSavings).toLocaleString();
    const savingsDelta = document.getElementById('kpi-savings-delta');
    savingsDelta.textContent = `${roi.toFixed(1)}% ROI`;
    savingsDelta.className = 'kpi-delta ' + (netSavings >= 0 ? 'positive' : 'negative');

    document.getElementById('kpi-retained-val').textContent = retainedStaff.toFixed(1) + ' FTEs';
}

// ---- RENDER DISPATCHER ----
function renderActiveTab() {
    switch (state.activeTab) {
        case 'segmentation': renderSegmentation(); break;
        case 'roi':          renderROI();           break;
        case 'shap':         renderSHAP();          break;
        case 'governance':   renderGovernance();     break;
    }
}

// ==============================================================
// TAB 1: BEHAVIORAL SEGMENTATION
// ==============================================================
function renderSegmentation() {
    const f = state.filtered;

    // ---- Scatter Plot ----
    const segNames = ['Persuadables', 'Sure Things', 'Lost Causes', 'Sleeping Dogs'];
    const traces = segNames.map(seg => {
        const subset = f.filter(e => e.Segment === seg);
        return {
            x: subset.map(e => e.BaselineRisk),
            y: subset.map(e => e.CATE_XLearner),
            mode: 'markers',
            type: 'scatter',
            name: `${seg} (${subset.length})`,
            marker: { color: SEG_COLOR_MAP[seg], size: 5, opacity: 0.65 },
            text: subset.map(e => `EMP-${e.EmployeeID}<br>${e.Department}<br>Income: $${e.MonthlyIncome.toLocaleString()}`),
            hoverinfo: 'text+name',
        };
    });

    const scatterLayout = {
        ...PLOTLY_LAYOUT,
        title: { text: 'Prescriptive Workforce Archetype Matrix', font: { size: 14, color: '#e2e8f0' } },
        xaxis: { ...PLOTLY_LAYOUT.xaxis, title: 'Baseline Attrition Probability P(Y₀=1|X)' },
        yaxis: { ...PLOTLY_LAYOUT.yaxis, title: 'CATE Uplift Score τ̂(X) [Negative = Reduces Churn]' },
        shapes: [
            { type: 'line', x0: 0.5, y0: -0.8, x1: 0.5, y1: 0.6, line: { dash: 'dash', color: 'rgba(148,163,184,0.4)', width: 1 } },
            { type: 'line', x0: 0, y0: 0, x1: 1, y1: 0, line: { dash: 'dash', color: 'rgba(148,163,184,0.4)', width: 1 } },
        ],
        height: 450,
    };
    Plotly.newPlot('scatter-chart', traces, scatterLayout, PLOTLY_CONFIG);

    // ---- Pie Chart ----
    const segCounts = {};
    segNames.forEach(s => { segCounts[s] = f.filter(e => e.Segment === s).length; });

    const pieTrace = {
        labels: segNames,
        values: segNames.map(s => segCounts[s]),
        type: 'pie',
        hole: 0.45,
        marker: { colors: segNames.map(s => SEG_COLOR_MAP[s]) },
        textinfo: 'label+percent',
        textfont: { size: 11, color: '#e2e8f0' },
        hoverinfo: 'label+value+percent',
    };
    const pieLayout = { ...PLOTLY_LAYOUT, height: 260, margin: { t: 10, r: 10, b: 10, l: 10 }, showlegend: false };
    Plotly.newPlot('pie-chart', [pieTrace], pieLayout, PLOTLY_CONFIG);

    // ---- Segment Table ----
    const tableContainer = document.getElementById('segment-table-container');
    if (state.segmentProfiles) {
        let html = '<table><thead><tr><th>Segment</th><th>Count</th><th>%</th><th>Mean CATE</th><th>Action</th></tr></thead><tbody>';
        segNames.forEach(seg => {
            const p = state.segmentProfiles[seg];
            if (!p) return;
            const dotColor = SEG_COLOR_MAP[seg];
            html += `<tr>
                <td><span class="seg-dot" style="background:${dotColor}"></span>${seg}</td>
                <td>${segCounts[seg]}</td>
                <td>${(segCounts[seg] / (f.length || 1) * 100).toFixed(1)}%</td>
                <td>${p.meanCATE.toFixed(4)}</td>
                <td style="font-size:0.72rem">${p.action}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        tableContainer.innerHTML = html;
    }
}

// ==============================================================
// TAB 2: FINANCIAL ROI
// ==============================================================
function renderROI() {
    const f = state.filtered;
    const thresholds = [];
    for (let t = -0.40; t <= 0.001; t += 0.01) thresholds.push(parseFloat(t.toFixed(2)));

    const netSavings = [];
    const rois = [];
    const targeted = [];

    thresholds.forEach(t => {
        const mask = f.filter(e => e.CATE_XLearner <= t);
        const nT = mask.length;
        const spend = nT * state.interventionCost;
        const retained = mask.reduce((s, e) => s + Math.abs(e.CATE_XLearner), 0);
        const gross = retained * state._costPerTurnover;
        const net = gross - spend;
        const roi = spend > 0 ? (net / spend * 100) : 0;
        netSavings.push(net);
        rois.push(roi);
        targeted.push(nT);
    });

    // Net Savings chart
    const netTrace = {
        x: thresholds, y: netSavings, type: 'scatter', mode: 'lines+markers',
        marker: { size: 4, color: COLORS.accent }, line: { color: COLORS.accent, width: 2 },
        name: 'Net Savings',
    };
    const netLayout = {
        ...PLOTLY_LAYOUT, height: 420,
        title: { text: 'Net Financial Savings ($ USD) vs. CATE Threshold', font: { size: 13, color: '#e2e8f0' } },
        xaxis: { ...PLOTLY_LAYOUT.xaxis, title: 'CATE Decision Cutoff (τ_min)' },
        yaxis: { ...PLOTLY_LAYOUT.yaxis, title: 'Net Financial Savings ($ USD)' },
        shapes: [{
            type: 'line', x0: state.cateThreshold, y0: Math.min(...netSavings),
            x1: state.cateThreshold, y1: Math.max(...netSavings),
            line: { color: '#ef4444', width: 2, dash: 'dot' },
        }],
        annotations: [{
            x: state.cateThreshold, y: Math.max(...netSavings) * 0.9,
            text: 'Selected', showarrow: true, arrowhead: 2,
            font: { color: '#ef4444', size: 11 }, arrowcolor: '#ef4444',
        }],
    };
    Plotly.newPlot('net-savings-chart', [netTrace], netLayout, PLOTLY_CONFIG);

    // ROI chart
    const roiTrace = {
        x: thresholds, y: rois, type: 'scatter', mode: 'lines+markers',
        marker: { size: 4, color: COLORS.persuadables }, line: { color: COLORS.persuadables, width: 2 },
        name: 'ROI %',
    };
    const roiLayout = {
        ...PLOTLY_LAYOUT, height: 420,
        title: { text: 'Policy ROI (%) vs. CATE Threshold', font: { size: 13, color: '#e2e8f0' } },
        xaxis: { ...PLOTLY_LAYOUT.xaxis, title: 'CATE Decision Cutoff (τ_min)' },
        yaxis: { ...PLOTLY_LAYOUT.yaxis, title: 'Return on Investment (%)' },
        shapes: [{
            type: 'line', x0: state.cateThreshold, y0: Math.min(...rois),
            x1: state.cateThreshold, y1: Math.max(...rois),
            line: { color: '#ef4444', width: 2, dash: 'dot' },
        }],
        annotations: [{
            x: state.cateThreshold, y: Math.max(...rois) * 0.9,
            text: 'Selected', showarrow: true, arrowhead: 2,
            font: { color: '#ef4444', size: 11 }, arrowcolor: '#ef4444',
        }],
    };
    Plotly.newPlot('roi-chart', [roiTrace], roiLayout, PLOTLY_CONFIG);
}

// ==============================================================
// TAB 3: SHAP EXPLAINABILITY
// ==============================================================
function renderSHAP() {
    renderSHAPEmployee();
}

function renderSHAPEmployee() {
    const empId = document.getElementById('emp-select').value;
    const emp = state.filtered.find(e => String(e.EmployeeID) === empId);
    if (!emp) return;

    // Employee profile KPIs
    document.getElementById('emp-id').textContent = 'EMP-' + emp.EmployeeID;
    document.getElementById('emp-risk').textContent = emp.BaselineRisk.toFixed(3);
    document.getElementById('emp-cate').textContent = emp.CATE_XLearner.toFixed(3);
    const segEl = document.getElementById('emp-segment');
    segEl.textContent = emp.Segment;
    segEl.style.color = SEG_COLOR_MAP[emp.Segment] || '#e2e8f0';

    // SHAP bar chart
    const shapFeatures = [
        'MonthlyIncome', 'TotalWorkingYears', 'Age', 'WorkLifeBalance',
        'DistanceFromHome', 'OverTime', 'StockOptionLevel', 'YearsAtCompany'
    ];
    const shapData = shapFeatures.map(f => ({
        feature: f.replace(/([A-Z])/g, ' $1').trim(),
        value: emp['SHAP_' + f] || 0,
    })).sort((a, b) => a.value - b.value);

    const barColors = shapData.map(d => d.value >= 0 ? '#ef4444' : '#10b981');

    const barTrace = {
        y: shapData.map(d => d.feature),
        x: shapData.map(d => d.value),
        type: 'bar',
        orientation: 'h',
        marker: { color: barColors, opacity: 0.85 },
        hoverinfo: 'x+y',
    };
    const barLayout = {
        ...PLOTLY_LAYOUT, height: 360,
        title: { text: `SHAP Driver Attribution for EMP-${emp.EmployeeID}`, font: { size: 13, color: '#e2e8f0' } },
        xaxis: { ...PLOTLY_LAYOUT.xaxis, title: 'SHAP Value (Impact on CATE)' },
        yaxis: { ...PLOTLY_LAYOUT.yaxis, automargin: true },
        margin: { ...PLOTLY_LAYOUT.margin, l: 130 },
    };
    Plotly.newPlot('shap-bar-chart', [barTrace], barLayout, PLOTLY_CONFIG);
}

// ==============================================================
// TAB 4: GOVERNANCE & EEOC AUDIT
// ==============================================================
function renderGovernance() {
    const f = state.filtered;
    const attr = document.getElementById('audit-attr-select').value;

    // Compute selection rates per group
    const groups = {};
    f.forEach(e => {
        const key = e[attr] || 'Unknown';
        if (!groups[key]) groups[key] = { total: 0, selected: 0 };
        groups[key].total++;
        if (e.CATE_XLearner <= state.cateThreshold) groups[key].selected++;
    });

    const groupNames = Object.keys(groups).sort();
    const selectionRates = groupNames.map(g => groups[g].total > 0 ? groups[g].selected / groups[g].total : 0);
    const maxRate = Math.max(...selectionRates, 0.001);
    const dirs = selectionRates.map(r => r / maxRate);
    const compliant = dirs.map(d => d >= 0.80);

    // Selection Rate chart
    const srTrace = {
        x: groupNames, y: selectionRates, type: 'bar',
        marker: { color: groupNames.map((_, i) => ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]) },
        text: selectionRates.map(r => (r * 100).toFixed(1) + '%'),
        textposition: 'outside',
        textfont: { color: '#94a3b8', size: 11 },
        hoverinfo: 'x+y',
    };
    const srLayout = {
        ...PLOTLY_LAYOUT, height: 380,
        title: { text: `Intervention Selection Rate by ${attr}`, font: { size: 13, color: '#e2e8f0' } },
        xaxis: { ...PLOTLY_LAYOUT.xaxis, title: attr },
        yaxis: { ...PLOTLY_LAYOUT.yaxis, title: 'Selection Rate', tickformat: '.0%' },
    };
    Plotly.newPlot('selection-rate-chart', [srTrace], srLayout, PLOTLY_CONFIG);

    // DIR chart
    const dirTrace = {
        x: groupNames, y: dirs, type: 'bar',
        marker: { color: compliant.map(c => c ? '#10b981' : '#ef4444') },
        text: dirs.map(d => d.toFixed(2)),
        textposition: 'outside',
        textfont: { color: '#94a3b8', size: 11 },
        hoverinfo: 'x+y',
    };
    const dirLayout = {
        ...PLOTLY_LAYOUT, height: 380,
        title: { text: `Disparate Impact Ratio (DIR) vs. EEOC 0.80 Threshold`, font: { size: 13, color: '#e2e8f0' } },
        xaxis: { ...PLOTLY_LAYOUT.xaxis, title: attr },
        yaxis: { ...PLOTLY_LAYOUT.yaxis, title: 'Disparate Impact Ratio' },
        shapes: [{
            type: 'line', x0: -0.5, y0: 0.80, x1: groupNames.length - 0.5, y1: 0.80,
            line: { color: '#ef4444', width: 2, dash: 'dash' },
        }],
        annotations: [{
            x: groupNames.length - 1, y: 0.80,
            text: 'EEOC 80% Threshold', showarrow: false,
            font: { color: '#ef4444', size: 10 }, yshift: 12,
        }],
    };
    Plotly.newPlot('dir-chart', [dirTrace], dirLayout, PLOTLY_CONFIG);

    // Fairness table
    const tableContainer = document.getElementById('fairness-table-container');
    let html = '<table><thead><tr><th>Group</th><th>Total</th><th>Selected</th><th>Selection Rate</th><th>DIR</th><th>EEOC Compliant</th></tr></thead><tbody>';
    groupNames.forEach((g, i) => {
        const sr = selectionRates[i];
        const dir = dirs[i];
        const comp = compliant[i];
        html += `<tr>
            <td>${g}</td>
            <td>${groups[g].total}</td>
            <td>${groups[g].selected}</td>
            <td>${(sr * 100).toFixed(2)}%</td>
            <td>${dir.toFixed(2)}</td>
            <td class="${comp ? 'compliant' : 'non-compliant'}">${comp ? '✓ Yes' : '✗ No'}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    tableContainer.innerHTML = html;
}

// ---- LAUNCH ----
document.addEventListener('DOMContentLoaded', init);

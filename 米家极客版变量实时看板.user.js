// ==UserScript==
// @name         米家极客版变量实时看板
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  拖拽缩放+手动列数/字体+主题切换+搜索过滤+自动化名称标注
// @author       嗜血星空earth
// @match        http://192.168.*/*
// @match        http://*/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    let lastValueMap = {};
    let changedCellSet = new Set();
    let panelVisible = false;

    let manualColumnCount = null;
    let baseFontSize = 12;
    let isDarkTheme = true;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initLeft = 0, initTop = 0;

    let isResizeBL = false;
    let isResizeBR = false;
    let resizeStartX = 0, resizeStartY = 0;
    let initW = 0, initH = 0;
    let initPanelLeft = 0;

    const MIN_W = 400;
    const MIN_H = 300;
    const MIN_COL = 1;
    const MAX_COL = 12;
    const MIN_FONT = 10;
    const MAX_FONT = 20;

    let searchKeyword = '';

    // 主题色
    const themeColor = {
        dark: {
            panelBg: "#1f2937",
            border: "#444",
            titleBarBg: "#2d3748",
            titleText: "#fff",
            resizeBg: "#4a5568",
            cellBorder: "#555",
            text: "#fff",
            emptyText: "#888",
            changeBg: "#4b2828",
            headBg: "#334",
            titleMark: "#73c0ff",
            automationText: "#9ca3af" // 自动化名称灰色
        },
        light: {
            panelBg: "#ffffff",
            border: "#ddd",
            titleBarBg: "#f5f5f5",
            titleText: "#333",
            resizeBg: "#eee",
            cellBorder: "#ddd",
            text: "#333",
            emptyText: "#aaa",
            changeBg: "#ffebee",
            headBg: "#f0f0f0",
            titleMark: "#0066cc",
            automationText: "#666666"
        }
    };

    // 缓存：自动化列表 + 名称映射
    let ruleListCache = [];
    let ruleNameMap = {};

    function getAutoColumnCount() {
        if (manualColumnCount !== null) return manualColumnCount;
        const panelW = panel ? panel.offsetWidth : window.innerWidth;
        if (panelW < 500) return 2;
        if (panelW < 800) return 4;
        if (panelW < 1200) return 6;
        return 8;
    }

    function getInitialPanelSize() {
        const w = Math.max(MIN_W, Math.floor(window.innerWidth * 1.0));
        const h = Math.max(MIN_H, Math.floor(window.innerHeight * 0.93));
        const left = Math.floor((window.innerWidth - w) / 2);
        const top = Math.floor((window.innerHeight - h)/10);
        return { w, h, left, top };
    }

    // ==============================================
    // 【新增】获取所有自动化列表（用于名称映射）
    // ==============================================
    function loadRuleList(callback) {
        const win = unsafeWindow;
        if (!win.editor || !win.editor.gateway) {
            ruleListCache = [];
            ruleNameMap = {};
            callback();
            return;
        }
        win.editor.gateway.callAPI("getGraphList", {}, (res) => {
            ruleListCache = res || [];
            ruleNameMap = {};
            ruleListCache.forEach(rule => {
                if (rule.id && rule.userData?.name) {
                    ruleNameMap[rule.id] = rule.userData.name;
                }
            });
            callback();
        });
    }

    // ==============================================
    // 【新增】scope 转中文自动化名称
    // ==============================================
    function getScopeDisplayName(scope) {
        if (scope === "global") return "全局变量";
        if (!scope.startsWith("R")) return scope;
        const ruleId = scope.replace("R", "");
        return ruleNameMap[ruleId] || "未知自动化";
    }

    // ==============================================
    // 原获取变量逻辑（增加自动化名称字段）
    // ==============================================
    function getOfficialGlobalVars(callback) {
        const win = unsafeWindow;
        if (!win.editor || !win.editor.gateway) {
            callback([]);
            return;
        }
        win.editor.gateway.callAPI("getVarScopeList", {}, function (scopesData) {
            const scopes = scopesData?.scopes || [];
            const varArray = [];
            let count = 0;
            scopes.forEach(scope => {
                count++;
                win.editor.gateway.callAPI("getVarList", { scope: scope }, function (varList) {
                    for (const vid in varList) {
                        const v = varList[vid];
                        varArray.push({
                            scope: scope,
                            name: v.userData.name,
                            value: v.value,
                            type: v.type,
                            key: scope + "_" + v.userData.name,
                            automationName: getScopeDisplayName(scope)
                        });
                    }
                    count--;
                    if (count === 0) callback(varArray);
                });
            });
            if (count === 0) callback(varArray);
        });
    }

    let panel = null, btn = null, isShow = false;
    let titleBar = null, resizeBL = null, resizeBR = null;
    let searchInput = null;
    let btnWrap;
    let controlBtns = [];

    function createUI() {
        if (typeof document === 'undefined') return;

        btnWrap = document.createElement('div');
        btnWrap.style.cssText = `
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 99999999;
            display: flex;
            gap: 6px;
            align-items: center;
        `;

        btn = document.createElement('button');
        btn.innerText = "变量看板";
        btn.style.cssText = `
            padding: 8px 10px;
            background: #1677ff;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            user-select: none;
        `;

        const btnColAdd = document.createElement('button');
        btnColAdd.innerText = "列数+";
        btnColAdd.style.cssText = btn.style.cssText;
        btnColAdd.style.display = "none";
        btnColAdd.onclick = () => {
            manualColumnCount = Math.min((manualColumnCount || getAutoColumnCount()) + 1, MAX_COL);
            refreshVars();
        };

        const btnColSub = document.createElement('button');
        btnColSub.innerText = "列数-";
        btnColSub.style.cssText = btn.style.cssText;
        btnColSub.style.display = "none";
        btnColSub.onclick = () => {
            manualColumnCount = Math.max((manualColumnCount || getAutoColumnCount()) - 1, MIN_COL);
            refreshVars();
        };

        const btnFontAdd = document.createElement('button');
        btnFontAdd.innerText = "字体+";
        btnFontAdd.style.cssText = btn.style.cssText;
        btnFontAdd.style.display = "none";
        btnFontAdd.onclick = () => {
            baseFontSize = Math.min(baseFontSize + 1, MAX_FONT);
            refreshVars();
        };

        const btnFontSub = document.createElement('button');
        btnFontSub.innerText = "字体-";
        btnFontSub.style.cssText = btn.style.cssText;
        btnFontSub.style.display = "none";
        btnFontSub.onclick = () => {
            baseFontSize = Math.max(baseFontSize - 1, MIN_FONT);
            refreshVars();
        };

        const btnTheme = document.createElement('button');
        btnTheme.innerText = "主题";
        btnTheme.style.cssText = btn.style.cssText;
        btnTheme.style.display = "none";
        btnTheme.onclick = () => {
            isDarkTheme = !isDarkTheme;
            applyTheme();
            refreshVars();
        };

        controlBtns = [btnColAdd, btnColSub, btnFontAdd, btnFontSub, btnTheme];
        btnWrap.append(btn, ...controlBtns);
        document.body.appendChild(btnWrap);

        const initSize = getInitialPanelSize();
        panel = document.createElement('div');
        panel.style.cssText = `
            position: fixed !important;
            left: ${initSize.left}px !important;
            top: ${initSize.top}px !important;
            width: ${initSize.w}px !important;
            height: ${initSize.h}px !important;
            max-width: calc(100% - 20px) !important;
            max-height: calc(100% - 20px) !important;
            min-width: ${MIN_W}px !important;
            min-height: ${MIN_H}px !important;
            color: #fff !important;
            padding: 0 !important;
            border-radius: 8px !important;
            z-index: 99999998 !important;
            display: none !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            border: 1px solid #444;
        `;

        titleBar = document.createElement('div');
        titleBar.style.cssText = `
            height: 36px !important;
            line-height: 36px !important;
            padding: 0 12px !important;
            border-bottom: 1px solid #444 !important;
            cursor: move !important;
            user-select: none;
            font-size: 14px;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
        `;

        const titleText = document.createElement('span');
        titleText.innerText = "米家极客版变量实时看板  ©嗜血星空earth";

        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '搜索变量名...';
        searchInput.style.cssText = `
            height: 24px !important;
            padding: 0 8px !important;
            border-radius: 4px !important;
            border: 1px solid #ccc !important;
            outline: none !important;
            font-size: 12px !important;
            width: 160px !important;
        `;
        searchInput.addEventListener('input', () => {
            searchKeyword = searchInput.value.trim().toLowerCase();
            refreshVars();
        });

        titleBar.appendChild(titleText);
        titleBar.appendChild(searchInput);

        const contentWrap = document.createElement('div');
        contentWrap.id = "var-list-content";
        contentWrap.style.cssText = `
            position: absolute !important;
            top: 36px !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 16px !important;
            padding: 12px !important;
            overflow-y: auto !important;
        `;
        contentWrap.innerHTML = "加载中...";

        resizeBL = document.createElement('div');
        resizeBL.style.cssText = `
            position: absolute !important;
            left: 0 !important;
            bottom: 0 !important;
            width: 16px !important;
            height: 16px !important;
            cursor: sw-resize !important;
            border-radius: 0 0 0 8px;
        `;

        resizeBR = document.createElement('div');
        resizeBR.style.cssText = `
            position: absolute !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 16px !important;
            height: 16px !important;
            cursor: se-resize !important;
            border-radius: 0 0 8px 0;
        `;

        panel.appendChild(titleBar);
        panel.appendChild(contentWrap);
        panel.appendChild(resizeBL);
        panel.appendChild(resizeBR);
        document.body.appendChild(panel);
        applyTheme();

        titleBar.addEventListener('mousedown', (e) => {
            if (e.target === searchInput) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initLeft = rect.left;
            initTop = rect.top;
            e.preventDefault();
        });

        resizeBL.addEventListener('mousedown', (e) => {
            isResizeBL = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initW = rect.width;
            initH = rect.height;
            initPanelLeft = rect.left;
            e.preventDefault();
            e.stopPropagation();
        });

        resizeBR.addEventListener('mousedown', (e) => {
            isResizeBR = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initW = rect.width;
            initH = rect.height;
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                let newL = initLeft + dx;
                let newT = initTop + dy;
                newL = Math.max(0, Math.min(newL, window.innerWidth - panel.offsetWidth));
                newT = Math.max(0, Math.min(newT, window.innerHeight - panel.offsetHeight));
                panel.style.left = newL + "px";
                panel.style.top = newT + "px";
                panel.style.right = "auto";
                return;
            }
            if (isResizeBR) {
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;
                let newW = initW + dx;
                let newH = initH + dy;
                newW = Math.max(MIN_W, Math.min(newW, window.innerWidth - panel.offsetLeft - 10));
                newH = Math.max(MIN_H, Math.min(newH, window.innerHeight - panel.offsetTop - 10));
                panel.style.width = newW + "px";
                panel.style.height = newH + "px";
                requestAnimationFrame(refreshVars);
                return;
            }
            if (isResizeBL) {
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;
                let newW = initW - dx;
                let newH = initH + dy;
                let newLeft = initPanelLeft + dx;
                if (newW >= MIN_W && newLeft >= 0) {
                    panel.style.width = newW + "px";
                    panel.style.left = newLeft + "px";
                }
                if (newH >= MIN_H) {
                    newH = Math.min(newH, window.innerHeight - panel.offsetTop - 10);
                    panel.style.height = newH + "px";
                }
                requestAnimationFrame(refreshVars);
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            isResizeBL = false;
            isResizeBR = false;
        });

        btn.onclick = () => {
            isShow = !isShow;
            panel.style.display = isShow ? "block" : "none";
            btn.innerText = isShow ? "关闭面板" : "变量看板";
            panelVisible = isShow;
            controlBtns.forEach(b => b.style.display = isShow ? "inline-block" : "none");
            if (!isShow) { changedCellSet.clear(); lastValueMap = {}; }
            if (isShow) refreshVars();
        };

        window.addEventListener('resize', () => {
            if (panelVisible) refreshVars();
        });
    }

    function applyTheme() {
        if (!panel) return;
        const c = isDarkTheme ? themeColor.dark : themeColor.light;
        panel.style.background = c.panelBg;
        panel.style.borderColor = c.border;
        titleBar.style.background = c.titleBarBg;
        titleBar.style.color = c.titleText;
        titleBar.style.borderColor = c.border;
        resizeBL.style.background = c.resizeBg;
        resizeBR.style.background = c.resizeBg;

        if (searchInput) {
            if (isDarkTheme) {
                searchInput.style.background = "#374151";
                searchInput.style.color = "#fff";
                searchInput.style.borderColor = "#4b5563";
                searchInput.style.placeholderColor = "#9ca3af";
            } else {
                searchInput.style.background = "#fff";
                searchInput.style.color = "#333";
                searchInput.style.borderColor = "#ddd";
            }
        }
    }

    function sortByTypeAndName(list) {
        return list.sort((a, b) => {
            const typeOrder = (a.type === 'number' ? 0 : 1) - (b.type === 'number' ? 0 : 1);
            if (typeOrder !== 0) return typeOrder;
            return a.name.localeCompare(b.name, 'zh-CN');
        });
    }

    function filterVariables(list) {
        if (!searchKeyword) return list;
        return list.filter(item => item.name.toLowerCase().includes(searchKeyword));
    }

    // ==============================================
    // 渲染表格（增加灰色自动化名称）
    // ==============================================
    function buildAutoColumnRows(list) {
        const colCnt = getAutoColumnCount();
        let rows = "";
        const total = list.length;
        const c = isDarkTheme ? themeColor.dark : themeColor.light;
        const changedText = "#ff4444";

        const cellStyle = `
            padding:6px;
            border:1px solid ${c.cellBorder};
            width:${(100 / colCnt).toFixed(2)}%;
            font-size:${baseFontSize}px;
            line-height:1.4;
            word-break:break-all;
            box-sizing:border-box;
            color:${c.text};
        `;

        for (let i = 0; i < total; i += colCnt) {
            rows += "<tr>";
            for (let j = 0; j < colCnt; j++) {
                const item = list[i + j];
                if (item) {
                    const key = item.key;
                    const currVal = item.value;
                    const lastVal = lastValueMap[key];
                    let bg = "";
                    let color = c.text;

                    if (panelVisible && lastVal !== undefined && lastVal !== currVal) {
                        changedCellSet.add(key);
                        color = changedText;
                    }
                    lastValueMap[key] = currVal;
                    if (changedCellSet.has(key)) bg = `background:${c.changeBg};`;

                    // 显示：灰色小字自动化名称 + 正常变量名
                    const autoNameHtml = item.scope !== "global"
                        ? `<div style="font-size:${baseFontSize-2}px;color:${c.automationText};margin-bottom:2px;">${item.automationName}</div>`
                        : "";

                    rows += `<td style="${cellStyle}${bg}">
                        ${autoNameHtml}
                        ${item.name}：<span style="color:${color};">${currVal}</span>
                    </td>`;
                } else {
                    rows += `<td style="${cellStyle}color:${c.emptyText};">-</td>`;
                }
            }
            rows += "</tr>";
        }
        return rows;
    }

    // ==============================================
    // 刷新：先加载自动化名称，再渲染变量
    // ==============================================
    function refreshVars() {
        if (typeof document === 'undefined' || !panelVisible) return;
        const content = document.getElementById('var-list-content');
        if (!content) return;

        loadRuleList(() => {
            getOfficialGlobalVars(vars => {
                let globalList = vars.filter(item => item.scope === 'global');
                let otherList = vars.filter(item => item.scope !== 'global');

                globalList = filterVariables(globalList);
                otherList = filterVariables(otherList);
                globalList = sortByTypeAndName(globalList);
                otherList = sortByTypeAndName(otherList);

                const colCnt = getAutoColumnCount();
                const c = isDarkTheme ? themeColor.dark : themeColor.light;

                let thHtml = "";
                for (let t = 1; t <= colCnt; t++) {
                    thHtml += `<th style="width:${(100 / colCnt).toFixed(2)}%;font-size:${baseFontSize}px;color:${c.text};">${t}</th>`;
                }

                let html = `
                <div style="margin-bottom:18px;">
                    <div style="margin:4px 0;font-weight:bold;color:${c.titleMark};font-size:${baseFontSize+1}px;">一、全局变量</div>
                    <table style="table-layout:fixed;width:100%;border-collapse:collapse;border:1px solid ${c.cellBorder};">
                        <tr style="background:${c.headBg};text-align:center;">${thHtml}</tr>
                        ${buildAutoColumnRows(globalList)}
                    </table>
                </div>
                <div>
                    <div style="margin:4px 0;font-weight:bold;color:${c.titleMark};font-size:${baseFontSize+1}px;">二、非全局变量</div>
                    <table style="table-layout:fixed;width:100%;border-collapse:collapse;border:1px solid ${c.cellBorder};">
                        <tr style="background:${c.headBg};text-align:center;">${thHtml}</tr>
                        ${buildAutoColumnRows(otherList)}
                    </table>
                </div>`;
                content.innerHTML = html;
            });
        });
    }

    setTimeout(() => {
        createUI();
        setInterval(refreshVars, 800);
    }, 1200);
})();
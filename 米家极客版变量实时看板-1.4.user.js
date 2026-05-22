// ==UserScript==
// @name         米家极客版变量实时看板
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  修复左下角缩放方向，首次打开自适应浏览器窗口，尺寸变化自动适配列数
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

    // 面板拖动
    let isDragging = false;
    let startX = 0, startY = 0;
    let initLeft = 0, initTop = 0;

    // 缩放状态
    let isResizeBL = false; // 左下角
    let isResizeBR = false; // 右下角
    let resizeStartX = 0, resizeStartY = 0;
    let initW = 0, initH = 0;
    let initPanelLeft = 0;

    const MIN_W = 400;
    const MIN_H = 300;

    // 自动列数：根据面板宽度
    function getAutoColumnCount() {
        const panelW = panel ? panel.offsetWidth : window.innerWidth;
        if (panelW < 500) return 2;
        if (panelW < 800) return 4;
        if (panelW < 1200) return 6;
        return 8;
    }

    // 首次打开：面板大小自适应浏览器可视区
    function getInitialPanelSize() {
        const w = Math.max(MIN_W, Math.floor(window.innerWidth * 0.8));
        const h = Math.max(MIN_H, Math.floor(window.innerHeight * 0.8));
        const left = Math.floor((window.innerWidth - w) / 2);
        const top = Math.floor((window.innerHeight - h) / 2);
        return { w, h, left, top };
    }

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
                            key: scope + "_" + v.userData.name
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

    function createUI() {
        if (typeof document === 'undefined') return;

        btn = document.createElement('button');
        btn.innerText = "变量看板";
        btn.style.cssText = `
            position: fixed !important;
            right: 20px !important;
            bottom: 20px !important;
            z-index: 99999999 !important;
            padding: 12px 10px !important;
            background: #1677ff !important;
            color: white !important;
            border: none !important;
            border-radius: 6px !important;
            font-size: 14px !important;
            cursor: pointer !important;
            user-select: none;
        `;

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
            background: #1f2937 !important;
            color: #fff !important;
            padding: 0 !important;
            border-radius: 8px !important;
            z-index: 99999998 !important;
            display: none !important;
            overflow: hidden !important;
            font-size: 12px !important;
            box-sizing: border-box !important;
            border: 1px solid #444;
        `;

        titleBar = document.createElement('div');
        titleBar.style.cssText = `
            height: 36px !important;
            line-height: 36px !important;
            padding: 0 12px !important;
            background: #2d3748 !important;
            border-bottom: 1px solid #444 !important;
            cursor: move !important;
            user-select: none;
        `;
        titleBar.innerText = "米家极客版变量实时看板  ©嗜血星空earth";

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

        // 左下角缩放
        resizeBL = document.createElement('div');
        resizeBL.style.cssText = `
            position: absolute !important;
            left: 0 !important;
            bottom: 0 !important;
            width: 16px !important;
            height: 16px !important;
            background: #4a5568 !important;
            cursor: sw-resize !important;
            border-radius: 0 0 0 8px;
        `;

        // 右下角缩放
        resizeBR = document.createElement('div');
        resizeBR.style.cssText = `
            position: absolute !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 16px !important;
            height: 16px !important;
            background: #4a5568 !important;
            cursor: se-resize !important;
            border-radius: 0 0 8px 0;
        `;

        panel.appendChild(titleBar);
        panel.appendChild(contentWrap);
        panel.appendChild(resizeBL);
        panel.appendChild(resizeBR);

        document.body.appendChild(btn);
        document.body.appendChild(panel);

        // 拖动
        titleBar.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initLeft = rect.left;
            initTop = rect.top;
            e.preventDefault();
        });

        // 左下角缩放
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

        // 右下角缩放
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
            // 拖动
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

            // 右下角缩放（保持原逻辑）
            if (isResizeBR) {
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;
                let newW = initW + dx;
                let newH = initH + dy;
                newW = Math.max(MIN_W, Math.min(newW, window.innerWidth - panel.offsetLeft - 10));
                newH = Math.max(MIN_H, Math.min(newH, window.innerHeight - panel.offsetTop - 10));
                panel.style.width = newW + "px";
                panel.style.height = newH + "px";
                refreshVars();
                return;
            }

            // 左下角缩放（修复方向）
            if (isResizeBL) {
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;
                let newW = initW - dx;
                let newH = initH + dy;
                let newLeft = initPanelLeft + dx;

                // 宽度约束
                if (newW >= MIN_W && newLeft >= 0) {
                    panel.style.width = newW + "px";
                    panel.style.left = newLeft + "px";
                }
                // 高度约束
                if (newH >= MIN_H) {
                    newH = Math.min(newH, window.innerHeight - panel.offsetTop - 10);
                    panel.style.height = newH + "px";
                }
                refreshVars();
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
            if (!isShow) {
                changedCellSet.clear();
                lastValueMap = {};
            }
            if (isShow) refreshVars();
        };

        window.addEventListener('resize', () => {
            if (panelVisible) refreshVars();
        });
    }

    function sortByTypeAndName(list) {
        return list.sort((a, b) => {
            const typeOrder = (a.type === 'number' ? 0 : 1) - (b.type === 'number' ? 0 : 1);
            if (typeOrder !== 0) return typeOrder;
            return a.name.localeCompare(b.name, 'zh-CN');
        });
    }

    function buildAutoColumnRows(list) {
        const colCnt = getAutoColumnCount();
        let rows = "";
        const total = list.length;
        for (let i = 0; i < total; i += colCnt) {
            rows += "<tr>";
            for (let j = 0; j < colCnt; j++) {
                const item = list[i + j];
                if (item) {
                    const key = item.key;
                    const currVal = item.value;
                    const lastVal = lastValueMap[key];
                    let bgStyle = "";
                    let textColor = "#ffffff";

                    if (panelVisible && lastVal !== undefined && lastVal !== currVal) {
                        changedCellSet.add(key);
                        textColor = "#ff4444";
                    }
                    lastValueMap[key] = currVal;

                    if (changedCellSet.has(key)) {
                        bgStyle = "background-color:#4b2828;";
                    }

                    rows += `<td style="padding:6px;border:1px solid #555;${bgStyle};flex:1;min-width:120px;word-break:break-all;">
                        ${item.name}：<span style="color:${textColor};">${currVal}</span>
                    </td>`;
                } else {
                    rows += `<td style="padding:6px;border:1px solid #555;color:#888;flex:1;min-width:120px;">-</td>`;
                }
            }
            rows += "</tr>";
        }
        return rows;
    }

    function refreshVars() {
        if (typeof document === 'undefined' || !panelVisible) return;
        const content = document.getElementById('var-list-content');
        if (!content) return;

        getOfficialGlobalVars(vars => {
            let globalList = vars.filter(item => item.scope === 'global');
            let otherList = vars.filter(item => item.scope !== 'global');
            globalList = sortByTypeAndName(globalList);
            otherList = sortByTypeAndName(otherList);

            const colCnt = getAutoColumnCount();
            let thHtml = "";
            for (let t = 1; t <= colCnt; t++) {
                thHtml += `<th>${t}</th>`;
            }

            let html = `
            <div style="margin-bottom:18px;">
                <div style="margin:4px 0;font-weight:bold;color:#73c0ff;">一、全局变量</div>
                <table width="100%" border="1" cellpadding="6" cellspacing="0" style="border-color:#555;table-layout:auto;">
                    <tr style="background:#334;text-align:center;">
                        ${thHtml}
                    </tr>
                    ${buildAutoColumnRows(globalList)}
                </table>
            </div>
            <div>
                <div style="margin:4px 0;font-weight:bold;color:#73c0ff;">二、非全局变量</div>
                <table width="100%" border="1" cellpadding="6" cellspacing="0" style="border-color:#555;table-layout:auto;">
                    <tr style="background:#334;text-align:center;">
                        ${thHtml}
                    </tr>
                    ${buildAutoColumnRows(otherList)}
                </table>
            </div>`;
            content.innerHTML = html;
        });
    }

    setTimeout(() => {
        createUI();
        setInterval(() => refreshVars(), 800);
    }, 1200);
})();
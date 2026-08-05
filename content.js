/* content.js Ver 2.0.5 - International Edition */
(function() {
    if (window.isTableSelectorRunning) return;
    window.isTableSelectorRunning = true;

    const getMsg = (key) => chrome.i18n.getMessage(key);

    const cleanup = () => {
        document.getElementById('ts-pro-host')?.remove();
        document.getElementById('ts-global-style')?.remove();
        document.body.removeAttribute('data-ts-mode');
        document.onmouseover = null;
        document.onmousedown = null;
        document.onmousemove = null;
        document.onmouseup = null;
        window.isTableSelectorRunning = false;
    };

    const host = document.createElement('div');
    host.id = 'ts-pro-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
        #panel {
            position: fixed; top: 30px; right: 30px; background: #fff; border: 3px solid #333;
            padding: 20px; z-index: 2147483647; border-radius: 15px; width: 300px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5); font-family: sans-serif;
        }
        .title { margin-bottom: 12px; text-align: center; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        .title-main { font-weight: bold; font-size: 16px; line-height: 1.3; }
        .title-version { display: block; margin-top: 4px; font-size: 12px; font-weight: 600; color: #666; letter-spacing: 0.02em; }
        .format-row {
            margin-bottom: 14px; padding-bottom: 12px; border-bottom: 2px solid #eee;
            font-size: 12px;
        }
        .format-label { display: block; font-weight: bold; margin-bottom: 8px; color: #555; }
        .format-toggle { display: flex; flex-direction: column; gap: 6px; }
        .format-toggle label {
            display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: normal;
        }
        .format-toggle input { margin: 0; cursor: pointer; }
        .btn {
            display: block; width: 100%; padding: 12px; margin: 8px 0; cursor: pointer;
            border-radius: 8px; border: 1px solid #ddd; font-weight: bold; font-size: 13px;
            background: #f9f9f9; color: #333; text-align: left;
        }
        .btn:hover { background: #eee; }
        .btn-table { border-left: 10px solid #6c757d; }
        .btn-row { border-left: 10px solid #007bff; }
        .btn-col { border-left: 10px solid #28a745; }
        .btn-range { border-left: 10px solid #ffc107; }
        .btn-close { background: #fee !important; color: #d9534f !important; border: none; margin-top: 15px; text-align: center; }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'panel';
    panel.innerHTML = `
        <div class="title">
            <div class="title-main">TableSnap Pro</div>
            <span class="title-version">V2.0.5</span>
        </div>
        <div class="format-row">
            <span class="format-label">${getMsg("format_label") || "Output format"}</span>
            <div class="format-toggle">
                <label><input type="radio" name="ts-format" value="tsv" checked> ${getMsg("format_excel") || "Excel (CSV)"}</label>
                <label><input type="radio" name="ts-format" value="markdown"> ${getMsg("format_markdown") || "Markdown"}</label>
            </div>
        </div>
        <button class="btn btn-table" data-mode="table">① ${getMsg("mode_table") || 'Table'}</button>
        <button class="btn btn-row" data-mode="row">② ${getMsg("mode_row") || 'Rows'}</button>
        <button class="btn btn-col" data-mode="col">③ ${getMsg("mode_col") || 'Columns'}</button>
        <button class="btn btn-range" data-mode="range">④ ${getMsg("mode_range") || 'Range'}</button>
        <button class="btn btn-close">${getMsg("btn_cancel") || 'Cancel'}</button>
    `;
    shadow.appendChild(panel);

    const gs = document.createElement('style');
    gs.id = 'ts-global-style';
    gs.textContent = `
        .tc-tab-h { background-color: rgba(108, 117, 125, 0.4) !important; outline: 2px solid #6c757d !important; }
        .tc-row-h { background-color: rgba(0, 123, 255, 0.4) !important; outline: 1px solid #007bff !important; }
        .tc-col-h { background-color: rgba(40, 167, 69, 0.4) !important; outline: 1px solid #28a745 !important; }
        .tc-range-h { background-color: rgba(255, 193, 7, 0.5) !important; outline: 1px solid #ffc107 !important; }
        body[data-ts-mode] * { cursor: crosshair !important; user-select: none !important; }
    `;
    document.head.appendChild(gs);

    let mode = null;
    let startCell = null;
    let isCopying = false;

    const getOutputFormat = () => {
        const checked = shadow.querySelector('input[name="ts-format"]:checked');
        return checked?.value === 'markdown' ? 'markdown' : 'tsv';
    };

    shadow.querySelectorAll('.btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            if (btn.classList.contains('btn-close')) { cleanup(); return; }
            mode = btn.getAttribute('data-mode');
            document.body.setAttribute('data-ts-mode', mode);
            panel.style.display = 'none';
        };
    });

    const buildDataMap = (selected) => {
        const dataMap = new Map();
        selected.forEach(cell => {
            const r = cell.parentElement.rowIndex;
            if (!dataMap.has(r)) dataMap.set(r, []);
            dataMap.get(r).push({ c: cell.cellIndex, text: cell.innerText.trim() });
        });
        return dataMap;
    };

    const toTsv = (dataMap) => {
        return Array.from(dataMap.keys()).sort((a, b) => a - b).map(r => {
            return dataMap.get(r).sort((a, b) => a.c - b.c).map(obj => obj.text).join('\t');
        }).join('\n');
    };

    const toMarkdown = (dataMap) => {
        const rowKeys = Array.from(dataMap.keys()).sort((a, b) => a - b);
        if (rowKeys.length === 0) return '';

        let minC = Infinity;
        let maxC = -Infinity;
        rowKeys.forEach(r => {
            dataMap.get(r).forEach(({ c }) => {
                minC = Math.min(minC, c);
                maxC = Math.max(maxC, c);
            });
        });

        const grid = rowKeys.map(r => {
            const byCol = new Map(dataMap.get(r).map(o => [o.c, o.text]));
            const cells = [];
            for (let c = minC; c <= maxC; c++) cells.push(byCol.get(c) ?? '');
            return cells;
        });

        const escapeCell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
        const formatRow = (cells) => '| ' + cells.map(escapeCell).join(' | ') + ' |';
        const separator = (colCount) => '| ' + Array.from({ length: colCount }, () => '---').join(' | ') + ' |';

        const colCount = grid[0].length;
        if (grid.length === 1) {
            const headers = grid[0].map((_, i) => `Column ${i + 1}`);
            return [formatRow(headers), separator(colCount), formatRow(grid[0])].join('\n');
        }

        const header = formatRow(grid[0]);
        const body = grid.slice(1).map(formatRow).join('\n');
        return [header, separator(colCount), body].join('\n');
    };

    const getCell = (el) => {
        const td = el.closest('td, th');
        if (!td) return null;
        const tr = td.parentElement;
        const table = tr.closest('table');
        return { td, tr, table, c: td.cellIndex, r: tr.rowIndex };
    };

    const clearH = () => document.querySelectorAll('.tc-tab-h, .tc-row-h, .tc-col-h, .tc-range-h').forEach(el => el.classList.remove('tc-tab-h', 'tc-row-h', 'tc-col-h', 'tc-range-h'));

    document.onmouseover = (e) => {
        if (!mode || startCell || isCopying) return;
        clearH();
        const info = getCell(e.target);
        if (!info) return;

        if (mode === 'table') info.table.querySelectorAll('td, th').forEach(c => c.classList.add('tc-tab-h'));
        else if (mode === 'row') Array.from(info.tr.cells).forEach(c => c.classList.add('tc-row-h'));
        else if (mode === 'col') Array.from(info.table.rows).forEach(r => r.cells[info.c]?.classList.add('tc-col-h'));
        else if (mode === 'range') info.td.classList.add('tc-range-h');
    };

    document.onmousedown = (e) => {
        if (!mode || isCopying || e.target.closest('#ts-pro-host')) return;
        startCell = getCell(e.target);
        if (startCell) { e.preventDefault(); e.stopPropagation(); }
    };

    document.onmousemove = (e) => {
        if (!mode || !startCell || isCopying) return;
        clearH();
        const cur = getCell(e.target);
        if (!cur || startCell.table !== cur.table) return;

        if (mode === 'row') {
            const rS = Math.min(startCell.r, cur.r);
            const rE = Math.max(startCell.r, cur.r);
            for (let r = rS; r <= rE; r++) {
                if (startCell.table.rows[r]) Array.from(startCell.table.rows[r].cells).forEach(c => c.classList.add('tc-row-h'));
            }
        } else if (mode === 'col') {
            const cS = Math.min(startCell.c, cur.c);
            const cE = Math.max(startCell.c, cur.c);
            Array.from(startCell.table.rows).forEach(r => {
                for (let c = cS; c <= cE; c++) {
                    if (r.cells[c]) r.cells[c].classList.add('tc-col-h');
                }
            });
        } else if (mode === 'range') {
            const rS = Math.min(startCell.r, cur.r);
            const rE = Math.max(startCell.r, cur.r);
            const cS = Math.min(startCell.c, cur.c);
            const cE = Math.max(startCell.c, cur.c);
            for (let r = rS; r <= rE; r++) {
                const row = startCell.table.rows[r];
                for (let c = cS; c <= cE; c++) {
                    if (row && row.cells[c]) row.cells[c].classList.add('tc-range-h');
                }
            }
        }
    };

    document.onmouseup = (e) => {
        if (!mode || !startCell || isCopying) return;
        const selected = document.querySelectorAll('.tc-tab-h, .tc-row-h, .tc-col-h, .tc-range-h');

        if (selected.length > 0) {
            isCopying = true;
            const dataMap = buildDataMap(selected);
            clearH();

            const outputFormat = getOutputFormat();
            const text = outputFormat === 'markdown' ? toMarkdown(dataMap) : toTsv(dataMap);

            navigator.clipboard.writeText(text).then(() => {
                const t = document.createElement('div');
                t.textContent = getMsg("copy_success") || "Copied!";
                t.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 24px;border-radius:30px;z-index:2147483647;font-weight:bold;box-shadow:0 4px 15px rgba(0,0,0,0.4);";
                document.body.appendChild(t);

                setTimeout(() => { t.remove(); cleanup(); }, 1200);
            }).catch(() => {
                isCopying = false;
                alert(getMsg("copy_error") || "Copy failed.");
            });
        }
        startCell = null;
    };
})();

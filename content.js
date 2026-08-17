/* content.js Ver 2.0.6 - International Edition */
(function() {
    if (window.isTableSelectorRunning) return;
    window.isTableSelectorRunning = true;

    const getMsg = (key) => chrome.i18n.getMessage(key);

    const escapeTsvCell = (text) => {
        if (/[\t\n\r"]/.test(text)) {
            return '"' + text.replace(/"/g, '""') + '"';
        }
        return text;
    };

    const METRIC_RE = /^(前年|売上|比率)([：:])(.*)$/;
    const isMetricLine = (line) => /^(前年|売上|比率)[：:]/.test(line || '');
    const isLabelOnly = (line) => {
        const m = String(line || '').match(METRIC_RE);
        return !!m && !String(m[3] || '').trim();
    };
    const pairLabelValueLines = (lines) => {
        const result = [];
        for (let i = 0; i < lines.length; i++) {
            const cur = lines[i];
            const next = lines[i + 1];
            if (isLabelOnly(cur) && next && !isMetricLine(next)) {
                result.push(cur + next);
                i++;
            } else {
                result.push(cur);
            }
        }
        return result;
    };

    const splitCellLines = (text) =>
        text ? String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [''];

    // Copytables 同様: ネスト表・ブロック要素も行として拾う
    const getCellText = (cell) => {
        const nestedRows = cell.querySelectorAll(':scope table tr');
        if (nestedRows.length > 0) {
            const lines = [...nestedRows]
                .map(r => r.innerText.replace(/\r?\n/g, ' ').trim())
                .filter(Boolean);
            if (lines.length) return lines.join('\n');
        }

        const blocks = cell.querySelectorAll(':scope > div, :scope > p, :scope > li, :scope > span');
        if (blocks.length > 1) {
            const lines = [...blocks].map(b => b.innerText.trim()).filter(Boolean);
            if (lines.length) return lines.join('\n');
        }

        return cell.innerText.trim();
    };

    const normalizeColumnLines = (colIdx, splitLines, colCount) => {
        let lines = pairLabelValueLines([...splitLines[colIdx]]);

        if (colCount >= 4 && colIdx === colCount - 1) {
            const monthIdx = colCount - 2;
            const monthLines = pairLabelValueLines([...splitLines[monthIdx]]);
            const totalBroken = lines.length === 0
                || lines.every(l => isLabelOnly(l) || !isMetricLine(l));
            if (monthIdx >= 2 && totalBroken && monthLines.some(isMetricLine)) {
                lines = monthLines;
            }
        }
        return lines;
    };

    const buildExpandedRows = (dataMap) => {
        const outputRows = [];

        for (const r of Array.from(dataMap.keys()).sort((a, b) => a - b)) {
            const cells = dataMap.get(r).sort((a, b) => a.c - b.c);
            if (cells.length === 0) continue;

            const minCol = cells[0].c;
            const maxCol = cells[cells.length - 1].c;
            const colCount = maxCol - minCol + 1;

            const rowArray = new Array(colCount).fill('');
            cells.forEach(({ c, text }) => {
                rowArray[c - minCol] = text;
            });

            const splitLines = rowArray.map(splitCellLines);
            const normalizedLines = rowArray.map((_, colIdx) =>
                normalizeColumnLines(colIdx, splitLines, colCount)
            );

            const monthIdx = colCount >= 4 ? colCount - 2 : -1;
            const metricSource = monthIdx >= 2
                ? normalizedLines[monthIdx]
                : normalizedLines.find((lines, idx) => idx >= 2 && lines.some(isMetricLine));

            const hasMetricBlock = !!(metricSource && metricSource.some(isMetricLine));
            const maxLines = hasMetricBlock ? Math.max(metricSource.length, 1) : 1;

            const emitRow = (lineIndex) => {
                const row = new Array(colCount).fill('');
                for (let colIdx = 0; colIdx < colCount; colIdx++) {
                    const lines = normalizedLines[colIdx];
                    if (colIdx <= 1) {
                        row[colIdx] = lineIndex === 0 ? (lines[0] || '') : '';
                        continue;
                    }
                    if (colCount >= 4 && colIdx === colCount - 1) {
                        row[colIdx] = metricSource?.[lineIndex] || '';
                        continue;
                    }
                    if (colIdx === monthIdx) {
                        row[colIdx] = metricSource?.[lineIndex] || '';
                        continue;
                    }
                    row[colIdx] = lines[lineIndex] || '';
                }
                return row;
            };

            if (!hasMetricBlock || maxLines <= 1) {
                outputRows.push(emitRow(0));
            } else {
                for (let i = 0; i < maxLines; i++) outputRows.push(emitRow(i));
            }
        }
        return outputRows;
    };

    const rowsToTsv = (rows) =>
        rows.map(row => row.map(escapeTsvCell).join('\t')).join('\n');

    // 本物の DOM テーブルを構築
    // C/D は同じ行に「前年：2,807,680」形式（1セル1行）
    const buildDomTable = (doc, rows) => {
        const table = doc.createElement('table');
        table.setAttribute('border', '0');
        table.setAttribute('cellspacing', '0');
        table.setAttribute('cellpadding', '0');

        rows.forEach(row => {
            const tr = doc.createElement('tr');
            row.forEach((cell) => {
                const td = doc.createElement('td');
                td.textContent = cell;
                tr.appendChild(td);
            });
            table.appendChild(tr);
        });
        return table;
    };

    const rowsToHtmlFragment = (rows) => buildDomTable(document, rows).outerHTML;

    // copy イベントで HTML/TSV を直接セット（拡張でもっとも確実）
    const copyViaCopyEvent = (html, text) => {
        let written = false;
        const onCopy = (e) => {
            try {
                e.clipboardData.setData('text/html', html);
                e.clipboardData.setData('text/plain', text);
                e.preventDefault();
                written = true;
            } catch (_) { /* ignore */ }
        };

        document.addEventListener('copy', onCopy, true);
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (_) {
            ok = false;
        }
        document.removeEventListener('copy', onCopy, true);

        if (!ok || !written) {
            throw new Error('copy event failed');
        }
    };

    // ページ内の表を選択してコピー（iframe 不要）
    const copyViaDomSelection = (rows) => {
        const holder = document.createElement('div');
        holder.contentEditable = 'true';
        holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
        holder.appendChild(buildDomTable(document, rows));
        document.body.appendChild(holder);

        const table = holder.querySelector('table');
        const selection = window.getSelection();
        const range = document.createRange();

        try {
            holder.focus();
            range.selectNodeContents(table);
            selection.removeAllRanges();
            selection.addRange(range);
            const ok = document.execCommand('copy');
            selection.removeAllRanges();
            holder.remove();
            if (!ok) throw new Error('dom selection copy failed');
        } catch (err) {
            selection.removeAllRanges();
            holder.remove();
            throw err;
        }
    };

    const copyViaClipboardItem = async (html, text) => {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
            }),
        ]);
    };

    const copyTableData = async (rows) => {
        if (!rows || rows.length === 0) {
            throw new Error('no rows');
        }

        const html = rowsToHtmlFragment(rows);
        const text = rowsToTsv(rows);
        const errors = [];

        // 1) copy イベント直書き（同期・ユーザー操作中に実行できる）
        try {
            copyViaCopyEvent(html, text);
            return;
        } catch (e) {
            errors.push(e);
        }

        // 2) DOM 選択 + execCommand
        try {
            copyViaDomSelection(rows);
            return;
        } catch (e) {
            errors.push(e);
        }

        // 3) ClipboardItem
        try {
            if (typeof ClipboardItem !== 'undefined') {
                await copyViaClipboardItem(html, text);
                return;
            }
        } catch (e) {
            errors.push(e);
        }

        // 4) TSV のみ
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (e) {
            errors.push(e);
        }

        throw new Error(errors.map(e => e && e.message ? e.message : String(e)).join(' | '));
    };

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
        .support-link {
            display: block;
            width: fit-content;
            margin: 12px auto 0;
            padding: 6px 14px;
            border-radius: 999px;
            background: #e0a800;
            color: #fff;
            font-size: 12px;
            font-weight: 700;
            text-decoration: none;
            letter-spacing: 0.02em;
        }
        .support-link:hover { background: #c99200; color: #fff; text-decoration: none; }
        .btn-close { background: #fee !important; color: #d9534f !important; border: none; margin-top: 15px; text-align: center; }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'panel';
    panel.innerHTML = `
        <div class="title">
            <div class="title-main">TableSnap Pro</div>
            <span class="title-version">V2.0.6</span>
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
        <a class="support-link" href="https://buymeacoffee.com/k_tech_studio" target="_blank" rel="noopener noreferrer">${getMsg("support_bmc") || "Buy Me a Coffee"}</a>
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
    const supportLink = shadow.querySelector('.support-link');
    if (supportLink) {
        supportLink.addEventListener('click', (e) => e.stopPropagation());
    }

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

    const clearH = () => document.querySelectorAll('.tc-tab-h, .tc-row-h, .tc-col-h, .tc-range-h')
        .forEach(el => el.classList.remove('tc-tab-h', 'tc-row-h', 'tc-col-h', 'tc-range-h'));

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
            const rows = buildExpandedRows(dataMap);

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
                cleanup();
            });
        }
        startCell = null;
    };
})();

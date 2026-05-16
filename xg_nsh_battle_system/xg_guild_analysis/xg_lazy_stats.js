// ==================== 统计面板模块 ====================

let statsBattleParticipants = {};
let statsAnalysisFilter = null; // 当前筛选类别
let statsAnalysisRowsCache = []; // 接龙分析数据缓存

function toggleAnalysisFilter(category) {
    statsAnalysisFilter = statsAnalysisFilter === category ? null : category;
    updateAnalysisLegendUI();
    renderStatsAnalysisTable(statsAnalysisRowsCache);
}
function clearAnalysisFilter() {
    statsAnalysisFilter = null;
    updateAnalysisLegendUI();
    renderStatsAnalysisTable(statsAnalysisRowsCache);
}
function updateAnalysisLegendUI() {
    document.querySelectorAll('#statsAnalysisLegend [data-filter]').forEach(el => {
        const f = el.dataset.filter;
        if (statsAnalysisFilter === f) {
            el.classList.add('bg-blue-600', 'text-white');
            el.classList.remove('bg-gray-700/50');
        } else if (statsAnalysisFilter) {
            el.classList.remove('bg-blue-600', 'text-white');
            el.classList.add('bg-gray-700/50', 'opacity-50');
        } else {
            el.classList.remove('bg-blue-600', 'text-white', 'opacity-50');
            el.classList.add('bg-gray-700/50');
        }
    });
}

function initStatisticsPanel() {
    loadStatsBattleParticipants();
    refreshStatisticsPanel();
}

function getMainGuildMembers() {
    return guildMembers.filter(m => !m.deleted && m.guild === 'main');
}

function importStatsBattleFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const lines = e.target.result.split('\n').filter(l => l.trim());
            const players = [];
            lines.forEach((line, idx) => {
                const name = line.split(',')[0].trim().replace(/^["']|["']$/g, '');
                if (idx === 0 && /玩家|名字|姓名/.test(name)) return;
                if (name && name !== '玩家名字') players.push(name);
            });
            const unique = [...new Set(players)];
            statsBattleParticipants[`stats_${Date.now()}`] = {
                fileName: file.name,
                importTime: new Date().toISOString(),
                players: unique
            };
            localStorage.setItem('statsBattleParticipants', JSON.stringify(statsBattleParticipants));
            alert(`导入成功！共 ${unique.length} 名参赛人员`);
            refreshStatisticsPanel();
        } catch (err) {
            alert('导入失败：' + err.message);
            console.error('导入参赛名单失败:', err);
        }
    };
    reader.readAsText(file);
    input.value = '';
}

function refreshStatisticsPanel() {
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    const analysisEl = document.getElementById('statsAnalysisTable');
    const attendanceEl = document.getElementById('statsAttendanceRate');

    // 使用帮会成员管理模块的本帮成员作为基准
    const allMembers = getMainGuildMembers();
    if (allMembers.length === 0) {
        setText('statTotalMembers', '-');
        setText('statRelayCount', '-');
        setText('statParticipantCount', '-');
        setText('statLeaveCount', '-');
        setText('statBenchCount', '-');
        setText('statNotRelayButParticipant', '-');
        if (analysisEl) analysisEl.innerHTML = '<div class="text-center text-gray-400 py-4">暂无帮会成员数据，请先在「帮会人员」模块中添加或同步成员</div>';
        if (attendanceEl) attendanceEl.innerHTML = '<div class="text-center text-gray-400 py-4">暂无帮会成员数据，请先在「帮会人员」模块中添加或同步成员</div>';
        return;
    }

    const relayNames = new Set(relayData.map(r => normalizePlayerName(r.xg_relay_player_name)).filter(n => n));
    const relayStatusMap = {};
    relayData.forEach(r => { relayStatusMap[normalizePlayerName(r.xg_relay_player_name)] = r.xg_relay_status; });
    const sessions = Object.values(statsBattleParticipants);
    let latest = [];
    if (sessions.length >= 2) {
        const last = sessions[sessions.length - 1];
        const prev = sessions[sessions.length - 2];
        const timeDiff = new Date(last.importTime) - new Date(prev.importTime);
        if (timeDiff <= 15 * 60 * 1000) {
            latest = [...new Set([...prev.players, ...last.players])];
        } else {
            latest = last.players;
        }
    } else if (sessions.length === 1) {
        latest = sessions[0].players;
    }
    const participantNames = new Set(latest);

    let notRelayButParticipant = 0;
    let notRelayNotParticipant = 0;
    let relayButNotParticipant = 0;
    let relayAndParticipant = 0;
    let leaveCount = 0;
    let benchCount = 0;
    const analysisRows = [];

    allMembers.forEach(member => {
        const name = member.name;
        const normName = normalizePlayerName(name);
        const status = relayStatusMap[normName] || '';
        const isRelay = relayNames.has(normName);
        const isParticipant = participantNames.has(name);

        if (status === '请假') {
            leaveCount++;
            analysisRows.push({
                name,
                profession: member.profession1 || member.profession2 || '未知',
                isRelay: true,
                isParticipant: false,
                category: '已请假'
            });
            return;
        }
        if (status === '替补') {
            benchCount++;
            analysisRows.push({
                name,
                profession: member.profession1 || member.profession2 || '未知',
                isRelay: true,
                isParticipant: false,
                category: '已替补'
            });
            return;
        }

        if (!isRelay && isParticipant) notRelayButParticipant++;
        if (!isRelay && !isParticipant) notRelayNotParticipant++;
        if (isRelay && !isParticipant) relayButNotParticipant++;
        if (isRelay && isParticipant) relayAndParticipant++;

        analysisRows.push({
            name,
            profession: member.profession1 || member.profession2 || '未知',
            isRelay,
            isParticipant,
            category: isRelay ? (isParticipant ? '已接龙且参赛' : '已接龙未参赛') : (isParticipant ? '未接龙但参赛' : '未接龙未参赛')
        });
    });

    const mainMemberNames = new Set(allMembers.map(m => m.name));
    const mainParticipantCount = latest.filter(name => mainMemberNames.has(name)).length;
    setText('statTotalMembers', allMembers.length);
    setText('statRelayCount', relayNames.size);
    setText('statParticipantCount', mainParticipantCount);
    setText('statLeaveCount', leaveCount);
    setText('statBenchCount', benchCount);
    setText('statNotRelayButParticipant', notRelayButParticipant);

    statsAnalysisRowsCache = analysisRows;
    renderStatsAnalysisTable(analysisRows);
    renderStatsAttendanceRate(allMembers);
}

// 未接龙成员文字列表一键输出（弹窗 + 复制到剪贴板）
function exportNotRelayMemberList() {
    const rows = statsAnalysisRowsCache || [];
    // 包含"未接龙但参赛"和"未接龙未参赛"
    const notRelayRows = rows.filter(r => r.category === '未接龙但参赛' || r.category === '未接龙未参赛');
    if (!notRelayRows.length) {
        alert('当前没有未接龙的成员');
        return;
    }

    const lines = notRelayRows.map((r, idx) => `${idx + 1}. ${r.name} (${r.profession})`);
    const text = lines.join('\n');

    // 复制到剪贴板
    navigator.clipboard.writeText(text).then(() => {
        // 弹窗显示
        const modal = document.createElement('div');
        modal.id = 'notRelayExportModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;max-width:480px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;font-size:1.1rem;font-weight:bold;color:#e2e8f0;"><i class="fas fa-clipboard-list mr-2 text-blue-400"></i>未接龙成员列表（共 ${notRelayRows.length} 人）</h3>
                    <button onclick="document.getElementById('notRelayExportModal').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.2rem;cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
                <div style="padding:16px 20px;overflow-y:auto;flex:1;">
                    <textarea id="notRelayExportText" style="width:100%;height:240px;background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#cbd5e1;padding:12px;font-size:0.9rem;resize:vertical;" readonly>${text.replace(/</g, '&lt;')}</textarea>
                    <p style="margin:8px 0 0;color:#64748b;font-size:0.75rem;">已自动复制到剪贴板，可直接粘贴使用</p>
                </div>
                <div style="padding:12px 20px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:8px;justify-content:flex-end;">
                    <button onclick="document.getElementById('notRelayExportModal').remove()" style="padding:8px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#94a3b8;cursor:pointer;font-size:0.85rem;">关闭</button>
                    <button onclick="navigator.clipboard.writeText(document.getElementById('notRelayExportText').value);alert('已重新复制到剪贴板');" style="padding:8px 16px;background:#3b82f6;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:0.85rem;"><i class="fas fa-copy mr-1"></i>复制</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        // 点击背景关闭
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    }).catch(() => {
        // 复制失败时仍然弹窗显示，让用户手动复制
        alert('复制失败，请手动复制弹窗中的内容');
    });
}

function renderStatsAnalysisTable(rows) {
    const container = document.getElementById('statsAnalysisTable');
    if (!container) return;
    let displayRows = rows;
    if (statsAnalysisFilter) {
        displayRows = rows.filter(r => r.category === statsAnalysisFilter);
    }
    if (!displayRows.length) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4">暂无成员数据</div>';
        return;
    }
    const order = { '未接龙但参赛': 0, '未接龙未参赛': 1, '已接龙未参赛': 2, '已请假': 3, '已替补': 4, '已接龙且参赛': 5 };
    displayRows.sort((a, b) => order[a.category] - order[b.category]);
    const colors = { '已接龙且参赛': 'green', '已接龙未参赛': 'red', '未接龙但参赛': 'blue', '未接龙未参赛': 'gray', '已请假': 'gray', '已替补': 'yellow' };
    container.innerHTML = `
        <table class="w-full text-sm">
            <thead class="bg-gray-800 sticky top-0"><tr>
                <th class="p-2 text-left">玩家名字</th>
                <th class="p-2 text-left">职业</th>
                <th class="p-2 text-center">是否接龙</th>
                <th class="p-2 text-center">是否参赛</th>
                <th class="p-2 text-center">状态分类</th>
            </tr></thead>
            <tbody>${displayRows.map(r => {
                const c = colors[r.category] || 'gray';
                return `<tr class="border-b border-gray-700 hover:bg-gray-800">
                    <td class="p-2 font-medium">${r.name}</td>
                    <td class="p-2 text-gray-400">${r.profession}</td>
                    <td class="p-2 text-center">${r.isRelay ? '<span class="text-green-400">是</span>' : '<span class="text-red-400">否</span>'}</td>
                    <td class="p-2 text-center">${r.isParticipant ? '<span class="text-green-400">是</span>' : '<span class="text-gray-400">否</span>'}</td>
                    <td class="p-2 text-center">
                        <span class="inline-block w-2 h-2 rounded-full bg-${c}-500 mr-1"></span>
                        <span class="text-${c}-400">${r.category}</span>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
}

function getCurrentSaturday() {
    const d = new Date();
    while (d.getDay() !== 6) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
}

function calculateExpectedBattleCount(joinDateStr) {
    if (!joinDateStr) return 0;
    const joinDate = new Date(joinDateStr);
    joinDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (joinDate > today) return 0;

    const currentSat = getCurrentSaturday();
    let firstSat = new Date(joinDate);
    while (firstSat.getDay() !== 6) firstSat.setDate(firstSat.getDate() + 1);
    firstSat.setHours(0, 0, 0, 0);

    let count = 0;
    for (let d = new Date(firstSat); d <= today; d.setDate(d.getDate() + 7)) {
        const weekDiff = Math.round((currentSat - d) / (7 * 24 * 60 * 60 * 1000));
        count += (weekDiff % 2 === 0) ? 2 : 1;
    }
    return Math.min(3, count);
}

function renderStatsAttendanceRate(allMembers) {
    const container = document.getElementById('statsAttendanceRate');
    if (!container) return;

    // 从 xg_data_import 的多场缓存中读取所有场次
    let multiBattles = [];
    try {
        const cached = localStorage.getItem('multiBattleCache_v4');
        if (cached) multiBattles = JSON.parse(cached);
    } catch (e) {
        console.error('读取多场缓存失败', e);
    }

    if (!multiBattles.length) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4">暂无导入的场次数据，请先在「数据导入」中导入多场帮战数据</div>';
        return;
    }

    const battles = [...multiBattles].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 3);

    const guildName = dataSourceManager.selectedGuild || dataSourceManager.getGuildNames()[0] || localStorage.getItem('xg_nsh_guild1Name') || null;
    if (!guildName) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4">未识别到帮会名称</div>';
        return;
    }

    const count = {};
    allMembers.forEach(m => count[m.name] = 0);

    battles.forEach(battle => {
        const battleData = battle.guilds || battle.data || {};
        const players = battleData[guildName] || [];
        const names = new Set(players.map(p => p['玩家名字']).filter(n => n));
        Object.keys(count).forEach(n => { if (names.has(n)) count[n]++; });
    });

    const data = allMembers.map(m => {
        const expected = calculateExpectedBattleCount(m.joinDate);
        const actual = count[m.name] || 0;
        const rate = expected > 0 ? Math.min(1, actual / expected) : 0;
        return { name: m.name, rate, actual, expected };
    }).sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));

    container.innerHTML = `
        <div class="mb-3 text-sm text-gray-400">按实际应参加场数计算（单周2场 / 双周1场）</div>
        <table class="w-full text-sm">
            <thead class="bg-gray-800 sticky top-0"><tr>
                <th class="p-2 text-left">排名</th>
                <th class="p-2 text-left">玩家名字</th>
                <th class="p-2 text-center">参赛/应参</th>
                <th class="p-2 text-center">参赛率</th>
                <th class="p-2 text-left" style="min-width:120px">进度</th>
            </tr></thead>
            <tbody>${data.map((item, i) => {
                const pct = (item.rate * 100).toFixed(0);
                const color = item.rate >= 0.67 ? 'green' : item.rate >= 0.34 ? 'yellow' : 'red';
                const showRate = item.expected > 0 ? `${pct}%` : '-';
                const showCount = item.expected > 0 ? `${item.actual}/${item.expected}` : `${item.actual}/0`;
                const barWidth = item.expected > 0 ? pct : 0;
                return `<tr class="border-b border-gray-700 hover:bg-gray-800">
                    <td class="p-2 text-gray-400">${i + 1}</td>
                    <td class="p-2 font-medium">${item.name}</td>
                    <td class="p-2 text-center">${showCount}</td>
                    <td class="p-2 text-center font-bold text-${color}-400">${showRate}</td>
                    <td class="p-2"><div class="w-full bg-gray-700 rounded-full h-2">
                        <div class="bg-${color}-500 h-2 rounded-full transition-all" style="width:${barWidth}%"></div>
                    </div></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
}

function loadStatsBattleParticipants() {
    try {
        const saved = localStorage.getItem('statsBattleParticipants');
        if (saved) statsBattleParticipants = JSON.parse(saved);
    } catch (e) {
        console.error('加载统计面板数据失败', e);
        statsBattleParticipants = {};
    }
}
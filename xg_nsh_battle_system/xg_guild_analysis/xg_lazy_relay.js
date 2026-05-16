// ==================== 接龙名单数据管理系统 ====================

// 全局变量存储接龙数据
let relayData = [];
let pendingRelayData = [];
let yxqGroups = [];
let memberIdMap = {};

// 初始化接龙系统
function initRelaySystem() {
    // 从localStorage加载缓存数据
    const cachedRelayData = localStorage.getItem('relayData');
    const cachedYxqGroups = localStorage.getItem('yxqGroups');
    const cachedMemberIdMap = localStorage.getItem('memberIdMap');

    if (cachedRelayData) {
        relayData = JSON.parse(cachedRelayData);
        // 兼容旧数据：xg_relay_yxq_partner 可能是字符串
        relayData.forEach(item => {
            if (item.xg_relay_yxq_partner && !Array.isArray(item.xg_relay_yxq_partner)) {
                item.xg_relay_yxq_partner = [item.xg_relay_yxq_partner];
            }
            if (!item.xg_relay_profession_sub) item.xg_relay_profession_sub = '';
        });
        updateRelayDataUI();
    }

    if (cachedYxqGroups) {
        yxqGroups = JSON.parse(cachedYxqGroups);
        // 兼容旧数据：member1/member2 转为 members 数组
        yxqGroups.forEach(g => {
            if (!g.members && (g.member1 || g.member2)) {
                g.members = [];
                if (g.member1) g.members.push(g.member1);
                if (g.member2) g.members.push(g.member2);
                delete g.member1;
                delete g.member2;
            }
            if (!g.members) g.members = [];
        });
        updateYxqUI();
    }

    if (cachedMemberIdMap) {
        memberIdMap = JSON.parse(cachedMemberIdMap);
        updateMemberIdUpdateTable();
    }
}

// 解析单行接龙数据，支持多种分隔符，支持末尾请假/替补状态
// 增强：支持名字与职业间无分隔符（以职业名锚定分割），如 "曲小盼玄机"
// 增强：支持职业后多个空格，以及缺省搭子时默认填充"无"
// 增强：支持 ID 中包含连字符，如 "曲小盼-玄机 无"
// 增强：支持职业前缀格式 "职业-名字"（如"碎梦-倾城莫离"）和职业后缀格式 "名字-职业"（如"曲小盼-玄机"）
// 增强：支持职业缩写（90->九灵，龙->龙吟）
const RELAY_PROFESSIONS = ['素问', '龙吟', '碎梦', '铁衣', '玄机', '神相', '潮光', '沧澜', '九灵', '血河', '鸿音', '惊鸿', '妙音'];
const PROFESSION_ALIASES = { '90': '九灵', '九0': '九灵', '龙': '龙吟' };

function parseRelayLine(line) {
    let trimmed = line.trim();
    if (!trimmed) return null;
    // 去掉可选序号前缀：1. 1、 1) 1] 等
    trimmed = trimmed.replace(/^\d+[\.\、\)\]\s]+/, '');
    if (!trimmed) return null;

    // 提取末尾状态（请假/替补）
    let status = '';
    const statusMatch = trimmed.match(/\s+(请假|替补)\s*$/);
    if (statusMatch) {
        status = statusMatch[1];
        trimmed = trimmed.replace(/\s+(请假|替补)\s*$/, '').trim();
    }

    // 辅助：标准化职业名（含缩写映射）
    const sortedProfessions = [...RELAY_PROFESSIONS].sort((a, b) => b.length - a.length);
    function normalizeProfession(p) {
        if (!p) return null;
        const s = String(p).trim();
        if (PROFESSION_ALIASES[s]) return PROFESSION_ALIASES[s];
        if (s === '惊鸿' || s === '妙音') return '鸿音';
        return RELAY_PROFESSIONS.includes(s) ? s : null;
    }

    // 辅助：提取搭子
    function extractYxqPartners(rest) {
        if (!rest) return [];
        const s = String(rest).trim();
        if (!s || s === '无' || s.toLowerCase() === 'none' || s.toLowerCase() === 'null') return [];
        return s.split(/[,，]/).map(p => p.trim()).filter(p => p);
    }

    // 辅助：判断字符串是否是职业名
    function isProfession(str) {
        return normalizeProfession(str) !== null;
    }

    // ===== 核心解析 =====
    const spaceParts = trimmed.split(/[\s\t]+/).map(p => p.trim()).filter(p => p);

    // ---- 多段（有空格分隔）----
    if (spaceParts.length >= 2) {
        // 1) 标准格式：第二部分是职业
        const prof = normalizeProfession(spaceParts[1]);
        if (prof) {
            return {
                playerName: spaceParts[0],
                profession: prof,
                yxqPartners: extractYxqPartners(spaceParts.slice(2).join(' ')),
                status
            };
        }

        // 2) "职业-名字" 前缀格式：第一段以 "职业-" 或 "职业_" 开头，如 "碎梦-倾城莫离 无"
        for (const p of sortedProfessions) {
            const m = spaceParts[0].match(new RegExp('^' + p + '[-_](.+)$'));
            if (m) {
                return {
                    playerName: m[1], // 去掉职业前缀后的名字
                    profession: normalizeProfession(p),
                    yxqPartners: extractYxqPartners(spaceParts.slice(1).join(' ')),
                    status
                };
            }
        }

        // 3) 第一段末尾直接含职业名（无连字符，如"雾散尽丶神相 无"），保留完整名字
        for (const p of sortedProfessions) {
            const m = spaceParts[0].match(new RegExp('^(.+)' + p + '$'));
            if (m && m[1]) {
                return {
                    playerName: spaceParts[0], // 保留完整名字
                    profession: normalizeProfession(p),
                    yxqPartners: extractYxqPartners(spaceParts.slice(1).join(' ')),
                    status
                };
            }
        }
    }

    // ---- 单段（无空格）----
    if (spaceParts.length === 1) {
        const text = spaceParts[0];

        // 下划线分隔（如"厢鲤_素问"），保留完整ID
        if (text.includes('_')) {
            const parts = text.split('_');
            const lastProf = normalizeProfession(parts[parts.length - 1]);
            if (lastProf) {
                return { playerName: text, profession: lastProf, yxqPartners: [], status };
            }
        }

        // "职业-名字" 前缀格式（如"潮光-烟婼"）→ 去掉职业前缀
        for (const p of sortedProfessions) {
            const m = text.match(new RegExp('^' + p + '[-_](.+)$'));
            if (m) {
                return { playerName: m[1], profession: normalizeProfession(p), yxqPartners: [], status };
            }
        }

        // "名字-职业" 后缀格式（如"曲小盼-玄机"）→ 保留完整ID
        // 前面的前缀检查已排除以职业开头的情况
        for (const p of sortedProfessions) {
            const m = text.match(new RegExp('^(.+)[-_]' + p + '$'));
            if (m && m[1]) {
                return { playerName: text, profession: normalizeProfession(p), yxqPartners: [], status };
            }
        }

        // 末尾直接含职业名（无显式分隔符，如"雾散尽丶神相"）→ 保留完整ID
        for (const p of sortedProfessions) {
            const m = text.match(new RegExp('^(.+)' + p + '$'));
            if (m && m[1]) {
                return { playerName: text, profession: normalizeProfession(p), yxqPartners: [], status };
            }
        }
    }

    return null;
}

// 导入接龙数据（预览模式）
function importRelayData() {
    const inputText = document.getElementById('relayDataInput').value.trim();
    if (!inputText) {
        alert('请输入接龙名单数据');
        return;
    }

    try {
        const lines = inputText.split('\n');
        const allParsed = [];

        lines.forEach((line, index) => {
            const parsed = parseRelayLine(line);
            if (!parsed) return;
            const { playerName, profession, yxqPartners, status } = parsed;

            // 生成全局唯一ID
            const memberUid = generateMemberUid(playerName, profession);

            allParsed.push({
                xg_relay_id: index + 1,
                xg_relay_player_name: playerName,
                xg_relay_profession: profession,
                xg_relay_yxq_partner: yxqPartners.length > 0 ? yxqPartners : null,
                xg_relay_has_yxq: yxqPartners.length > 0 ? 1 : 0,
                xg_relay_status: status || '',
                member_uid: memberUid,
                xg_relay_index: index
            });
        });

        if (allParsed.length === 0) {
            alert('未解析到有效的接龙数据，请检查格式是否正确');
            return;
        }

        // 数据校验：与帮会成员比对
        const validItems = [];
        const invalidItems = [];
        allParsed.forEach(item => {
            const member = findGuildMemberByName(item.xg_relay_player_name);
            if (member) {
                validItems.push(item);
            } else {
                invalidItems.push(item);
            }
        });

        // 只将通过校验的存入预览数据
        pendingRelayData = validItems;

        // 显示预览列表
        const listContainer = document.getElementById('relayDataList');
        listContainer.classList.remove('hidden');
        let html = '';

        // 通过校验部分
        if (validItems.length > 0) {
            html += `
                <div class="mb-2 p-1 bg-green-900/30 border border-green-600/50 rounded text-center text-xs text-green-400">
                    <i class="fas fa-check-circle mr-1"></i>通过校验（共 ${validItems.length} 条）
                </div>
            `;
            html += validItems.map(item => {
                const statusBadge = item.xg_relay_status
                    ? `<span class="px-1 py-0.5 rounded text-[10px] ml-1 ${item.xg_relay_status === '请假' ? 'bg-gray-600 text-gray-300' : 'bg-yellow-600 text-white'}">${item.xg_relay_status}</span>`
                    : '';
                return `
                <div class="flex justify-between items-center p-1 hover:bg-gray-700 rounded border-l-2 border-green-500">
                    <span class="text-gray-300">${item.xg_relay_player_name}${statusBadge}</span>
                    <span class="text-xs text-gray-400">${item.xg_relay_profession}</span>
                    <span class="text-xs ${item.xg_relay_has_yxq ? 'text-green-400' : 'text-gray-500'}">
                        ${item.xg_relay_has_yxq ? '一线' : '无'}
                    </span>
                </div>
            `}).join('');
        }

        // 未通过校验部分
        if (invalidItems.length > 0) {
            html += `
                <div class="mt-3 mb-2 p-1 bg-red-900/30 border border-red-600/50 rounded text-center text-xs text-red-400">
                    <i class="fas fa-exclamation-triangle mr-1"></i>未通过校验（共 ${invalidItems.length} 条）—— 以下成员未在帮会数据中找到，将不会导入
                </div>
            `;
            html += invalidItems.map(item => {
                const statusBadge = item.xg_relay_status
                    ? `<span class="px-1 py-0.5 rounded text-[10px] ml-1 ${item.xg_relay_status === '请假' ? 'bg-gray-600 text-gray-300' : 'bg-yellow-600 text-white'}">${item.xg_relay_status}</span>`
                    : '';
                return `
                <div class="flex justify-between items-center p-1 hover:bg-gray-700 rounded border-l-2 border-red-500 opacity-70">
                    <span class="text-red-300">${item.xg_relay_player_name}${statusBadge}</span>
                    <span class="text-xs text-gray-400">${item.xg_relay_profession}</span>
                    <span class="text-xs text-red-400">未匹配</span>
                </div>
            `}).join('');
        }

        // 如果帮会成员为空，给出提示
        if (guildMembers.length === 0 && invalidItems.length > 0) {
            html += `
                <div class="mt-2 p-2 bg-yellow-900/20 border border-yellow-600/30 rounded text-center text-xs text-yellow-500">
                    <i class="fas fa-info-circle mr-1"></i>提示：当前帮会成员列表为空，请先导入帮会成员数据
                </div>
            `;
        }

        listContainer.innerHTML = html;

        // 更新按钮状态
        const confirmBtn = document.getElementById('confirmRelayBtn');
        if (confirmBtn) {
            if (validItems.length > 0) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = invalidItems.length > 0
                    ? `导入通过校验的 (${validItems.length})`
                    : `确认识别 (${validItems.length})`;
            } else {
                confirmBtn.disabled = true;
                confirmBtn.textContent = '无可导入数据';
            }
        }

    } catch (error) {
        console.error('解析接龙数据失败:', error);
        alert('解析接龙数据失败，请检查格式');
    }
}

// 确认识别并保存接龙数据
function confirmRelayData() {
    if (!pendingRelayData || pendingRelayData.length === 0) {
        alert('没有待确认的识别数据');
        return;
    }

    // 如果已有接龙数据，询问导入模式
    if (relayData.length > 0) {
        const isAppend = confirm(
            `当前已有 ${relayData.length} 条接龙记录。\n\n` +
            `点击「确定」→ 补充导入（保留原有记录，同名覆盖更新，新增追加）\n` +
            `点击「取消」→ 重新全局导入（清空原有记录，全部重新导入）`
        );
        if (isAppend) {
            // 补充导入：用 Map 去重，同名覆盖，保留旧数据中未更新的
            const mergedMap = new Map();
            relayData.forEach(item => mergedMap.set(item.xg_relay_player_name, item));
            pendingRelayData.forEach(item => mergedMap.set(item.xg_relay_player_name, item));
            relayData = Array.from(mergedMap.values());
        } else {
            relayData = pendingRelayData;
        }
    } else {
        relayData = pendingRelayData;
    }
    pendingRelayData = [];

    // 保存到localStorage
    localStorage.setItem('relayData', JSON.stringify(relayData));

    // 同步接龙职业到帮会成员数据
    let syncCount = 0;
    relayData.forEach(item => {
        const member = findGuildMemberByName(item.xg_relay_player_name);
        if (member) {
            member.profession1 = item.xg_relay_profession;
            syncCount++;
        }
    });
    if (syncCount > 0) {
        saveGuildMembers();
        renderGuildMemberList();
        renderSubGuildList();
    }

    // 更新所有相关UI
    updateRelayDataUI();
    updateYxqMemberList();
    autoAssignYxqGroups(); // 根据接龙数据自动成组
    updateMemberIdUpdateTable();
    renderMemberPool(); // 刷新成员池角标
    refreshStatisticsPanel(); // 刷新数据看板统计

    // 禁用确认识别按钮
    const confirmBtn = document.getElementById('confirmRelayBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '确认识别';
    }

    // 清空输入框
    const input = document.getElementById('relayDataInput');
    if (input) input.value = '';

    console.log(`成功保存 ${relayData.length} 条接龙记录，同步职业 ${syncCount} 人`);
}

// 清空接龙名单数据
function clearRelayData() {
    if (!confirm('确定要清空接龙名单吗？一线牵配对数据也将一并清除。')) return;

    relayData = [];
    pendingRelayData = [];
    yxqGroups = [];
    memberIdMap = {};

    localStorage.removeItem('relayData');
    localStorage.removeItem('yxqGroups');
    localStorage.removeItem('memberIdMap');

    updateRelayDataUI();
    updateYxqMemberList();
    updateYxqUI();
    updateMemberIdUpdateTable();

    const input = document.getElementById('relayDataInput');
    if (input) input.value = '';

    // 禁用确认识别按钮
    const confirmBtn = document.getElementById('confirmRelayBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '确认识别';
    }
}

// 加载接龙文件
function loadRelayFile() {
    document.getElementById('relayFileInput').click();
}

// 处理接龙文件
function handleRelayFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            document.getElementById('relayDataInput').value = e.target.result;
            importRelayData();
        } catch (error) {
            alert('读取文件失败');
        }
    };
    reader.readAsText(file);

    // 清空input，允许重复选择同一文件
    event.target.value = '';
}

// 生成全局唯一ID
function generateMemberUid(playerName, profession) {
    // 使用简单的哈希函数生成唯一ID
    const str = `${playerName}_${profession}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `member_${Math.abs(hash)}_${Date.now()}`;
}

// 更新接龙数据UI
function updateRelayDataUI() {
    document.getElementById('relayCount').textContent = relayData.length;

    const listContainer = document.getElementById('relayDataList');
    if (relayData.length === 0) {
        listContainer.classList.add('hidden');
        return;
    }

    listContainer.classList.remove('hidden');
    listContainer.innerHTML = relayData.map(item => `
        <div class="flex justify-between items-center p-1 hover:bg-gray-700 rounded">
            <span class="text-gray-300">${item.xg_relay_player_name}</span>
            <span class="text-xs text-gray-400">${item.xg_relay_profession}</span>
            <span class="text-xs ${item.xg_relay_has_yxq ? 'text-green-400' : 'text-gray-500'}">
                ${item.xg_relay_has_yxq ? '一线' : '无'}
            </span>
        </div>
    `).join('');
}

// 更新一线牵成员列表
function updateYxqMemberList() {
    if (relayData.length === 0) return;

    const container = document.getElementById('yxqMemberList');
    // 只显示有一线牵的成员，过滤掉 "无"
    const yxqItems = relayData.filter(item => {
        if (!item.xg_relay_has_yxq) return false;
        const partners = Array.isArray(item.xg_relay_yxq_partner)
            ? item.xg_relay_yxq_partner
            : (item.xg_relay_yxq_partner ? [item.xg_relay_yxq_partner] : []);
        return partners.length > 0 && partners.some(p => p && p !== '无');
    });

    if (yxqItems.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 py-4">
                <i class="fas fa-info-circle mr-1"></i>
                暂无一线牵数据
            </div>
        `;
        return;
    }

    container.innerHTML = yxqItems.map((item, index) => {
        const partnerNames = Array.isArray(item.xg_relay_yxq_partner)
            ? item.xg_relay_yxq_partner.join('，')
            : (item.xg_relay_yxq_partner || '');
        const partnerInfo = `<span class="text-xs text-green-400">一线: ${partnerNames}</span>`;

        const groupIndex = getYxqGroupIndexByName(item.xg_relay_player_name);
        const groupNumber = groupIndex >= 0 ? groupIndex + 1 : '';
        const badgeColor = groupIndex >= 0 ? getYxqGroupColor(groupIndex) : '';
        const badgeStyle = badgeColor ? `style="background-color: ${badgeColor}"` : '';

        return `
            <div class="flex justify-between items-center p-2 hover:bg-gray-700 rounded"
                 data-member-uid="${item.member_uid}">
                <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold"
                          id="yxq-badge-${item.member_uid}" ${badgeStyle}>
                        ${groupNumber}
                    </span>
                    <div class="flex flex-col">
                        <span class="text-gray-300 text-sm">${item.xg_relay_player_name}</span>
                        <span class="text-xs text-gray-400">${item.xg_relay_profession}</span>
                    </div>
                </div>
                ${partnerInfo}
            </div>
        `;
    }).join('');
}

// 一线牵配对颜色表（每对使用不同颜色）
const YXQ_PAIR_COLORS = [
    '#ec4899', '#f97316', '#84cc16', '#06b6d4', '#8b5cf6',
    '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#d946ef',
    '#14b8a6', '#f43f5e', '#a855f7', '#eab308', '#6366f1',
    '#e11d48', '#22c55e', '#0ea5e9', '#c2410c', '#7c3aed',
    '#db2777', '#0891b2', '#65a30d', '#b91c1c', '#0d9488',
    '#c026d3', '#2563eb', '#ca8a04', '#be123c', '#4d7c0f',
    '#9333ea', '#0369a1', '#b45309', '#9f1239', '#15803d',
    '#7e22ce', '#0c4a6e', '#a16207', '#881337', '#166534',
    '#6b21a8', '#075985', '#854d0e', '#701a75', '#115e59',
    '#312e81', '#701a75', '#9f1239', '#7c2d12'
];

function getYxqGroupColor(groupIndex) {
    return YXQ_PAIR_COLORS[groupIndex % YXQ_PAIR_COLORS.length] || '#ec4899';
}

// 获取一线牵组号
function getYxqGroupNumber(memberUid) {
    for (let i = 0; i < yxqGroups.length; i++) {
        const group = yxqGroups[i];
        if (group.members && group.members.includes(memberUid)) {
            return i + 1;
        }
    }
    return null;
}

// ================== 玩家名字模糊匹配工具 ==================
function normalizePlayerName(name) {
    if (!name) return '';
    return String(name)
        .replace(/[丶丿灬゛°っゃゅょー·•丨卩乄彡巛氵艹冫丬亻忄讠礻衤钅饣丷\s]/g, '')
        .trim();
}

function findRelayByPlayerName(playerName) {
    let item = relayData.find(r => r.xg_relay_player_name === playerName);
    if (item) return item;
    const norm = normalizePlayerName(playerName);
    return relayData.find(r => normalizePlayerName(r.xg_relay_player_name) === norm);
}

function findGuildMemberByName(name) {
    let m = guildMembers.find(m => m.name === name);
    if (m) return m;
    const norm = normalizePlayerName(name);
    return guildMembers.find(m => normalizePlayerName(m.name) === norm);
}
// ================== 玩家名字模糊匹配工具结束 ==================

// 获取玩家在 yxqGroups 中的组索引
function getYxqGroupIndexByName(playerName) {
    const item = findRelayByPlayerName(playerName);
    if (!item) return -1;
    for (let i = 0; i < yxqGroups.length; i++) {
        const group = yxqGroups[i];
        if (group.members && group.members.includes(item.member_uid)) {
            return i;
        }
    }
    return -1;
}

// 获取玩家的一线牵搭子名字（多人用逗号分隔）
function getYxqPartnerName(playerName) {
    const item = findRelayByPlayerName(playerName);
    if (!item) return null;

    const directPartners = new Set();

    // 该玩家自己声明的搭子（支持多搭子）
    const selfPartners = Array.isArray(item.xg_relay_yxq_partner)
        ? item.xg_relay_yxq_partner
        : (item.xg_relay_yxq_partner ? [item.xg_relay_yxq_partner] : []);
    selfPartners.forEach(p => { if (p && p !== '无') directPartners.add(p); });

    // 反向查找：谁声明了该玩家为搭子（支持多对一）
    const normPlayerName = normalizePlayerName(playerName);
    relayData.forEach(r => {
        if (normalizePlayerName(r.xg_relay_player_name) === normPlayerName) return;
        const othersPartners = Array.isArray(r.xg_relay_yxq_partner)
            ? r.xg_relay_yxq_partner
            : (r.xg_relay_yxq_partner ? [r.xg_relay_yxq_partner] : []);
        if (othersPartners.some(op => normalizePlayerName(op) === normPlayerName)) {
            directPartners.add(r.xg_relay_player_name);
        }
    });

    return directPartners.size > 0 ? Array.from(directPartners).join('，') : null;
}

// 检查玩家是否有一线牵关系
function hasYxqRelation(playerName) {
    return !!getYxqPartnerName(playerName);
}

// 切换一线牵选择
function toggleYxqSelection(memberUid) {
    const relayItem = relayData.find(item => item.member_uid === memberUid);
    if (!relayItem || relayItem.xg_relay_has_yxq === 0) {
        alert('该成员没有一线牵');
        return;
    }

    // 查找当前成员是否已在某个组中
    let currentGroupIndex = -1;
    for (let i = 0; i < yxqGroups.length; i++) {
        if (yxqGroups[i].members && yxqGroups[i].members.includes(memberUid)) {
            currentGroupIndex = i;
            break;
        }
    }

    if (currentGroupIndex !== -1) {
        // 从组中移除
        const group = yxqGroups[currentGroupIndex];
        group.members = group.members.filter(uid => uid !== memberUid);
        if (group.members.length < 2) {
            yxqGroups.splice(currentGroupIndex, 1);
        }
    } else {
        // 查找是否有只有1人的组（可继续加入）
        let availableGroupIndex = -1;
        for (let i = 0; i < yxqGroups.length; i++) {
            if (yxqGroups[i].members && yxqGroups[i].members.length === 1) {
                availableGroupIndex = i;
                break;
            }
        }

        if (availableGroupIndex === -1) {
            yxqGroups.push({
                members: [memberUid],
                xg_yxq_group_id: yxqGroups.length + 1
            });
        } else {
            yxqGroups[availableGroupIndex].members.push(memberUid);
        }
    }

    updateYxqUI();
    localStorage.setItem('yxqGroups', JSON.stringify(yxqGroups));
    renderMemberPool();
}

// 更新一线牵UI
function updateYxqUI() {
    // 更新组数显示（成员数>=2的组才算有效）
    const validGroups = yxqGroups.filter(g => g.members && g.members.length >= 2).length;
    document.getElementById('yxqGroupCount').textContent = `${validGroups}组`;

    // 更新所有徽章（每对使用不同颜色）
    relayData.forEach(item => {
        const badge = document.getElementById(`yxq-badge-${item.member_uid}`);
        if (badge) {
            const groupIndex = getYxqGroupIndexByName(item.xg_relay_player_name);
            const groupNumber = groupIndex >= 0 ? groupIndex + 1 : null;
            const color = groupIndex >= 0 ? getYxqGroupColor(groupIndex) : null;
            badge.textContent = groupNumber || '';
            if (groupNumber) {
                badge.className = 'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold';
                badge.style.backgroundColor = color;
            } else {
                badge.className = 'w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold';
                badge.style.backgroundColor = '';
            }
        }
    });
}

// 根据接龙数据自动分配一线牵组
function autoAssignYxqGroups() {
    yxqGroups = [];
    const assignedUids = new Set();
    let groupId = 1;

    // 构建名字到 uid 的映射
    const nameToUid = {};
    relayData.forEach(item => {
        nameToUid[item.xg_relay_player_name] = item.member_uid;
    });

    relayData.forEach(item => {
        if (assignedUids.has(item.member_uid)) return;
        const partners = Array.isArray(item.xg_relay_yxq_partner) ? item.xg_relay_yxq_partner : (item.xg_relay_yxq_partner ? [item.xg_relay_yxq_partner] : []);
        if (partners.length === 0) return;

        // BFS 收集整个连通组
        const groupUids = new Set([item.member_uid]);
        const queue = [item.member_uid];
        const visited = new Set([item.member_uid]);

        while (queue.length > 0) {
            const currentUid = queue.shift();
            const currentItem = relayData.find(r => r.member_uid === currentUid);
            if (!currentItem) continue;

            // 从当前成员的搭子列表向外扩展
            const currentPartners = Array.isArray(currentItem.xg_relay_yxq_partner)
                ? currentItem.xg_relay_yxq_partner
                : (currentItem.xg_relay_yxq_partner ? [currentItem.xg_relay_yxq_partner] : []);
            currentPartners.forEach(pName => {
                const partnerItem = findRelayByPlayerName(pName);
                if (partnerItem && !visited.has(partnerItem.member_uid)) {
                    visited.add(partnerItem.member_uid);
                    groupUids.add(partnerItem.member_uid);
                    queue.push(partnerItem.member_uid);
                }
            });

            // 反向查找：谁的一线牵包含了当前成员
            relayData.forEach(other => {
                if (other.member_uid === currentUid) return;
                const otherPartners = Array.isArray(other.xg_relay_yxq_partner)
                    ? other.xg_relay_yxq_partner
                    : (other.xg_relay_yxq_partner ? [other.xg_relay_yxq_partner] : []);
                if (otherPartners.includes(currentItem.xg_relay_player_name)) {
                    if (!visited.has(other.member_uid)) {
                        visited.add(other.member_uid);
                        groupUids.add(other.member_uid);
                        queue.push(other.member_uid);
                    }
                }
            });
        }

        if (groupUids.size >= 2) {
            yxqGroups.push({
                members: Array.from(groupUids),
                xg_yxq_group_id: groupId++
            });
            groupUids.forEach(uid => assignedUids.add(uid));
        }
    });

    updateYxqUI();
    localStorage.setItem('yxqGroups', JSON.stringify(yxqGroups));
}

// 清空一线牵配对
function clearYxqGroups() {
    if (!confirm('确定要清空所有一线牵配对吗？')) return;

    yxqGroups = [];
    updateYxqUI();
    localStorage.removeItem('yxqGroups');
}

// 保存一线牵数据
function saveYxqData() {
    localStorage.setItem('yxqGroups', JSON.stringify(yxqGroups));
    alert('一线牵数据已保存到缓存');
}

// 更新成员ID更新表格（模块已移除，保留函数避免报错）
function updateMemberIdUpdateTable() {
    const container = document.getElementById('memberIdUpdateTable');
    if (!container) return;
    if (relayData.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 py-4">
                <i class="fas fa-info-circle mr-1"></i>
                请先导入接龙名单
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="w-full text-xs">
            <thead class="bg-gray-700 sticky top-0">
                <tr>
                    <th class="px-2 py-1 text-left">当前ID</th>
                    <th class="px-2 py-1 text-left">职业</th>
                    <th class="px-2 py-1 text-center">ID变更</th>
                    <th class="px-2 py-1 text-left">新ID</th>
                </tr>
            </thead>
            <tbody>
                ${relayData.map(item => {
                    const mapKey = item.xg_relay_player_name;
                    const mapData = memberIdMap[mapKey] || {
                        hasChanged: false,
                        newId: item.xg_relay_player_name
                    };

                    return `
                        <tr class="border-b border-gray-700 hover:bg-gray-700">
                            <td class="px-2 py-1 text-gray-300">${item.xg_relay_player_name}</td>
                            <td class="px-2 py-1 text-gray-400">${item.xg_relay_profession}</td>
                            <td class="px-2 py-1 text-center">
                                <input type="checkbox" 
                                       ${mapData.hasChanged ? 'checked' : ''} 
                                       onchange="toggleIdChange('${mapKey}')"
                                       class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded">
                            </td>
                            <td class="px-2 py-1">
                                <input type="text" 
                                       value="${mapData.newId}" 
                                       onblur="updateNewId('${mapKey}', this.value)"
                                       class="w-full px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs ${mapData.hasChanged ? '' : 'opacity-50'}"
                                       ${mapData.hasChanged ? '' : 'disabled'}>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// 切换ID变更状态
function toggleIdChange(playerName) {
    if (!memberIdMap[playerName]) {
        memberIdMap[playerName] = {
            hasChanged: false,
            newId: playerName,
            oldId: playerName,
            xg_map_id: generateMemberUid(playerName, 'map')
        };
    }

    memberIdMap[playerName].hasChanged = !memberIdMap[playerName].hasChanged;
    updateMemberIdUpdateTable();
}

// 更新新ID
function updateNewId(playerName, newId) {
    if (!memberIdMap[playerName]) {
        memberIdMap[playerName] = {
            hasChanged: false,
            newId: playerName,
            oldId: playerName,
            xg_map_id: generateMemberUid(playerName, 'map')
        };
    }

    memberIdMap[playerName].newId = newId;
}

// 标记所有ID为已更新
function markAllIdAsUpdated() {
    relayData.forEach(item => {
        const playerName = item.xg_relay_player_name;
        if (!memberIdMap[playerName]) {
            memberIdMap[playerName] = {
                hasChanged: false,
                newId: playerName,
                oldId: playerName,
                xg_map_id: generateMemberUid(playerName, 'map')
            };
        }
        memberIdMap[playerName].hasChanged = true;
    });
    updateMemberIdUpdateTable();
}

// 保存ID映射数据
function saveIdMapData() {
    localStorage.setItem('memberIdMap', JSON.stringify(memberIdMap));
    alert('ID映射数据已保存到缓存');
}

// 获取用于智能分团的筛选后数据
function getFilteredDataForSmartGrouping() {
    if (relayData.length === 0) {
        alert('请先导入接龙名单');
        return null;
    }

    const selectedGuild = dataSourceManager.selectedGuild;
    if (!selectedGuild) {
        alert('请先选择帮会');
        return null;
    }

    const guildData = dataSourceManager.getGuildData(selectedGuild);
    if (!guildData || guildData.length === 0) {
        alert('当前帮会没有数据');
        return null;
    }

    // 基于接龙名单筛选数据
    const relayPlayerNames = relayData.map(item => normalizePlayerName(item.xg_relay_player_name));
    const filteredData = guildData.filter(player => {
        const playerName = player['玩家名字'];
        return relayPlayerNames.includes(normalizePlayerName(playerName));
    });

    // 添加全局唯一ID
    const dataWithUid = filteredData.map(player => {
        const playerName = player['玩家名字'];
        const profession = player['职业'];
        
        // 查找对应的接龙数据以获取member_uid
        const relayItem = findRelayByPlayerName(playerName);

        return {
            ...player,
            member_uid: relayItem ? relayItem.member_uid : generateMemberUid(playerName, profession),
            xg_bz_source: 'battle_data',
            xg_bz_import_time: new Date().toISOString()
        };
    });

    return dataWithUid;
}

// 导出数据（带前缀映射，FDH加密格式）
async function exportDataWithPrefixMapping() {
    if (relayData.length === 0) {
        alert('没有数据可导出');
        return;
    }

    const exportData = {
        relay_data: relayData,
        yxq_groups: yxqGroups,
        member_id_map: memberIdMap,
        export_time: new Date().toISOString(),
        version: '1.0'
    };

    const encrypted = await XG_CRYPTO_MODULE.exportEncrypted(exportData, 'xg_guild_crypto_key', 'relay-data');
    downloadJsonFile(encrypted, generateXgFilename('接龙数据'));
}

// 导入数据（带前缀映射，支持FDH加密及旧格式兼容）
async function importDataWithPrefixMapping(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const content = e.target.result;
            let data;
            if (content.trim().startsWith('FDHTXT1')) {
                data = await XG_CRYPTO_MODULE.importEncrypted(content, 'xg_guild_crypto_key');
            } else {
                const fileObj = JSON.parse(content);
                if (fileObj._xg_crypto) {
                    data = await XG_CRYPTO_MODULE.importEncrypted(fileObj, 'xg_guild_crypto_key');
                } else {
                    data = fileObj; // 兼容旧格式明文
                }
            }
            
            relayData = data.relay_data || [];
            yxqGroups = data.yxq_groups || [];
            memberIdMap = data.member_id_map || {};

            updateRelayDataUI();
            updateYxqUI();
            updateMemberIdUpdateTable();

            localStorage.setItem('relayData', JSON.stringify(relayData));
            localStorage.setItem('yxqGroups', JSON.stringify(yxqGroups));
            localStorage.setItem('memberIdMap', JSON.stringify(memberIdMap));

            alert('数据导入成功');
        } catch (error) {
            console.error('导入失败:', error);
            alert('导入失败：' + (error.message || '文件格式错误'));
        }
    };
    reader.readAsText(file);
}

// 更新成员池筛选
function updateMemberPoolFilter() {
    // 更新接龙筛选人数显示
    if (relayData.length > 0) {
        document.getElementById('relayFilterCount').textContent = relayData.length;
    }

    // 重新渲染成员池与团内排表（确保底色实时刷新）
    renderMemberPool();
    renderAllTeams();
    updateTeamAnalysisTable();
    updateTeamRightPanel();
}
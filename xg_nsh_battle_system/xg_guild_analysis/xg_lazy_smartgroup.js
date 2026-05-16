// ==================== 智能分团系统 ====================

let smartGroupResult = null;

// 初始化智能分团团队选择
function initSmartGroupTeamSelect() {
    const select = document.getElementById('smartGroupTargetTeam');
    if (!select) return;
    
    const teams = Object.keys(teamStructure);
    
    select.innerHTML = '<option value="">选择团队...</option>' +
        teams.map(team => `<option value="${team}">${team}</option>`).join('');
}

// 更新智能分团配置（当选择团队时）
function updateSmartGroupConfig() {
    const teamName = document.getElementById('smartGroupTargetTeam').value;
    const professionList = document.getElementById('professionConfigList');
    
    if (!teamName || !teamStructure[teamName]) {
        professionList.innerHTML = '<p class="text-gray-400">请选择团队后配置</p>';
        return;
    }
    
    const groups = teamStructure[teamName];
    const professions = ['铁衣', '血河', '素问', '九灵', '龙吟', '碎梦', '神相', '玄机', '潮光', '沧澜'];
    
    professionList.innerHTML = groups.map((group, idx) => `
        <div class="border border-gray-600 rounded p-2 mb-2">
            <h5 class="font-bold text-sm text-blue-400 mb-2">${group.name} (${group.limit}人)</h5>
            <div class="grid grid-cols-2 gap-2 text-xs">
                ${professions.map(prof => `
                    <div class="flex items-center justify-between">
                        <span>${prof}</span>
                        <input type="number" min="0" max="${group.limit}" value="0" 
                               class="w-12 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white"
                               id="prof-config-${idx}-${prof}">
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// 开始智能分团
function startSmartGrouping() {
    const teamName = document.getElementById('smartGroupTargetTeam').value;
    const strategy = document.getElementById('smartGroupStrategy').value;
    const considerYxq = document.getElementById('smartGroupConsiderYxq').checked;
    const filterByRelay = document.getElementById('smartGroupFilterByRelay').checked;
    
    if (!teamName || !teamStructure[teamName]) {
        alert('请先选择要分配的团队');
        return;
    }
    
    // 获取可用成员
    const selectedGuild = dataSourceManager.selectedGuild;
    let players = selectedGuild ? dataSourceManager.getGuildData(selectedGuild) : dataSourceManager.getAllPlayers();
    
    // 过滤已在团队中的成员
    const assignedPlayers = getAllAssignedPlayers();
    players = players.filter(p => !assignedPlayers.includes(p['玩家名字']));
    
    // 基于接龙名单筛选
    if (filterByRelay && relayData.length > 0) {
        const relayPlayerNames = relayData.map(item => normalizePlayerName(item.xg_relay_player_name));
        players = players.filter(p => relayPlayerNames.includes(normalizePlayerName(p['玩家名字'])));
    }
    
    if (players.length === 0) {
        alert('没有可用成员进行分配');
        return;
    }
    
    // 获取职业配置
    const groups = teamStructure[teamName];
    const professionConfig = {};
    
    groups.forEach((group, idx) => {
        professionConfig[idx] = {};
        ['铁衣', '血河', '素问', '九灵', '龙吟', '碎梦', '神相', '玄机', '潮光', '沧澜'].forEach(prof => {
            const input = document.getElementById(`prof-config-${idx}-${prof}`);
            if (input) {
                professionConfig[idx][prof] = parseInt(input.value) || 0;
            }
        });
    });
    
    // 执行智能分配算法
    smartGroupResult = performSmartGrouping(players, groups, professionConfig, strategy, considerYxq);
    
    // 显示结果
    displaySmartGroupResult(smartGroupResult);
    
    // 启用导入按钮
    document.getElementById('importToSquadBtn').disabled = false;
}

// 执行智能分配算法（简化版）
function performSmartGrouping(players, groups, professionConfig, strategy, considerYxq) {
    const result = {
        teamName: '',
        groups: []
    };
    
    // 按策略排序玩家
    let sortedPlayers = [...players];
    switch (strategy) {
        case 'damage':
            sortedPlayers.sort((a, b) => (b['对玩家伤害'] || 0) - (a['对玩家伤害'] || 0));
            break;
        case 'defense':
            sortedPlayers.sort((a, b) => (b['承受伤害'] || 0) - (a['承受伤害'] || 0));
            break;
        default:
            // 平衡策略：按综合评分排序
            sortedPlayers.sort((a, b) => {
                const scoreA = calculatePlayerBalanceScore(a);
                const scoreB = calculatePlayerBalanceScore(b);
                return scoreB - scoreA;
            });
    }
    
    // 为每个组分配成员
    groups.forEach((group, groupIdx) => {
        const groupResult = {
            name: group.name,
            limit: group.limit,
            members: [],
            professionCount: {}
        };
        
        // 初始化职业计数
        Object.keys(professionConfig[groupIdx] || {}).forEach(prof => {
            groupResult.professionCount[prof] = 0;
        });
        
        // 根据职业配置分配成员
        const config = professionConfig[groupIdx] || {};
        Object.entries(config).forEach(([prof, count]) => {
            if (count <= 0) return;
            
            const profPlayers = sortedPlayers.filter(p => p['职业'] === prof);
            for (let i = 0; i < Math.min(count, profPlayers.length) && groupResult.members.length < group.limit; i++) {
                const player = profPlayers[i];
                if (!groupResult.members.find(m => m['玩家名字'] === player['玩家名字'])) {
                    groupResult.members.push(player);
                    groupResult.professionCount[prof] = (groupResult.professionCount[prof] || 0) + 1;
                    
                    // 从可用列表中移除
                    const idx = sortedPlayers.indexOf(player);
                    if (idx > -1) sortedPlayers.splice(idx, 1);
                }
            }
        });
        
        // 填充剩余位置
        while (groupResult.members.length < group.limit && sortedPlayers.length > 0) {
            const nextPlayer = sortedPlayers.shift();
            if (!groupResult.members.find(m => m['玩家名字'] === nextPlayer['玩家名字'])) {
                groupResult.members.push(nextPlayer);
                const prof = nextPlayer['职业'];
                groupResult.professionCount[prof] = (groupResult.professionCount[prof] || 0) + 1;
            }
        }
        
        result.groups.push(groupResult);
    });
    
    return result;
}

// 计算玩家平衡评分
function calculatePlayerBalanceScore(player) {
    const damage = parseFloat(player['对玩家伤害']) || 0;
    const kills = parseFloat(player['击败']) || 0;
    const assists = parseFloat(player['助攻']) || 0;
    const healing = parseFloat(player['治疗值']) || 0;
    
    // 归一化评分
    const damageScore = Math.min(100, damage / 10000);
    const killsScore = kills * 5;
    const assistsScore = assists * 2;
    const healingScore = Math.min(100, healing / 5000);
    
    return damageScore + killsScore + assistsScore + healingScore;
}

// 显示智能分团结果
function displaySmartGroupResult(result) {
    const container = document.getElementById('smartGroupResult');
    
    if (!result || result.groups.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                <p>分团失败，请检查配置</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = result.groups.map(group => `
        <div class="border border-gray-600 rounded-lg p-4 mb-3">
            <div class="flex justify-between items-center mb-2">
                <h5 class="font-bold text-blue-400">${group.name}</h5>
                <span class="text-xs text-gray-400">${group.members.length}/${group.limit}人</span>
            </div>
            
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-2">
                ${group.members.map(member => `
                    <div class="bg-gray-700 rounded p-2 text-xs">
                        <div class="font-medium text-white">${member['玩家名字']}</div>
                        <div class="text-gray-400">${member['职业']}</div>
                    </div>
                `).join('')}
            </div>
            
            <div class="text-xs text-gray-400">
                职业配置: ${Object.entries(group.professionCount).filter(([,count]) => count > 0).map(([prof, count]) => `${prof}×${count}`).join(', ')}
            </div>
        </div>
    `).join('');
}

// 一键导入小队排表
function importToSquadBuilder() {
    if (!smartGroupResult || !smartGroupResult.groups || smartGroupResult.groups.length === 0) {
        alert('没有可导入的分团结果');
        return;
    }
    
    const teamName = document.getElementById('smartGroupTargetTeam').value;
    if (!teamName || !teamStructure[teamName]) {
        alert('目标团队不存在');
        return;
    }
    
    // 清空现有组成员
    teamStructure[teamName].forEach(group => {
        group.members = [];
    });
    
    // 导入智能分团结果
    smartGroupResult.groups.forEach((smartGroup, idx) => {
        if (teamStructure[teamName][idx]) {
            teamStructure[teamName][idx].members = smartGroup.members.map(m => m['玩家名字']);
        }
    });
    
    // 切换到小队排表标签
    const squadBuilderBtn = document.querySelector('button[onclick*="squadBuilder"]');
    if (squadBuilderBtn) {
        squadBuilderBtn.click();
    }
    
    // 重新渲染
    renderAllTeams();
    updateTeamAnalysisTable();
    updateTeamRightPanel();
    
    alert('智能分团结果已成功导入小队排表！');
}

// 清空智能分团结果
function clearSmartGroupResult() {
    smartGroupResult = null;
    document.getElementById('smartGroupResult').innerHTML = `
        <div class="text-center text-gray-400 py-8">
            <i class="fas fa-info-circle text-2xl mb-2"></i>
            <p>点击"开始智能分团"查看结果</p>
        </div>
    `;
    document.getElementById('importToSquadBtn').disabled = true;
}
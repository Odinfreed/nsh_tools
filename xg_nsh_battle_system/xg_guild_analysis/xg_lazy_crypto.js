// ==================== XG 加密模块 (v1.0.0.0) ====================
const XG_CRYPTO_MODULE = (function() {
    const CRYPTO_VERSION = '1.0.0.0';
    const SITE_INFO = '联赛智能分团系统';
    const IRREDUCIBLE_POLY = 0x11b; // AES不可约多项式 x^8+x^4+x^3+x+1
    const AFFINE_CONST = 0x63;
    const CHUNK_SIZE = 256 * 1024; // 256KB

    // GF(2^8) 乘法
    function gfMul(a, b) {
        let p = 0;
        for (let i = 0; i < 8; i++) {
            if (b & 1) p ^= a;
            const hi = a & 0x80;
            a <<= 1;
            if (hi) a ^= 0x1b;
            b >>= 1;
        }
        return p & 0xFF;
    }

    // GF(2^8) 乘法逆元（费马小定理 a^(254)=a^(-1)）
    function gfInv(a) {
        if (a === 0) return 0;
        let result = 1;
        let base = a;
        for (let i = 0; i < 8; i++) {
            if ((254 >> i) & 1) result = gfMul(result, base);
            base = gfMul(base, base);
        }
        return result;
    }

    // 仿射变换（AES标准）
    function affineTransform(x) {
        let y = 0;
        for (let i = 0; i < 8; i++) {
            const bit = ((x >> i) & 1) ^
                        ((x >> ((i + 4) % 8)) & 1) ^
                        ((x >> ((i + 5) % 8)) & 1) ^
                        ((x >> ((i + 6) % 8)) & 1) ^
                        ((x >> ((i + 7) % 8)) & 1) ^
                        ((AFFINE_CONST >> i) & 1);
            y |= (bit << i);
        }
        return y & 0xFF;
    }

    // 预计算 S-Box 和逆 S-Box
    const SBOX = new Uint8Array(256);
    const ISBOX = new Uint8Array(256);
    (function initSBox() {
        for (let i = 0; i < 256; i++) {
            const inv = gfInv(i);
            const sb = affineTransform(inv);
            SBOX[i] = sb;
            ISBOX[sb] = i;
        }
    })();

    // 字符串转 UTF-8 字节数组
    function stringToBytes(str) {
        return new TextEncoder().encode(str);
    }
    function bytesToString(bytes) {
        return new TextDecoder().decode(bytes);
    }

    // 密钥派生
    function deriveKey(keyStr) {
        const bytes = stringToBytes(keyStr);
        if (bytes.length === 0) return new Uint8Array([0]);
        return bytes;
    }

    // 单字节三轮加密
    function encryptByte(p, keyBytes, globalIndex) {
        let b = p;
        const keyLen = keyBytes.length;
        for (let round = 0; round < 3; round++) {
            const ki = keyBytes[(globalIndex + round) % keyLen];
            b = b ^ ki;                          // (一) XOR
            b = SBOX[b];                         // (二) S-Box
            b = ((b << 3) | (b >>> 5)) & 0xFF;   // (三) 循环左移3位
            b = (b + round + globalIndex) & 0xFF; // (四) 动态偏移
        }
        return b;
    }

    // 单字节三轮解密
    function decryptByte(c, keyBytes, globalIndex) {
        let b = c;
        const keyLen = keyBytes.length;
        for (let round = 2; round >= 0; round--) {
            b = (b - round - globalIndex) & 0xFF;       // (一) 逆向偏移
            b = ((b >>> 3) | (b << 5)) & 0xFF;          // (二) 循环右移3位
            b = ISBOX[b];                               // (三) 逆 S-Box
            const ki = keyBytes[(globalIndex + round) % keyLen];
            b = b ^ ki;                                 // (四) XOR还原
        }
        return b;
    }

    // Base64 编解码
    function bytesToBase64(bytes) {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    function base64ToBytes(b64) {
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    // 异步分片加密（ECMAScript异步模型 + setTimeout释放主线程）
    async function encryptAsync(plainText, keyStr) {
        const plainBytes = stringToBytes(plainText);
        const keyBytes = deriveKey(keyStr);
        const totalLen = plainBytes.length;
        const cipherBytes = new Uint8Array(totalLen);
        let offset = 0;
        while (offset < totalLen) {
            const end = Math.min(offset + CHUNK_SIZE, totalLen);
            for (let i = offset; i < end; i++) {
                cipherBytes[i] = encryptByte(plainBytes[i], keyBytes, i);
            }
            offset = end;
            if (offset < totalLen) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        return bytesToBase64(cipherBytes);
    }

    // 异步分片解密
    async function decryptAsync(cipherBase64, keyStr) {
        const cipherBytes = base64ToBytes(cipherBase64);
        const keyBytes = deriveKey(keyStr);
        const totalLen = cipherBytes.length;
        const plainBytes = new Uint8Array(totalLen);
        let offset = 0;
        while (offset < totalLen) {
            const end = Math.min(offset + CHUNK_SIZE, totalLen);
            for (let i = offset; i < end; i++) {
                plainBytes[i] = decryptByte(cipherBytes[i], keyBytes, i);
            }
            offset = end;
            if (offset < totalLen) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        return bytesToString(plainBytes);
    }

    // MD5 哈希（用于完整性校验）
    function md5Hex(input) {
        const hc = '0123456789abcdef';
        function rh(n) { let j, s = ''; for (j = 0; j <= 3; j++) s += hc.charAt((n >> (j * 8 + 4)) & 0x0F) + hc.charAt((n >> (j * 8)) & 0x0F); return s; }
        function ad(x, y) { const l = (x & 0xFFFF) + (y & 0xFFFF), m = (x >> 16) + (y >> 16) + (l >> 16); return (m << 16) | (l & 0xFFFF); }
        function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
        function cm(q, a, b, x, s, t) { return ad(rl(ad(ad(a, q), ad(x, t)), s), b); }
        function ff(a, b, c, d, x, s, t) { return cm((b & c) | ((~b) & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cm((b & d) | (c & (~d)), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cm(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cm(c ^ (b | (~d)), a, b, x, s, t); }
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        let olda, oldb, oldc, oldd;
        const txt = unescape(encodeURIComponent(input));
        const wl = ((txt.length + 8) >> 6) + 1;
        const w = new Array(wl * 16);
        for (let i = 0; i < wl * 16; i++) w[i] = 0;
        for (let i = 0; i < txt.length; i++) w[i >> 2] |= txt.charCodeAt(i) << ((i % 4) << 3);
        w[txt.length >> 2] |= 0x80 << ((txt.length % 4) << 3);
        w[wl * 16 - 2] = txt.length * 8;
        for (let i = 0; i < wl * 16; i += 16) {
            olda = a; oldb = b; oldc = c; oldd = d;
            a = ff(a, b, c, d, w[i+0], 7, -680876936);
            d = ff(d, a, b, c, w[i+1], 12, -389564586);
            c = ff(c, d, a, b, w[i+2], 17, 606105819);
            b = ff(b, c, d, a, w[i+3], 22, -1044525330);
            a = ff(a, b, c, d, w[i+4], 7, -176418897);
            d = ff(d, a, b, c, w[i+5], 12, 1200080426);
            c = ff(c, d, a, b, w[i+6], 17, -1473231341);
            b = ff(b, c, d, a, w[i+7], 22, -45705983);
            a = ff(a, b, c, d, w[i+8], 7, 1770035416);
            d = ff(d, a, b, c, w[i+9], 12, -1958414417);
            c = ff(c, d, a, b, w[i+10], 17, -42063);
            b = ff(b, c, d, a, w[i+11], 22, -1990404162);
            a = ff(a, b, c, d, w[i+12], 7, 1804603682);
            d = ff(d, a, b, c, w[i+13], 12, -40341101);
            c = ff(c, d, a, b, w[i+14], 17, -1502002290);
            b = ff(b, c, d, a, w[i+15], 22, 1236535329);
            a = gg(a, b, c, d, w[i+1], 5, -165796510);
            d = gg(d, a, b, c, w[i+6], 9, -1069501632);
            c = gg(c, d, a, b, w[i+11], 14, 643717713);
            b = gg(b, c, d, a, w[i+0], 20, -373897302);
            a = gg(a, b, c, d, w[i+5], 5, -701558691);
            d = gg(d, a, b, c, w[i+10], 9, 38016083);
            c = gg(c, d, a, b, w[i+15], 14, -660478335);
            b = gg(b, c, d, a, w[i+4], 20, -405537848);
            a = gg(a, b, c, d, w[i+9], 5, 568446438);
            d = gg(d, a, b, c, w[i+14], 9, -1019803690);
            c = gg(c, d, a, b, w[i+3], 14, -187363961);
            b = gg(b, c, d, a, w[i+8], 20, 1163531501);
            a = gg(a, b, c, d, w[i+13], 5, -1444681467);
            d = gg(d, a, b, c, w[i+2], 9, -51403784);
            c = gg(c, d, a, b, w[i+7], 14, 1735328473);
            b = gg(b, c, d, a, w[i+12], 20, -1926607734);
            a = hh(a, b, c, d, w[i+5], 4, -378558);
            d = hh(d, a, b, c, w[i+8], 11, -2022574463);
            c = hh(c, d, a, b, w[i+11], 16, 1839030562);
            b = hh(b, c, d, a, w[i+14], 23, -35309556);
            a = hh(a, b, c, d, w[i+1], 4, -1530992060);
            d = hh(d, a, b, c, w[i+4], 11, 1272893353);
            c = hh(c, d, a, b, w[i+7], 16, -155497632);
            b = hh(b, c, d, a, w[i+10], 23, -1094730640);
            a = hh(a, b, c, d, w[i+13], 4, 681279174);
            d = hh(d, a, b, c, w[i+0], 11, -358537222);
            c = hh(c, d, a, b, w[i+3], 16, -722521979);
            b = hh(b, c, d, a, w[i+6], 23, 76029189);
            a = hh(a, b, c, d, w[i+9], 4, -640364487);
            d = hh(d, a, b, c, w[i+12], 11, -421815835);
            c = hh(c, d, a, b, w[i+15], 16, 530742520);
            b = hh(b, c, d, a, w[i+2], 23, -995338651);
            a = ii(a, b, c, d, w[i+0], 6, -198630844);
            d = ii(d, a, b, c, w[i+7], 10, 1126891415);
            c = ii(c, d, a, b, w[i+14], 15, -1416354905);
            b = ii(b, c, d, a, w[i+5], 21, -57434055);
            a = ii(a, b, c, d, w[i+12], 6, 1700485571);
            d = ii(d, a, b, c, w[i+3], 10, -1894986606);
            c = ii(c, d, a, b, w[i+10], 15, -1051523);
            b = ii(b, c, d, a, w[i+1], 21, -2054922799);
            a = ii(a, b, c, d, w[i+8], 6, 1873313359);
            d = ii(d, a, b, c, w[i+15], 10, -30611744);
            c = ii(c, d, a, b, w[i+6], 15, -1560198380);
            b = ii(b, c, d, a, w[i+13], 21, 1309151649);
            a = ii(a, b, c, d, w[i+4], 6, -145523070);
            d = ii(d, a, b, c, w[i+11], 10, -1120210379);
            c = ii(c, d, a, b, w[i+2], 15, 718787259);
            b = ii(b, c, d, a, w[i+9], 21, -343485551);
            a = ad(a, olda); b = ad(b, oldb); c = ad(c, oldc); d = ad(d, oldd);
        }
        return rh(a) + rh(b) + rh(c) + rh(d);
    }

    // Gzip 压缩/解压（用于大文件自动压缩）
    async function gzipString(str) {
        const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
        const reader = stream.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }
    async function gunzipBytes(bytes) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const reader = stream.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return new TextDecoder().decode(result);
    }

    // 构建头部信息（盐值+网站信息+加密模块版本号）
    function buildHeader(moduleName) {
        const now = Date.now();
        return {
            salt: now,
            siteInfo: SITE_INFO,
            cryptoVersion: CRYPTO_VERSION,
            timestamp: new Date(now).toISOString(),
            module: moduleName || 'unknown',
            websiteUrl: 'https://odinfreed.github.io/nsh_tools/',
            githubUrl: 'https://github.com/Odinfreed/nsh_tools',
            starMessage: '🌟 欢迎Star和Fork本项目！',
            epilogue: '愿我如星君如月，夜夜流光相皎洁。\n春风若有怜花意，可否许我再少年。\n愿如星月伴流光，意气永相随。成长如星河清晰。春风怜花意，许你再少年。\nFrom：春风渡-春风渡星河'
        };
    }

    // 导出封装：返回纯文本 FDH 格式字符串
    async function exportEncrypted(dataObj, keyStr, moduleName) {
        const header = buildHeader(moduleName);
        let plainText = JSON.stringify(dataObj);
        let isZipped = false;

        // 数据过大时自动压缩（>500KB）
        if (plainText.length > 500 * 1024 && typeof CompressionStream !== 'undefined') {
            const compressed = await gzipString(plainText);
            plainText = bytesToBase64(compressed);
            isZipped = true;
        }

        const payload = await encryptAsync(plainText, keyStr);
        const hash = md5Hex(payload);

        const lines = [];
        lines.push('FDHTXT1');
        lines.push('S:' + header.salt);
        lines.push('SI:' + header.siteInfo);
        lines.push('V:' + header.cryptoVersion);
        lines.push('T:' + header.timestamp);
        lines.push('M:' + header.module);
        lines.push('U:' + header.websiteUrl);
        lines.push('GH:' + header.githubUrl);
        lines.push('MS:' + header.starMessage);
        lines.push('H:' + hash);
        if (isZipped) lines.push('ZIP:1');
        lines.push('# 以下为加密数据，需通过本系统解密查看 #');
        lines.push('---');
        for (let i = 0; i < payload.length; i += 72) {
            lines.push(payload.slice(i, i + 72));
        }
        lines.push('---');
        lines.push(header.epilogue);
        lines.push(''); // 表尾寄语末尾增加一个空行
        return lines.join('\n');
    }

    // 导入解包（支持新纯文本格式及旧版JSON对象兼容）
    async function importEncrypted(source, keyStr) {
        // 兼容旧版 JSON 对象格式
        if (source && typeof source === 'object' && source._xg_crypto) {
            const plainText = await decryptAsync(source.payload, keyStr);
            return JSON.parse(plainText);
        }
        if (typeof source !== 'string') {
            throw new Error('文件格式不正确：无法识别的数据类型');
        }

        const text = source.trim();
        if (!text.startsWith('FDHTXT1')) {
            throw new Error('文件格式不正确：缺少魔数标识或文件已损坏');
        }

        const lines = text.split('\n');
        const headerMap = {};
        let i = 1;
        for (; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '# 以下为加密数据，需通过本系统解密查看 #' || line === '---') break;
            if (!line) continue;
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                headerMap[line.slice(0, colonIdx)] = line.slice(colonIdx + 1);
            }
        }

        // 跳过注释行和起始 ---
        while (i < lines.length && lines[i].trim() !== '---') i++;
        if (i >= lines.length) throw new Error('文件格式不正确：缺少密文起始标记');
        i++; // skip ---

        const payloadLines = [];
        while (i < lines.length && lines[i].trim() !== '---') {
            payloadLines.push(lines[i].trim());
            i++;
        }
        const payload = payloadLines.join('');

        // 校验 HASH
        if (headerMap.H) {
            const actualHash = md5Hex(payload);
            if (actualHash !== headerMap.H) {
                throw new Error('文件完整性校验失败：密文可能已损坏');
            }
        }

        let plainText = await decryptAsync(payload, keyStr);

        // 自动解压
        if (headerMap.ZIP === '1') {
            if (typeof DecompressionStream === 'undefined') {
                throw new Error('当前浏览器不支持自动解压，请使用支持 CompressionStream 的现代浏览器');
            }
            const compressedBytes = base64ToBytes(plainText);
            plainText = await gunzipBytes(compressedBytes);
        }

        return JSON.parse(plainText);
    }

    return {
        version: CRYPTO_VERSION,
        siteInfo: SITE_INFO,
        encryptAsync,
        decryptAsync,
        buildHeader,
        exportEncrypted,
        importEncrypted
    };
})();

// 通用下载FDH加密数据文件
function downloadJsonFile(content, filename) {
    const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 统一文件名生成器：逆水寒帮战分团系统_模块名_年_月_日_时_分_秒.fdh
function generateXgFilename(moduleName) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
    return `逆水寒帮战分团系统_${moduleName}_${ts}.fdh`;
}

// 辅助：转义单引号等用于内联JS字符串
function escapeStringForJS(s) {
    return (s + '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 4. 数据看板
function updateConfigWeight(type, value) {
    document.getElementById(`config-${type}-val`).textContent = value;
    teamConfig.weights[type] = parseFloat(value);
}

function saveTeamConfig() {
    // 保存波动计算方法
    const methodSelect = document.getElementById('fluctuationMethod');
    if (methodSelect) {
        teamConfig.fluctuationMethod = methodSelect.value;
    }

    // 保存显示模式
    const displaySelect = document.getElementById('displayMode');
    if (displaySelect) {
        teamConfig.displayMode = displaySelect.value;
    }

    // 更新预览
    document.getElementById('weight-output').textContent = teamConfig.weights.output.toFixed(1);
    document.getElementById('weight-kills').textContent = teamConfig.weights.kills.toFixed(1);
    document.getElementById('weight-building').textContent = teamConfig.weights.building.toFixed(1);
    document.getElementById('weight-survival').textContent = teamConfig.weights.survival.toFixed(1);
    document.getElementById('weight-support').textContent = teamConfig.weights.support.toFixed(1);

    alert('配置已保存！');
}

function resetTeamConfig() {
    teamConfig = {
        weights: { output: 1.0, kills: 1.0, building: 1.0, survival: 1.0, support: 1.0 },
        fluctuationMethod: 'diff_ratio',
        displayMode: 'data'
    };

    // 重置UI
    ['output', 'kills', 'building', 'survival', 'support'].forEach(type => {
        const slider = document.getElementById(`config-${type}`);
        if (slider) slider.value = 1;
        document.getElementById(`config-${type}-val`).textContent = '1.0';
    });

    const methodSelect = document.getElementById('fluctuationMethod');
    if (methodSelect) methodSelect.value = 'diff_ratio';

    const displaySelect = document.getElementById('displayMode');
    if (displaySelect) displaySelect.value = 'data';

    alert('配置已重置为默认值！');
}

// 预览并导出出场率数据
function previewAndExportAttendance() {
    const selectedGuild = dataSourceManager.selectedGuild;
    if (!selectedGuild) {
        alert('请先选择一个帮会');
        return;
    }
    
    // 从guildDataBaseline.playerStats获取数据
    const playerStats = guildDataBaseline.playerStats;
    const playerNames = Object.keys(playerStats);
    
    if (playerNames.length === 0) {
        alert('该帮会暂无数据，请先点击"计算波动数据"');
        return;
    }
    
    // 获取总场次
    const sessionIds = dataSourceManager.getGuildSessions(selectedGuild);
    const totalSessions = sessionIds.length;
    
    if (totalSessions === 0) {
        alert('该帮会暂无场次数据');
        return;
    }
    
    // 准备预览数据
    let previewData = [];
    let totalAttendance = 0;
    
    playerNames.forEach(playerName => {
        const playerData = playerStats[playerName];
        const professions = playerData.allProfessions || [];
        
        // BUG修复：确保即使只有一个职业也能正确获取数据
        let mainProfession = professions[0] || '未知'; // 默认第一个职业
        let maxSessions = 0;
        let actualSessions = 0;
        let maxCredibility = 0;
        let mainFocus = '综合';
        let firstProfessionCount = 0;  // 一职出场次数
        let secondProfessionCount = 0; // 二职出场次数
        
        // 找到场次最多的职业（主要职业）
        professions.forEach((profession, index) => {
            const stats = playerData[profession];
            if (stats && stats.sessionCount !== undefined) {
                // 更新最大出场次数和对应职业
                if (stats.sessionCount > maxSessions) {
                    maxSessions = stats.sessionCount;
                    mainProfession = profession;
                }
                
                // 更新总出场次数（所有职业合计）- 累加所有职业的出场次数
                actualSessions += stats.sessionCount;
                
                // 记录一职和二职的出场次数
                if (index === 0) {
                    firstProfessionCount = stats.sessionCount;
                } else if (index === 1) {
                    secondProfessionCount = stats.sessionCount;
                }
                
                // 更新最大可信度
                if (stats.credibility > maxCredibility) {
                    maxCredibility = stats.credibility;
                }
                
                // 计算主要侧重（使用场次最多的职业的focusMetrics）
                if (profession === mainProfession && stats.focusMetrics) {
                    const focuses = Object.entries(stats.focusMetrics)
                        .filter(([_, value]) => value > 0.6)
                        .map(([metric, _]) => {
                            if (metric === '对玩家伤害') return '输出';
                            if (metric === '对建筑伤害') return '拆塔';
                            if (metric === '治疗值') return '治疗';
                            if (metric === '助攻') return '辅助';
                            return '';
                        })
                        .filter(f => f)
                        .join('/');
                    mainFocus = focuses || '综合';
                }
            }
        });
        
        // 如果没有获取到出场次数，尝试使用sessionCount作为备用
        if (actualSessions === 0 && professions.length > 0) {
            const firstStats = playerData[professions[0]];
            if (firstStats) {
                actualSessions = firstStats.sessionCount || 0;
                firstProfessionCount = actualSessions; // 一职出场次数
                maxCredibility = firstStats.credibility || 0;
            }
        }
        
        const attendanceRate = actualSessions > 0 ? ((actualSessions / totalSessions) * 100).toFixed(1) : '0.0';
        const credibilityText = maxCredibility > 0 ? (maxCredibility * 100).toFixed(0) + '%' : '0%';
        
        previewData.push({
            playerName,
            mainProfession,
            actualSessions,
            firstProfessionCount,
            secondProfessionCount,
            attendanceRate,
            credibilityText,
            mainFocus
        });
        
        totalAttendance += actualSessions;
    });
    
    // 按出场次数排序（从多到少）
    previewData.sort((a, b) => b.actualSessions - a.actualSessions);
    
    // 生成CSV内容（用于显示和下载）
    let csvContent = "玩家名,职业,出场次数,一职出场次数,二职出场次数,出场率,可信度,主要侧重\n";
    previewData.forEach(item => {
        csvContent += `"${item.playerName}","${item.mainProfession}",${item.actualSessions},${item.firstProfessionCount},${item.secondProfessionCount},${item.attendanceRate}%,${item.credibilityText},"${item.mainFocus}"\n`;
    });
    
    // 计算统计数据
    const avgAttendance = (totalAttendance / playerNames.length).toFixed(1);
    const fullAttendanceCount = previewData.filter(item => parseFloat(item.attendanceRate) >= 99.9).length;
    
    // 显示预览模态框
    showAttendancePreview({
        guildName: selectedGuild,
        totalSessions,
        totalPlayers: playerNames.length,
        avgAttendance,
        fullAttendanceCount,
        previewData,
        csvContent
    });
}

// 显示出场率预览模态框
function showAttendancePreview(data) {
    // 创建或更新模态框
    let modal = document.getElementById('attendancePreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'attendancePreviewModal';
        modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-50 hidden';
        modal.innerHTML = `
            <div class="flex items-center justify-center min-h-screen p-4">
                <div class="bg-gray-800 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col border border-gray-700">
                    <!-- 头部 -->
                    <div class="p-6 border-b border-gray-700">
                        <div class="flex justify-between items-start">
                            <div>
                                <h2 class="text-2xl font-bold text-white mb-2">
                                    <i class="fas fa-eye mr-2 text-blue-400"></i>数据导出预览
                                </h2>
                                <p class="text-gray-400 text-sm">预览导出数据，确认无误后再下载</p>
                            </div>
                            <button onclick="closeAttendancePreview()" class="text-gray-400 hover:text-white text-2xl">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    
                    <!-- 统计信息 -->
                    <div class="p-4 bg-gray-900/50 border-b border-gray-700">
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div class="text-center">
                                <div class="text-xl font-bold text-blue-400" id="previewTotalPlayers">-</div>
                                <div class="text-gray-400">总成员数</div>
                            </div>
                            <div class="text-center">
                                <div class="text-xl font-bold text-green-400" id="previewTotalSessions">-</div>
                                <div class="text-gray-400">总场次</div>
                            </div>
                            <div class="text-center">
                                <div class="text-xl font-bold text-yellow-400" id="previewAvgAttendance">-</div>
                                <div class="text-gray-400">平均出场</div>
                            </div>
                            <div class="text-center">
                                <div class="text-xl font-bold text-purple-400" id="previewFullAttendance">-</div>
                                <div class="text-gray-400">全勤人数</div>
                            </div>
                        </div>
                        <div class="mt-3 text-xs text-gray-500 text-center">
                            帮会：<span id="previewGuildName" class="text-gray-300">-</span>
                        </div>
                    </div>
                    
                    <!-- 数据表格 -->
                    <div class="flex-1 overflow-hidden flex flex-col">
                        <div class="px-4 py-3 border-b border-gray-700 flex justify-between items-center">
                            <h3 class="font-bold text-white">
                                <i class="fas fa-table mr-2"></i>数据预览（前50条）
                            </h3>
                            <div class="text-sm text-gray-400">
                                共 <span id="previewTotalRows" class="text-white">-</span> 条记录
                            </div>
                        </div>
                        <div class="flex-1 overflow-auto p-4">
                            <div class="bg-gray-900 rounded-lg overflow-hidden">
                                <table class="w-full text-sm">
                                    <thead class="bg-gray-800 sticky top-0">
                                        <tr class="text-left text-gray-300">
                                            <th class="px-3 py-2">玩家名</th>
                                            <th class="px-3 py-2">职业</th>
                                            <th class="px-3 py-2 text-center">出场次数</th>
                                            <th class="px-3 py-2 text-center">一职出场</th>
                                            <th class="px-3 py-2 text-center">二职出场</th>
                                            <th class="px-3 py-2 text-center">出场率</th>
                                            <th class="px-3 py-2 text-center">可信度</th>
                                            <th class="px-3 py-2">主要侧重</th>
                                        </tr>
                                    </thead>
                                    <tbody id="previewTableBody" class="text-gray-300">
                                        <!-- 动态生成 -->
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 操作按钮 -->
                    <div class="p-4 border-t border-gray-700 flex justify-between items-center">
                        <div class="text-sm text-gray-400">
                            <i class="fas fa-info-circle mr-1"></i>
                            确认数据无误后再下载
                        </div>
                        <div class="flex gap-2">
                            <button onclick="closeAttendancePreview()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                                <i class="fas fa-times mr-2"></i>取消
                            </button>
                            <button onclick="downloadAttendanceFromPreview()" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">
                                <i class="fas fa-download mr-2"></i>确认下载
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- 迷你统计 -->
                <div class="grid grid-cols-2 gap-3">
                    <div class="mini-stat">
                        <div class="mini-stat-value text-primary" id="guild1Members">0</div>
                        <div class="mini-stat-label">成员</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-stat-value text-primary" id="guild1Kills">0</div>
                        <div class="mini-stat-label">击败</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-stat-value text-primary" id="guild1Assists">0</div>
                        <div class="mini-stat-label">助攻</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-stat-value text-primary" id="guild1Healing">0</div>
                        <div class="mini-stat-label">治疗</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // 填充统计数据
    document.getElementById('previewGuildName').textContent = data.guildName;
    document.getElementById('previewTotalPlayers').textContent = data.totalPlayers;
    document.getElementById('previewTotalSessions').textContent = data.totalSessions;
    document.getElementById('previewAvgAttendance').textContent = data.avgAttendance;
    document.getElementById('previewFullAttendance').textContent = data.fullAttendanceCount;
    document.getElementById('previewTotalRows').textContent = data.previewData.length;
    
    // 存储数据用于下载
    modal.dataset.csvContent = data.csvContent;
    modal.dataset.guildName = data.guildName;
    
    // 生成表格（只显示前50条）
    const tableBody = document.getElementById('previewTableBody');
    const displayData = data.previewData.slice(0, 50);
    
    tableBody.innerHTML = displayData.map(item => {
        // 出场率颜色
        const rate = parseFloat(item.attendanceRate);
        const rateColor = rate >= 80 ? 'text-green-400 font-bold' : 
                         rate >= 50 ? 'text-yellow-400' : 'text-red-400';
        
        // 可信度颜色
        const cred = parseFloat(item.credibilityText);
        const credColor = cred >= 80 ? 'text-green-400' : 
                         cred >= 50 ? 'text-yellow-400' : 'text-red-400';
        
        return `
            <tr class="border-b border-gray-800 hover:bg-gray-800/30">
                <td class="px-3 py-2">
                    <div class="font-medium">${item.playerName}</div>
                </td>
                <td class="px-3 py-2">
                    <span class="px-2 py-0.5 bg-gray-700 rounded text-xs">${item.mainProfession}</span>
                </td>
                <td class="px-3 py-2 text-center font-bold text-white">${item.actualSessions}</td>
                <td class="px-3 py-2 text-center text-gray-300">${item.firstProfessionCount || 0}</td>
                <td class="px-3 py-2 text-center text-gray-300">${item.secondProfessionCount || 0}</td>
                <td class="px-3 py-2 text-center ${rateColor}">${item.attendanceRate}%</td>
                <td class="px-3 py-2 text-center ${credColor}">${item.credibilityText}</td>
                <td class="px-3 py-2">
                    <span class="text-gray-300">${item.mainFocus}</span>
                </td>
            </tr>
        `;
    }).join('');
    
    // 如果超过50条，显示提示
    if (data.previewData.length > 50) {
        tableBody.innerHTML += `
            <tr>
                <td colspan="8" class="px-3 py-3 text-center text-gray-500">
                    <i class="fas fa-info-circle mr-1"></i>
                    还有 ${data.previewData.length - 50} 条记录，下载后可查看完整数据
                </td>
            </tr>
        `;
    }
    
    // 显示模态框
    modal.classList.remove('hidden');
}

// 关闭预览模态框
function closeAttendancePreview() {
    const modal = document.getElementById('attendancePreviewModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// 从预览下载数据
function downloadAttendanceFromPreview() {
    const modal = document.getElementById('attendancePreviewModal');
    if (!modal || !modal.dataset.csvContent) {
        alert('数据异常，请重新预览');
        return;
    }
    
    const csvContent = modal.dataset.csvContent;
    const guildName = modal.dataset.guildName;
    
    // 创建并下载文件
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `出场率_${guildName}_${new Date().toLocaleDateString('zh-CN')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // 关闭预览
    closeAttendancePreview();
    
    // 显示成功提示
    alert('数据下载成功！');
}

// 点击模态框背景关闭
document.addEventListener('click', function(e) {
    const modal = document.getElementById('attendancePreviewModal');
    if (modal && e.target === modal) {
        closeAttendancePreview();
    }
});
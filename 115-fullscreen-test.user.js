// ==UserScript==
// @name         115自动全屏测试
// @namespace    test
// @version      0.1.0
// @description  测试115播放页自动进入桌面全屏的各种方法
// @match        https://115.com/players/video/*
// @match        https://115.com/players/magnet/*
// @match        https://115.com/web/lixian/master/video/*
// @match        https://115.com/web/lixian/master/magnet/*
// @match        https://115.com/?ct=*
// @match        https://115.com/?pick_code=*
// @match        https://115vod.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const LOG_PREFIX = '[115全屏测试] ';
    let tested = false;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function isFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    // 方法1：模拟点击桌面全屏按钮
    function tryClickBtn() {
        log('--- 方法1：点击桌面全屏按钮 ---');

        const video = document.querySelector('video');
        if (!video) {
            log('❌ 没找到 video');
            return false;
        }

        // 往上找播放器容器
        let container = video;
        for (let i = 0; i < 15; i++) {
            container = container.parentElement;
            if (!container) break;
            const cls = (container.className && typeof container.className === 'string') ? container.className : '';
            if (/player|video|vod|media/i.test(cls)) break;
        }
        const scope = container || document.body;
        log('搜索范围:', scope);

        // 收集所有可能的全屏按钮候选
        const all = scope.querySelectorAll('*');
        const candidates = [];

        all.forEach(el => {
            if (!el.offsetParent && getComputedStyle(el).display !== 'fixed') return;
            if (getComputedStyle(el).visibility === 'hidden') return;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return;

            const cls = (el.className && typeof el.className === 'string') ? el.className : '';
            const title = el.getAttribute && el.getAttribute('title') || '';
            const aria = el.getAttribute && el.getAttribute('aria-label') || '';
            const data = el.getAttribute && el.getAttribute('data-title') || '';
            const text = (el.textContent || '').trim().slice(0, 20);

            const combined = cls + ' ' + title + ' ' + aria + ' ' + data + ' ' + text;

            // 排除网页全屏
            if (/网页全屏|web\s*fullscreen|page\s*fullscreen/i.test(combined)) return;

            let score = 0;
            if (/桌面全屏|浏览器全屏|browser\s*fullscreen/i.test(combined)) score += 20;
            if (/fullscreen/i.test(cls)) score += 10;
            if (/fullscreen/i.test(title)) score += 8;
            if (/全屏/.test(title)) score += 8;
            if (/全屏/.test(aria)) score += 8;
            if (/全屏/.test(text)) score += 5;

            if (score > 0) {
                candidates.push({ el, score, cls, title, aria, text, tag: el.tagName });
            }
        });

        candidates.sort((a, b) => b.score - a.score);
        log('找到候选按钮:', candidates.length + '个');
        candidates.forEach((c, i) => {
            log(`  [${i}] score=${c.score} ${c.tag}.${c.class} title="${c.title}" aria="${c.aria}" text="${c.text}"`);
        });

        if (candidates.length === 0) {
            log('❌ 一个候选都没找到');
            return false;
        }

        // 点得分最高的
        const best = candidates[0];
        log('👉 点击得分最高的按钮:', best.el);
        best.el.click();

        return true;
    }

    // 方法2：模拟按 F 键
    function tryFKey() {
        log('--- 方法2：模拟 F 键 ---');

        const video = document.querySelector('video');
        if (!video) {
            log('❌ 没找到 video');
            return false;
        }

        // 尝试聚焦到不同元素
        const targets = [video, document.body, document.activeElement || document.body];
        const targetNames = ['video', 'body', 'activeElement'];

        let dispatched = false;
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!t) continue;
            try { t.focus && t.focus(); } catch (e) {}

            const event = new KeyboardEvent('keydown', {
                key: 'f',
                code: 'KeyF',
                keyCode: 70,
                which: 70,
                bubbles: true,
                cancelable: true,
            });

            const result = t.dispatchEvent(event);
            log(`  向 ${targetNames[i]} 派发 keydown(f), 结果: ${result}`);
            dispatched = true;
        }

        return dispatched;
    }

    // 方法3：直接调用 requestFullscreen
    function tryDirectFullscreen() {
        log('--- 方法3：直接调用 requestFullscreen ---');

        const video = document.querySelector('video');
        if (!video) {
            log('❌ 没找到 video');
            return false;
        }

        // 往上找一个合适的容器来全屏
        let el = video;
        for (let i = 0; i < 5; i++) {
            if (el.parentElement) el = el.parentElement;
        }

        log('尝试对', el, '调用 requestFullscreen');

        if (el.requestFullscreen) {
            el.requestFullscreen()
                .then(() => log('✅ requestFullscreen 成功'))
                .catch(err => log('❌ requestFullscreen 失败:', err.message));
            return true;
        }
        if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
            return true;
        }

        log('❌ 不支持 requestFullscreen');
        return false;
    }

    // 方法4：检查 115 播放器有没有暴露全局方法
    function tryGlobalApi() {
        log('--- 方法4：查找 115 全局播放器 API ---');

        const keywords = ['player', 'video', 'fullscreen', 'vod', 'marquee', 'media'];
        const found = [];

        for (const key of Object.keys(window)) {
            for (const kw of keywords) {
                if (key.toLowerCase().includes(kw)) {
                    const val = window[key];
                    const type = typeof val;
                    if (type === 'object' || type === 'function') {
                        found.push({ key, type });
                    }
                    break;
                }
            }
        }

        log('找到的全局变量:', found.length + '个');
        found.forEach(f => log(`  ${f.key} (${f.type})`));

        // 尝试找 toggleFullscreen 之类的方法
        for (const f of found) {
            const obj = window[f.key];
            if (!obj || typeof obj !== 'object') continue;
            for (const m of Object.keys(obj)) {
                if (/fullscreen|全屏|toggleFull/i.test(m)) {
                    log(`  👉 发现可能的方法: ${f.key}.${m}`);
                }
            }
        }

        return found.length > 0;
    }

    // 方法5：查看 video 元素上的事件监听和属性
    function inspectVideo() {
        log('--- 方法5：检查 video 元素详情 ---');

        const video = document.querySelector('video');
        if (!video) {
            log('❌ 没找到 video');
            return;
        }

        log('video 标签属性:');
        for (let i = 0; i < video.attributes.length; i++) {
            const attr = video.attributes[i];
            log(`  ${attr.name}="${attr.value}"`);
        }

        // 父级链
        log('父级链:');
        let el = video;
        for (let i = 0; i < 8; i++) {
            el = el.parentElement;
            if (!el) break;
            const cls = (el.className && typeof el.className === 'string') ? el.className : '';
            const id = el.id || '';
            log(`  [${i}] <${el.tagName.toLowerCase()}> id="${id}" class="${cls.slice(0, 60)}"`);
        }
    }

    // 按顺序测试所有方法
    function runAllTests() {
        if (tested) return;
        tested = true;

        log('========== 开始测试 ==========');
        log('当前URL:', location.href);

        // 先看一下 video 信息
        inspectVideo();
        log('');

        // 先试全局 API 查找（不改变状态）
        tryGlobalApi();
        log('');

        // 测试方法2：F 键
        if (tryFKey()) {
            setTimeout(() => {
                if (isFullscreen()) {
                    log('✅✅✅ F 键成功进入全屏！');
                } else {
                    log('F 键后未进入全屏，继续测试...');
                    // 测试方法1：点击按钮
                    setTimeout(() => {
                        if (tryClickBtn()) {
                            setTimeout(() => {
                                if (isFullscreen()) {
                                    log('✅✅✅ 点击按钮成功进入全屏！');
                                } else {
                                    log('点击按钮后也未进入全屏');
                                    // 最后试直接调用
                                    setTimeout(() => {
                                        tryDirectFullscreen();
                                        setTimeout(() => {
                                            if (isFullscreen()) {
                                                log('✅✅✅ 直接调用成功！');
                                            } else {
                                                log('所有方法均未进入原生全屏。');
                                                log('原因很可能是：程序化操作不算用户手势，浏览器拒绝了 requestFullscreen。');
                                                log('========== 测试结束 ==========');
                                            }
                                        }, 600);
                                    }, 500);
                                }
                            }, 600);
                        }
                    }, 300);
                }
            }, 600);
        }
    }

    // 等 video 出现
    function waitForVideo() {
        const start = Date.now();
        const check = () => {
            const video = document.querySelector('video');
            if (video) {
                // 再等一下让播放器完全加载
                setTimeout(runAllTests, 1000);
                return;
            }
            if (Date.now() - start < 20000) {
                setTimeout(check, 300);
            } else {
                log('超时：未找到 video 元素');
            }
        };
        check();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        waitForVideo();
    } else {
        document.addEventListener('DOMContentLoaded', waitForVideo);
    }

    log('脚本已加载，等待 video 出现后开始测试...');
})();

// ==UserScript==
// @name         115一键桌面全屏
// @namespace    https://github.com/mason173/aira-browser
// @version      0.3.0
// @description  测试用：115播放页显示一键桌面全屏按钮。只做一件事——点115的iop-fullscreen(桌面全屏)按钮，看能否进入原生全屏。
// @author       Video Takeover
// @icon         https://115.com/favicon.ico
// @match        https://115.com/players/video/*
// @match        https://115.com/players/magnet/*
// @match        https://115.com/web/lixian/master/video/*
// @match        https://115.com/web/lixian/master/magnet/*
// @match        https://115.com/?ct=*
// @match        https://115.com/?aid=*
// @match        https://115.com/?pick_code=*
// @match        https://115vod.com/*
// @grant        none
// @run-at       document-idle
// @license      GPL-3.0
// ==/UserScript==

(function () {
    'use strict';

    let btnAdded = false;

    function log(...args) {
        console.log('[115一键全屏]', ...args);
    }

    function injectStyle() {
        if (document.getElementById('vt-115-fs-style')) return;
        const style = document.createElement('style');
        style.id = 'vt-115-fs-style';
        style.textContent = `
            #vt-115-fs-btn {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 2147483646;
                padding: 18px 44px;
                background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
                color: #fff;
                font-size: 20px;
                font-weight: bold;
                border: none;
                border-radius: 50px;
                box-shadow: 0 8px 32px rgba(255, 107, 53, 0.5);
                cursor: pointer;
                text-align: center;
                line-height: 1.3;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #vt-115-fs-btn:active {
                transform: translate(-50%, -50%) scale(0.95);
            }
            #vt-115-fs-btn .sub {
                display: block;
                font-size: 13px;
                font-weight: normal;
                opacity: 0.85;
                margin-top: 3px;
            }
            #vt-115-fs-btn.vt-hidden { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    // 找 115 桌面全屏按钮
    // iop-fullscreen = 桌面全屏（真正的原生全屏）
    // iop-browser-fullscreen = 网页全屏（只占满浏览器窗口，不是真全屏）
    function findDesktopFullscreenBtn() {
        const all = document.body.querySelectorAll('*');
        const candidates = [];

        all.forEach(el => {
            const cls = (el.className && typeof el.className === 'string') ? el.className : '';

            // 排除自己的按钮
            if (el.id === 'vt-115-fs-btn') return;
            // 排除主脚本的元素（装了主脚本时）
            if (/vt-/.test(cls)) return;
            if (el.id && /vt-/.test(el.id)) return;

            // 可见性检查
            if (!el.offsetParent && getComputedStyle(el).display !== 'fixed') return;
            if (getComputedStyle(el).visibility === 'hidden') return;
            if (getComputedStyle(el).opacity === '0') return;
            const rect = el.getBoundingClientRect();
            if (rect.width < 6 || rect.height < 6) return;

            const title = (el.getAttribute && el.getAttribute('title')) || '';
            const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
            const dataTitle = (el.getAttribute && el.getAttribute('data-title')) || '';
            const text = (el.textContent || '').trim();
            const combined = cls + ' ' + title + ' ' + aria + ' ' + dataTitle + ' ' + text;

            // 排除网页全屏（iop-browser-fullscreen = browser = 浏览器内 = 网页全屏）
            if (/iop-browser-fullscreen|browser-fullscreen/i.test(cls)) return;
            if (/网页全屏|web\s*fullscreen|page\s*fullscreen/i.test(combined)) return;
            if (/\bweb-fullscreen\b/i.test(cls)) return;

            let score = 0;
            // 桌面全屏核心 class：iop-fullscreen（不带 browser）
            if (/\biop-fullscreen\b/.test(cls)) score += 100;
            if (/桌面全屏|真正全屏/i.test(combined)) score += 40;
            if (/fullscreen/i.test(cls)) score += 10;
            if (/全屏/.test(title)) score += 8;
            if (/fullscreen/i.test(title)) score += 8;
            if (/全屏/.test(aria)) score += 8;
            if (/桌面全屏/.test(text)) score += 20;
            if (/全屏/.test(text) && !/网页/.test(text) && !/浏览器/.test(text)) score += 5;
            if (/BUTTON|A|LI/.test(el.tagName)) score += 2;

            if (score >= 3) {
                candidates.push({ el, score, tag: el.tagName, cls: cls.slice(0, 60), title, text: text.slice(0, 30), rect });
            }
        });

        candidates.sort((a, b) => b.score - a.score);
        log('找到候选按钮:', candidates.length + '个');
        candidates.slice(0, 8).forEach((c, i) => {
            log(`  [${i}] score=${c.score} ${c.tag} class="${c.cls}" title="${c.title}" text="${c.text}" size=${Math.round(c.rect.width)}x${Math.round(c.rect.height)}`);
        });

        if (candidates.length > 0 && candidates[0].score >= 20) {
            return candidates[0].el;
        }
        return null;
    }

    // 按钮点击：只做一件事——触发桌面全屏（只点一次）
    function onBtnClick() {
        const btn = document.getElementById('vt-115-fs-btn');
        if (btn) btn.classList.add('vt-hidden');

        const fsBtn = findDesktopFullscreenBtn();
        if (!fsBtn) {
            log('❌ 找不到桌面全屏按钮（iop-fullscreen）');
            alert('找不到桌面全屏按钮');
            if (btn) btn.classList.remove('vt-hidden');
            return;
        }

        log('👉 点击桌面全屏按钮:', fsBtn.className || fsBtn.tagName);
        fsBtn.click();

        // 轮询检测（最多 2 秒，每 150ms 查一次）
        // 只点一次！全屏按钮是 toggle 式的，点第二次会退出
        let checks = 0;
        const maxChecks = 14;
        const check = () => {
            checks++;
            if (document.fullscreenElement) {
                log('✅ 成功进入原生桌面全屏！');
                log('   fullscreenElement:', document.fullscreenElement.tagName, document.fullscreenElement.className || '');
                if (btn) btn.remove();
                return;
            }
            if (checks < maxChecks) {
                setTimeout(check, 150);
            } else {
                log('❌ 未进入原生全屏');
                log('   可能原因：1) 点错按钮  2) 按钮需要先展开菜单  3) 点击被拦截');
                if (btn) btn.classList.remove('vt-hidden');
            }
        };
        check();
    }

    function showBtn() {
        if (btnAdded) return;
        btnAdded = true;

        injectStyle();

        const btn = document.createElement('button');
        btn.id = 'vt-115-fs-btn';
        btn.innerHTML = `桌面全屏<span class="sub">点击进入原生全屏</span>`;
        btn.addEventListener('click', onBtnClick, true);

        document.body.appendChild(btn);
        log('一键桌面全屏按钮已显示');
    }

    function waitForVideo() {
        const start = Date.now();
        const check = () => {
            const video = document.querySelector('video');
            if (video) {
                // 稍等播放器完全加载（控制栏按钮可能比 video 晚出现）
                setTimeout(showBtn, 1200);
                return;
            }
            if (Date.now() - start < 20000) {
                setTimeout(check, 300);
            }
        };
        check();
    }

    function start() {
        btnAdded = false;
        const old = document.getElementById('vt-115-fs-btn');
        if (old) old.remove();
        setTimeout(waitForVideo, 500);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start);
    }

    // SPA URL 变化
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            start();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    log('脚本已加载，等待视频出现...');
})();

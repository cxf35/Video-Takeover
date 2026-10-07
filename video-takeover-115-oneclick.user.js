// ==UserScript==
// @name         115一键全屏接管
// @namespace    https://github.com/mason173/aira-browser
// @version      1.1.0
// @description  115播放页显示一键播放按钮，点击即进入原生桌面全屏并以CSS模式自动接管（完美沉浸横屏）。需先安装主脚本。
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

    const CONFIG = {
        autoPlay: true,
        btnText: '点击播放',
        btnSubText: '进入全屏沉浸模式',
    };

    let btnAdded = false;

    function log(...args) {
        console.log('[115一键接管]', ...args);
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
                padding: 20px 48px;
                background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
                color: #fff;
                font-size: 22px;
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
                font-size: 14px;
                font-weight: normal;
                opacity: 0.85;
                margin-top: 4px;
            }
            #vt-115-fs-btn.vt-hidden { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    // 找 115 桌面全屏按钮（iop-fullscreen = 桌面全屏，iop-browser-fullscreen = 网页全屏）
    function findDesktopFullscreenBtn() {
        const all = document.body.querySelectorAll('*');
        const candidates = [];

        all.forEach(el => {
            const cls = (el.className && typeof el.className === 'string') ? el.className : '';
            if (/vt-/.test(cls)) return;
            if (el.id && /vt-/.test(el.id)) return;
            if (el.id === 'vt-115-fs-btn') return;

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

            // 排除"网页全屏"（iop-browser-fullscreen = browser = 浏览器内 = 网页全屏）
            if (/iop-browser-fullscreen|browser-fullscreen/i.test(cls)) return;
            if (/网页全屏|web\s*fullscreen|page\s*fullscreen/i.test(combined)) return;
            if (/\bweb-fullscreen\b/i.test(cls)) return;

            let score = 0;
            // 桌面全屏：iop-fullscreen（不带 browser）
            if (/\biop-fullscreen\b/.test(cls)) score += 60;
            if (/桌面全屏|真正全屏/i.test(combined)) score += 30;
            if (/fullscreen/i.test(cls)) score += 10;
            if (/全屏/.test(title)) score += 8;
            if (/fullscreen/i.test(title)) score += 8;
            if (/全屏/.test(aria)) score += 8;
            if (/桌面全屏/.test(text)) score += 20;
            if (/全屏/.test(text) && !/网页/.test(text) && !/浏览器/.test(text)) score += 5;
            if (/BUTTON|A|LI/.test(el.tagName)) score += 2;

            if (score >= 3) {
                candidates.push({ el, score, cls: cls.slice(0, 50), rect });
            }
        });

        candidates.sort((a, b) => b.score - a.score);
        if (candidates.length > 0) {
            log('候选按钮:', candidates.map(c => c.score + ' ' + c.cls + ' text=' + (c.el.textContent||'').trim().slice(0,20)).join(' | '));
        }
        return (candidates.length > 0 && candidates[0].score >= 10) ? candidates[0].el : null;
    }

    // 强制主脚本以 CSS 模式接管
    function forceCssMode() {
        try {
            localStorage.setItem('vt_rotate_mode', 'css');
            log('✅ 已设置接管模式为 CSS');
        } catch (e) {
            log('⚠️ 无法写入 localStorage:', e);
        }
    }

    // 触发主脚本接管
    function triggerTakeover() {
        const floatBtn = document.querySelector('.vt-float-btn.vt-btn-fullscreen');
        if (floatBtn) {
            log('👉 触发接管（点击悬浮全屏按钮）');
            floatBtn.click();

            // 接管后强制 video 铺满容器（清除 115 可能残留的内联样式）
            const forceFill = () => {
                const v = document.querySelector('video');
                if (v) {
                    v.style.width = '100%';
                    v.style.height = '100%';
                    v.style.maxWidth = 'none';
                    v.style.maxHeight = 'none';
                    v.style.minWidth = '0';
                    v.style.minHeight = '0';
                    v.style.transform = 'none';
                    v.style.top = 'auto';
                    v.style.left = 'auto';
                    v.style.right = 'auto';
                    v.style.bottom = 'auto';
                    v.style.margin = '0 auto';
                    v.style.display = 'block';
                    v.style.position = 'relative';
                    log('✅ 已强制 video 铺满容器');
                }
            };
            // 多试几次，确保接管完成后样式生效
            setTimeout(forceFill, 300);
            setTimeout(forceFill, 800);
            setTimeout(forceFill, 1500);

            if (CONFIG.autoPlay) {
                setTimeout(() => {
                    const v = document.querySelector('video');
                    if (v && v.paused) v.play().catch(() => {});
                }, 800);
            }
            return true;
        }
        return false;
    }

    // 等主脚本悬浮按钮出现（最多等 3 秒）
    function waitForTakeoverThenDo(callback, maxWait) {
        maxWait = maxWait || 3000;
        const start = Date.now();
        const check = () => {
            const btn = document.querySelector('.vt-float-btn.vt-btn-fullscreen');
            if (btn) {
                callback();
                return;
            }
            if (Date.now() - start < maxWait) {
                setTimeout(check, 200);
            } else {
                log('⚠️ 等待主脚本悬浮按钮超时');
            }
        };
        check();
    }

    // 按钮点击：115桌面全屏 → CSS模式接管
    function onBtnClick() {
        const btn = document.getElementById('vt-115-fs-btn');
        if (btn) btn.classList.add('vt-hidden');

        // 先设置 CSS 模式，确保接管时走 CSS
        forceCssMode();

        const fsBtn = findDesktopFullscreenBtn();
        if (!fsBtn) {
            log('❌ 找不到桌面全屏按钮，直接CSS模式接管');
            triggerTakeover();
            if (btn) btn.remove();
            return;
        }

        log('👉 点击桌面全屏按钮:', fsBtn.className || fsBtn.tagName);
        fsBtn.click();

        // 轮询检测是否进了原生全屏
        let checks = 0;
        const maxChecks = 15;
        const checkFs = () => {
            checks++;
            if (document.fullscreenElement) {
                log('✅ 原生全屏成功，准备CSS模式接管...');
                // 稍微等一下，让 115 的全屏动画完成
                setTimeout(() => {
                    waitForTakeoverThenDo(() => {
                        triggerTakeover();
                        log('✅ CSS模式接管完成！');
                        if (btn) btn.remove();
                    }, 3000);
                }, 300);
                return;
            }
            if (checks < maxChecks) {
                setTimeout(checkFs, 150);
            } else {
                log('⚠️ 原生全屏未成功，直接CSS模式接管');
                triggerTakeover();
                if (btn) btn.remove();
            }
        };
        checkFs();
    }

    function showBtn() {
        if (btnAdded) return;
        btnAdded = true;

        injectStyle();

        const btn = document.createElement('button');
        btn.id = 'vt-115-fs-btn';
        btn.innerHTML = `${CONFIG.btnText}<span class="sub">${CONFIG.btnSubText}</span>`;
        btn.addEventListener('click', onBtnClick, true);

        document.body.appendChild(btn);
        log('一键全屏接管按钮已显示');
    }

    function waitForVideo() {
        const start = Date.now();
        const check = () => {
            const video = document.querySelector('video');
            if (video) {
                // 等主脚本悬浮按钮就绪
                setTimeout(() => {
                    const floatBtn = document.querySelector('.vt-float-btn.vt-btn-fullscreen');
                    if (floatBtn) {
                        showBtn();
                    } else {
                        setTimeout(showBtn, 500);
                    }
                }, 800);
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

    log('脚本已加载，等待视频出现后显示一键播放按钮。');
})();

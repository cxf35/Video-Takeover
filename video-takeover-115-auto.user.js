// ==UserScript==
// @name         115网盘视频自动接管 - 移动端版
// @namespace    https://github.com/mason173/aira-browser
// @version      1.1.2
// @description  115网盘播放视频时，自动进入「网页视频接管 - 移动端版」脚本的全屏接管模式（优先原生全屏，失败回退CSS模式）。需先安装主脚本。
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
// @downloadURL none
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        waitTimeout: 15000,
        pollInterval: 300,
        autoPlay: true,
        // 触发原生全屏后等多久判断是否成功
        nativeCheckDelay: 600,
        // 是否尝试用 F 键触发 115 原生桌面全屏（失败不影响，自动回退）
        tryNativeViaFKey: true,
    };

    let triggered = false;

    function isInNativeFullscreen() {
        return !!document.fullscreenElement;
    }

    // 模拟按 F 键触发 115 播放器的桌面全屏
    function pressFKey() {
        const video = document.querySelector('video');
        if (!video) return false;

        // 先聚焦到 video 或播放器容器
        const target = video.focus ? video : document.body;
        try { target.focus(); } catch (e) {}

        // 触发 keydown 事件（115 播放器监听 f 键切换全屏）
        const event = new KeyboardEvent('keydown', {
            key: 'f',
            code: 'KeyF',
            keyCode: 70,
            which: 70,
            bubbles: true,
            cancelable: true,
        });
        target.dispatchEvent(event);
        return true;
    }

    // 直接接管（CSS 模式，v1.1.0 原有逻辑）
    function directTakeover() {
        if (triggered) return;
        const fullscreenBtn = document.querySelector('.vt-float-btn.vt-btn-fullscreen');
        if (fullscreenBtn) {
            triggered = true;
            fullscreenBtn.click();
            if (CONFIG.autoPlay) {
                setTimeout(() => {
                    const video = document.querySelector('video');
                    if (video && video.paused) video.play().catch(() => {});
                }, 500);
            }
            return true;
        }
        return false;
    }

    // 先走原生全屏路径，失败就回退
    function tryNativeThenTakeover() {
        if (!CONFIG.tryNativeViaFKey) {
            directTakeover();
            return;
        }

        const ok = pressFKey();
        if (!ok) {
            directTakeover();
            return;
        }

        console.log('[115自动接管] 已发送 F 键，等待原生全屏...');

        setTimeout(() => {
            if (isInNativeFullscreen()) {
                console.log('[115自动接管] ✅ 原生全屏成功，继续接管');
                // 稍等全屏动画完成再接管
                setTimeout(directTakeover, 200);
            } else {
                console.log('[115自动接管] ⚠️ 原生全屏未成功，回退CSS模式接管');
                directTakeover();
            }
        }, CONFIG.nativeCheckDelay);
    }

    function waitAndTrigger() {
        const startTime = Date.now();

        const tryTrigger = () => {
            if (triggered) return;

            const video = document.querySelector('video');
            if (!video) {
                if (Date.now() - startTime < CONFIG.waitTimeout) {
                    setTimeout(tryTrigger, CONFIG.pollInterval);
                }
                return;
            }

            // 悬浮按钮出现了就开始
            const floatBtn = document.querySelector('.vt-float-btn.vt-btn-fullscreen');
            if (floatBtn) {
                tryNativeThenTakeover();
                return;
            }

            if (Date.now() - startTime < CONFIG.waitTimeout) {
                setTimeout(tryTrigger, CONFIG.pollInterval);
            } else {
                console.warn('[115自动接管] 超时：未找到网页视频接管的悬浮按钮，请确认主脚本已安装并启用。');
            }
        };

        tryTrigger();
    }

    // 启动
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(waitAndTrigger, 500);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(waitAndTrigger, 500);
        });
    }

    // SPA URL 变化监听
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            triggered = false;
            setTimeout(waitAndTrigger, 800);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[115自动接管] 脚本已加载，优先尝试原生全屏接管，失败自动回退CSS模式。');
})();

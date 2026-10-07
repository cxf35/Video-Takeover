// ==UserScript==
// @name         视频接管诊断工具 - 简化版
// @namespace    https://github.com/mason173/aira-browser
// @version      1.1.0
// @description  诊断当前浏览器对投屏和画中画的支持情况（简化版，保证能显示）
// @author       Video Takeover
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-idle
// @license      GPL-3.0
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 收集所有检测结果 ====================
    function collectAllInfo() {
        const info = [];
        const ua = navigator.userAgent;

        // --- 浏览器 ---
        info.push('【浏览器信息】');
        info.push('UserAgent: ' + ua.substring(0, 150));
        info.push('平台: ' + (navigator.platform || 'unknown'));
        info.push('厂商: ' + (navigator.vendor || 'unknown'));

        let browserName = '未知';
        if (/EdgA?\//.test(ua)) { browserName = 'Edge'; }
        else if (/Chrome\//.test(ua)) { browserName = 'Chrome'; }
        else if (/Firefox\//.test(ua)) { browserName = 'Firefox'; }
        else if (/Safari\//.test(ua)) { browserName = 'Safari'; }
        info.push('浏览器: ' + browserName);

        info.push('移动端: ' + (/Mobile|Android|iPhone|iPad|HarmonyOS|鸿蒙/.test(ua) ? '是' : '否'));
        info.push('鸿蒙系统: ' + (/HarmonyOS|鸿蒙|HMSCore/.test(ua) ? '是' : '否'));
        info.push('华为设备: ' + (/HUAWEI|huawei|HMS/.test(ua) ? '是' : '否'));

        // --- 画中画 ---
        info.push('');
        info.push('【画中画 PiP】');

        info.push('document.pictureInPictureEnabled: ' +
            ('pictureInPictureEnabled' in document ? (document.pictureInPictureEnabled ? '✅ 可用' : '❌ 禁用') : '❌ 无此属性'));

        info.push('document.pictureInPictureElement: ' +
            ('pictureInPictureElement' in document ? '✅ 有' : '❌ 无'));

        info.push('document.exitPictureInPicture: ' +
            ('exitPictureInPicture' in document ? '✅ 有' : '❌ 无'));

        const video = document.createElement('video');
        info.push('video.requestPictureInPicture: ' +
            ('requestPictureInPicture' in video ? '✅ 有' : '❌ 无'));

        info.push('video.disablePictureInPicture: ' +
            ('disablePictureInPicture' in video ? '✅ 有' : '❌ 无'));

        info.push('video.webkitSupportsPresentationMode: ' +
            ('webkitSupportsPresentationMode' in video ? '✅ 有 (iOS Safari)' : '❌ 无'));

        info.push('video.webkitSetPresentationMode: ' +
            ('webkitSetPresentationMode' in video ? '✅ 有' : '❌ 无'));

        info.push('onenterpictureinpicture 事件: ' +
            ('onenterpictureinpicture' in video ? '✅ 有' : '❌ 无'));

        // --- 投屏 ---
        info.push('');
        info.push('【投屏 / 远程播放】');

        info.push('navigator.presentation: ' +
            ('presentation' in navigator ? '✅ 有' : '❌ 无'));

        info.push('window.PresentationRequest: ' +
            ('PresentationRequest' in window ? '✅ 有' : '❌ 无'));

        info.push('video.remote (Remote Playback): ' +
            ('remote' in video ? '✅ 有' : '❌ 无'));

        if ('remote' in video && video.remote) {
            info.push('  remote.state: ' + (video.remote.state || 'unknown'));
            info.push('  remote.prompt: ' + ('prompt' in video.remote ? '✅ 有' : '❌ 无'));
            info.push('  remote.watchAvailability: ' + ('watchAvailability' in video.remote ? '✅ 有' : '❌ 无'));
        }

        info.push('Chrome Cast API: ' +
            (window.chrome && window.chrome.cast ? '✅ 有' : '❌ 无'));

        info.push('CastReceiver / __onGCastApiAvailable: ' +
            (('CastReceiver' in window) || ('__onGCastApiAvailable' in window) ? '✅ 有' : '❌ 无'));

        info.push('video.webkitDisplayingFullscreen: ' +
            ('webkitDisplayingFullscreen' in video ? '✅ 有 (iOS)' : '❌ 无'));

        info.push('navigator.mediaSession: ' +
            ('mediaSession' in navigator ? '✅ 有' : '❌ 无'));

        // --- 全屏 & 方向 ---
        info.push('');
        info.push('【全屏 & 方向锁定】');

        info.push('Element.requestFullscreen: ' +
            ('requestFullscreen' in Element.prototype ? '✅ 有' : '❌ 无'));

        info.push('Element.webkitRequestFullscreen: ' +
            ('webkitRequestFullscreen' in Element.prototype ? '✅ 有' : '❌ 无'));

        info.push('document.fullscreenElement: ' +
            ('fullscreenElement' in document ? '✅ 有' : '❌ 无'));

        info.push('screen.orientation: ' +
            ('orientation' in screen ? '✅ 有' : '❌ 无'));

        if ('orientation' in screen && screen.orientation) {
            info.push('  orientation.type: ' + (screen.orientation.type || 'unknown'));
            info.push('  orientation.angle: ' + (screen.orientation.angle || 0));
            info.push('  orientation.lock: ' + ('lock' in screen.orientation ? '✅ 有' : '❌ 无'));
            info.push('  orientation.unlock: ' + ('unlock' in screen.orientation ? '✅ 有' : '❌ 无'));
        }

        // --- 页面视频情况 ---
        info.push('');
        info.push('【页面视频】');
        const videos = document.querySelectorAll('video');
        info.push('video 元素数量: ' + videos.length);
        for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            info.push('  视频[' + i + ']: src=' + (v.currentSrc || v.src || '无').substring(0, 60));
            info.push('         readyState=' + v.readyState + ', paused=' + v.paused);
        }

        return info.join('\n');
    }

    // ==================== 尝试测试画中画 ====================
    async function testPiP() {
        const video = document.querySelector('video');
        if (!video) return '❌ 页面上没有找到 video 元素';

        // 方法1: 标准 PiP
        if ('requestPictureInPicture' in video) {
            try {
                await video.requestPictureInPicture();
                setTimeout(() => {
                    try { document.exitPictureInPicture(); } catch (e) {}
                }, 1500);
                return '✅ 标准 PiP 调用成功！画中画应该已经出现了';
            } catch (e) {
                let msg = '❌ 标准 PiP 失败: ' + e.name + ' - ' + e.message;

                // 方法2: WebKit
                if ('webkitSupportsPresentationMode' in video) {
                    try {
                        if (video.webkitSupportsPresentationMode('picture-in-picture')) {
                            video.webkitSetPresentationMode('picture-in-picture');
                            setTimeout(() => {
                                try { video.webkitSetPresentationMode('inline'); } catch (e) {}
                            }, 1500);
                            msg += '\n✅ WebKit PiP 调用成功';
                        } else {
                            msg += '\n❌ WebKit PiP: 不支持 picture-in-picture 模式';
                        }
                    } catch (e2) {
                        msg += '\n❌ WebKit PiP 也失败: ' + e2.message;
                    }
                }

                return msg;
            }
        }

        // 方法2: WebKit
        if ('webkitSupportsPresentationMode' in video) {
            try {
                if (video.webkitSupportsPresentationMode('picture-in-picture')) {
                    video.webkitSetPresentationMode('picture-in-picture');
                    setTimeout(() => {
                        try { video.webkitSetPresentationMode('inline'); } catch (e) {}
                    }, 1500);
                    return '✅ WebKit PiP 调用成功';
                } else {
                    return '❌ WebKit PiP: 不支持 picture-in-picture 模式';
                }
            } catch (e) {
                return '❌ WebKit PiP 失败: ' + e.message;
            }
        }

        return '❌ 没有可用的画中画 API';
    }

    // ==================== 尝试测试投屏 ====================
    async function testCast() {
        const video = document.querySelector('video');
        if (!video) return '❌ 页面上没有找到 video 元素';

        let results = [];

        // 方法1: Remote Playback
        if (video.remote && 'prompt' in video.remote) {
            try {
                await video.remote.prompt();
                results.push('✅ Remote Playback (video.remote.prompt) 调用成功');
            } catch (e) {
                results.push('❌ Remote Playback 失败: ' + e.name + ' - ' + e.message);
            }
        } else {
            results.push('❌ Remote Playback API 不存在');
        }

        // 方法2: Presentation API
        if (window.PresentationRequest) {
            results.push('ℹ️ Presentation API 存在，但需要第二屏设备才能测试');
        } else {
            results.push('❌ Presentation API 不存在');
        }

        // 方法3: Chrome Cast
        if (window.chrome && window.chrome.cast) {
            results.push('✅ Chrome Cast API 存在');
        }

        return results.join('\n');
    }

    // ==================== 创建面板 ====================
    let panel = null;

    function createPanel() {
        if (panel && panel.parentNode) return;

        panel = document.createElement('div');
        panel.id = 'vt-diag-panel';

        const allInfo = collectAllInfo();

        panel.innerHTML =
            '<div class="vt-diag-box">' +
                '<div class="vt-diag-header">' +
                    '<span class="vt-diag-title">🔍 视频功能兼容性诊断</span>' +
                    '<button class="vt-diag-close">✕</button>' +
                '</div>' +
                '<div class="vt-diag-buttons">' +
                    '<button class="vt-diag-btn vt-diag-btn-pip">测试画中画</button>' +
                    '<button class="vt-diag-btn vt-diag-btn-cast">测试投屏</button>' +
                '</div>' +
                '<div class="vt-diag-test-result" id="vt-diag-test-result">点击上方按钮测试（需页面有视频）</div>' +
                '<div class="vt-diag-label">📊 检测详情：</div>' +
                '<div class="vt-diag-body">' +
                    '<pre class="vt-diag-text">' + escapeHtml(allInfo) + '</pre>' +
                '</div>' +
                '<div class="vt-diag-label">💡 结论：</div>' +
                '<div class="vt-diag-conclusion" id="vt-diag-conclusion"></div>' +
            '</div>';

        document.body.appendChild(panel);

        // 关闭按钮
        panel.querySelector('.vt-diag-close').addEventListener('click', closePanel);

        // 点击背景关闭
        panel.addEventListener('click', function (e) {
            if (e.target === panel) closePanel();
        });

        // 测试按钮
        panel.querySelector('.vt-diag-btn-pip').addEventListener('click', async function () {
            const resultEl = panel.querySelector('#vt-diag-test-result');
            resultEl.textContent = '正在测试画中画...';
            const result = await testPiP();
            resultEl.textContent = result;
        });

        panel.querySelector('.vt-diag-btn-cast').addEventListener('click', async function () {
            const resultEl = panel.querySelector('#vt-diag-test-result');
            resultEl.textContent = '正在测试投屏...';
            const result = await testCast();
            resultEl.textContent = result;
        });

        // 生成结论
        generateConclusion(allInfo);
    }

    function closePanel() {
        if (panel && panel.parentNode) {
            panel.parentNode.removeChild(panel);
        }
        panel = null;
    }

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
    }

    function generateConclusion(infoText) {
        const el = document.getElementById('vt-diag-conclusion');
        if (!el) return;

        let lines = [];

        // 画中画判断
        const hasStdPiP = infoText.indexOf('video.requestPictureInPicture: ✅') >= 0;
        const pipEnabled = infoText.indexOf('document.pictureInPictureEnabled: ✅ 可用') >= 0;
        const pipDisabled = infoText.indexOf('document.pictureInPictureEnabled: ❌ 禁用') >= 0;
        const hasWebkitPiP = infoText.indexOf('video.webkitSupportsPresentationMode: ✅') >= 0;

        if (hasStdPiP && pipEnabled) {
            lines.push('✅ <strong>画中画</strong>：标准 PiP API 齐全且已启用，应该可以使用。如果点测试按钮没反应，可能需要视频先播放，或视频源跨域限制。');
        } else if (hasStdPiP && pipDisabled) {
            lines.push('⚠️ <strong>画中画</strong>：API 存在但被禁用（pictureInPictureEnabled = false）。这通常是浏览器设置或系统层面禁用了画中画功能。');
        } else if (hasWebkitPiP) {
            lines.push('✅ <strong>画中画</strong>：支持 WebKit 风格的 PiP（Safari / iOS 方式）。');
        } else {
            lines.push('❌ <strong>画中画</strong>：当前浏览器完全不支持画中画 API。');
            lines.push('   原因可能是：Edge 安卓版本身不支持，或在鸿蒙兼容层（卓易通）中运行时该功能被屏蔽。');
        }

        // 投屏判断
        const hasRemote = infoText.indexOf('video.remote (Remote Playback): ✅') >= 0;
        const hasPrompt = infoText.indexOf('remote.prompt: ✅') >= 0;
        const hasPres = infoText.indexOf('window.PresentationRequest: ✅') >= 0;
        const hasChromeCast = infoText.indexOf('Chrome Cast API: ✅') >= 0;

        if (hasRemote && hasPrompt) {
            lines.push('✅ <strong>投屏</strong>：支持 Remote Playback API，点测试按钮试试能不能搜索到设备。');
        } else if (hasPres) {
            lines.push('⚠️ <strong>投屏</strong>：只有 Presentation API（用于第二屏网页演示），不是传统投屏到电视的功能。');
        } else if (hasChromeCast) {
            lines.push('✅ <strong>投屏</strong>：检测到 Chrome Cast API。');
        } else {
            lines.push('❌ <strong>投屏</strong>：浏览器没有投屏相关 API。');
            lines.push('   👉 Aira 浏览器作为鸿蒙原生应用，能直接调用系统级投屏（华为分享 / 鸿蒙超级终端等）。');
            lines.push('   👉 Edge 安卓版在卓易通兼容层中运行，无法直接调用鸿蒙系统的投屏服务。');
        }

        // 替代方案
        lines.push('');
        lines.push('💡 <strong>替代方案：</strong>');
        lines.push('1. 投屏可以用手机系统级投屏（下拉控制中心的「无线投屏」或「华为分享」），投屏整个屏幕。');
        lines.push('2. 画中画如果不支持，可以用「全屏接管」功能获得更好的观看体验。');
        lines.push('3. 视频字幕功能不受影响，可正常使用。');

        el.innerHTML = lines.map(function (l) { return '<p>' + l + '</p>'; }).join('');
    }

    // ==================== 悬浮按钮 ====================
    function addFloatButton() {
        // 如果已有就不重复加
        if (document.getElementById('vt-diag-float')) return;

        const btn = document.createElement('button');
        btn.id = 'vt-diag-float';
        btn.textContent = '🔍';
        btn.title = '视频功能诊断';
        btn.addEventListener('click', function () {
            if (panel && panel.parentNode) {
                closePanel();
            } else {
                createPanel();
            }
        });
        document.body.appendChild(btn);
    }

    // ==================== 样式 ====================
    GM_addStyle(
        '#vt-diag-float {' +
            'position: fixed;' +
            'right: 12px;' +
            'top: 30%;' +
            'width: 42px;' +
            'height: 42px;' +
            'border-radius: 50%;' +
            'background: rgba(102, 126, 234, 0.95);' +
            'color: #fff;' +
            'border: none;' +
            'font-size: 20px;' +
            'cursor: pointer;' +
            'z-index: 2147483647;' +
            'box-shadow: 0 2px 10px rgba(0,0,0,0.3);' +
            '-webkit-tap-highlight-color: transparent;' +
        '}' +
        '#vt-diag-float:active { transform: scale(0.9); }' +

        '#vt-diag-panel {' +
            'position: fixed;' +
            'left: 0;' +
            'right: 0;' +
            'top: 0;' +
            'bottom: 0;' +
            'background: rgba(0,0,0,0.6);' +
            'z-index: 2147483647;' +
            'display: flex;' +
            'align-items: flex-end;' +
            'justify-content: center;' +
        '}' +

        '.vt-diag-box {' +
            'background: #1a1a2e;' +
            'color: #fff;' +
            'width: 100%;' +
            'max-width: 520px;' +
            'max-height: 85vh;' +
            'border-radius: 14px 14px 0 0;' +
            'display: flex;' +
            'flex-direction: column;' +
            'font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;' +
            'overflow: hidden;' +
        '}' +

        '.vt-diag-header {' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'padding: 14px 18px;' +
            'border-bottom: 1px solid rgba(255,255,255,0.1);' +
            'flex-shrink: 0;' +
        '}' +
        '.vt-diag-title { font-size: 16px; font-weight: 600; }' +

        '.vt-diag-close {' +
            'width: 32px;' +
            'height: 32px;' +
            'border-radius: 50%;' +
            'background: rgba(255,255,255,0.15);' +
            'border: none;' +
            'color: #fff;' +
            'font-size: 14px;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
        '}' +

        '.vt-diag-buttons {' +
            'display: flex;' +
            'gap: 10px;' +
            'padding: 12px 18px 0;' +
            'flex-shrink: 0;' +
        '}' +

        '.vt-diag-btn {' +
            'flex: 1;' +
            'padding: 10px;' +
            'border-radius: 8px;' +
            'border: none;' +
            'font-size: 14px;' +
            'font-weight: 500;' +
            'cursor: pointer;' +
            'color: #fff;' +
            '-webkit-tap-highlight-color: transparent;' +
        '}' +
        '.vt-diag-btn-pip { background: linear-gradient(135deg, #667eea, #764ba2); }' +
        '.vt-diag-btn-cast { background: linear-gradient(135deg, #f093fb, #f5576c); }' +
        '.vt-diag-btn:active { opacity: 0.7; }' +

        '.vt-diag-test-result {' +
            'margin: 10px 18px 0;' +
            'padding: 10px 12px;' +
            'background: rgba(255,255,255,0.08);' +
            'border-radius: 8px;' +
            'font-size: 12px;' +
            'line-height: 1.6;' +
            'color: #cbd5e0;' +
            'white-space: pre-wrap;' +
            'word-break: break-all;' +
            'flex-shrink: 0;' +
            'max-height: 100px;' +
            'overflow-y: auto;' +
        '}' +

        '.vt-diag-label {' +
            'padding: 12px 18px 6px;' +
            'font-size: 13px;' +
            'font-weight: 600;' +
            'color: #a0aec0;' +
            'flex-shrink: 0;' +
        '}' +

        '.vt-diag-body {' +
            'flex: 1;' +
            'overflow-y: auto;' +
            'margin: 0 18px;' +
            'background: rgba(0,0,0,0.3);' +
            'border-radius: 8px;' +
            'padding: 10px 12px;' +
            'min-height: 150px;' +
        '}' +

        '.vt-diag-text {' +
            'margin: 0;' +
            'font-family: Consolas, "Courier New", monospace;' +
            'font-size: 12px;' +
            'line-height: 1.7;' +
            'color: #e2e8f0;' +
            'white-space: pre-wrap;' +
            'word-break: break-all;' +
        '}' +

        '.vt-diag-conclusion {' +
            'margin: 0 18px 18px;' +
            'padding: 12px 14px;' +
            'background: rgba(102, 126, 234, 0.15);' +
            'border-left: 3px solid #667eea;' +
            'border-radius: 0 8px 8px 0;' +
            'font-size: 12px;' +
            'line-height: 1.7;' +
            'color: #e2e8f0;' +
            'flex-shrink: 0;' +
        '}' +
        '.vt-diag-conclusion p { margin: 0 0 6px; }' +
        '.vt-diag-conclusion p:last-child { margin-bottom: 0; }' +
        '.vt-diag-conclusion strong { color: #fff; }'
    );

    // ==================== 启动 ====================
    function init() {
        // 页面加载后立即显示悬浮按钮
        addFloatButton();

        // 也可以等 DOM 完全就绪后再加一次（保险）
        if (document.body) {
            addFloatButton();
        } else {
            document.addEventListener('DOMContentLoaded', addFloatButton);
        }

        console.log('[诊断工具] 已加载，点击右侧🔍按钮查看');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

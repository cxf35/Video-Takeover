// ==UserScript==
// @name         网页视频接管 - 移动端版
// @namespace    https://github.com/mason173/aira-browser
// @version      3.9.1
// @description  移动端网页视频接管：视频右下角悬浮按钮（投屏/画中画/全屏），点击全屏后横屏接管播放，支持字幕、长按快进、双击步进、屏幕锁定等功能。
// @author       Video Takeover
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj48c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNjY3ZWVhIi8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNzY0YmEyIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTIiIGZpbGw9InVybCgjZykiLz48cGF0aCBkPSJNMjAgMTZWMzZMMzIgMjZaIiBmaWxsPSIjZmZmIiBvcGFjaXR5PSIwLjkiLz48cGF0aCBkPSJNMjAgNDJINTJWNDZIMjBaIiBmaWxsPSIjZmZmIiBvcGFjaXR5PSIwLjciLz48cGF0aCBkPSJNMjAgNTBINTVWNTRIMjBaIiBmaWxsPSIjZmZmIiBvcGFjaXR5PSIwLjUiLz48L3N2Zz4=
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api-shoulei-ssl.xunlei.com
// @connect      subtitle.geilijiasu.com
// @connect      www.subtitlecat.com
// @connect      *
// @run-at       document-idle
// @license      GPL-3.0
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        // 长按快进速度倍率
        longPressSpeed: 3,
        // 双击步进秒数
        doubleTapSeek: 10,
        // 自动隐藏控制栏延迟（毫秒）
        controlsAutoHideDelay: 3000,
        // 倍速选项
        playbackRates: [0.2, 0.3, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0],
    };

    // ==================== 全局状态 ====================
    const state = {
        // 当前追踪的视频元素
        currentVideo: null,
        // 视频原始父元素（用于退出全屏时恢复）
        originalParent: null,
        originalNextSibling: null,
        originalStyles: {},
        // 全屏接管容器
        takeoverContainer: null,
        // 是否处于接管全屏模式
        isTakeoverActive: false,
        // 是否锁定屏幕
        isLocked: false,
        // 用户是否主动暂停（用于防意外暂停判断）
        userPaused: false,
        // 全屏模式: fit(适应) | crop(裁剪) | stretch(拉伸)
        fullscreenMode: 'fit',
        // 屏幕方向: landscape(横屏) | portrait(竖屏)
        orientation: 'landscape',
        // 旋转模式: 'native'(原生方向锁) | 'css'(CSS旋转)
        rotationMode: 'native',
        // 是否使用CSS旋转（仅CSS模式下竖屏时为true，用于坐标转换判断）
        useCssRotation: false,
        // 控制栏是否显示
        controlsVisible: true,
        // 自动隐藏定时器
        autoHideTimer: null,
        // 长按状态
        longPressTimer: null,
        isLongPressing: false,
        longPressDirection: null, // 'forward' | 'backward'
    };

    // ==================== 工具函数 ====================
    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    // ==================== 视频检测 ====================
    const VideoDetector = {
        init() {
            this.scanVideos();
            this.observeDOM();
            setInterval(() => this.scanVideos(), 2000);
        },

        scanVideos() {
            const videos = document.querySelectorAll('video');
            videos.forEach((video) => {
                if (!video.dataset.vtProcessed) {
                    video.dataset.vtProcessed = 'true';
                    this.setupVideo(video);
                }
            });
        },

        setupVideo(video) {
            // 跳过明显没有内容的视频（无src且readyState=0）
            const hasSource = video.src || video.currentSrc ||
                             (video.querySelector('source') && video.querySelector('source').src);
            if (!hasSource && video.readyState === 0) {
                // 监听 src 变化，等有内容了再处理（不打vtProcessed标记，scanVideos还会继续扫）
                const onSourceChange = () => {
                    if (video.src || video.currentSrc) {
                        video.removeEventListener('loadedmetadata', onSourceChange);
                        video.removeEventListener('play', onSourceChange);
                        video.dataset.vtProcessed = 'true';
                        this.setupVideo(video);
                    }
                };
                video.addEventListener('loadedmetadata', onSourceChange, { once: true });
                video.addEventListener('play', onSourceChange, { once: true });
                return;
            }

            video.dataset.vtProcessed = 'true';

            // 等待视频有尺寸后再添加悬浮按钮
            const addButtons = () => {
                if (video.videoWidth > 0 || video.clientWidth > 50) {
                    FloatingButtons.attach(video);
                }
            };

            if (video.readyState >= 1) {
                addButtons();
            } else {
                video.addEventListener('loadedmetadata', addButtons, { once: true });
                // 兜底：2秒后也尝试添加
                setTimeout(addButtons, 2000);
            }

            video.addEventListener('play', () => {
                FloatingButtons.showForVideo(video);
            });
        },

        observeDOM() {
            const observer = new MutationObserver(() => {
                this.scanVideos();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        },
    };

    // ==================== 视频右下角悬浮按钮 ====================
    const FloatingButtons = {
        // 存储 video -> buttonContainer 的映射
        buttonMap: new WeakMap(),

        attach(video) {
            if (this.buttonMap.has(video)) return;

            const container = document.createElement('div');
            container.className = 'vt-float-buttons';
            container.innerHTML = `
                <button class="vt-float-btn vt-btn-cast" data-action="cast" title="投屏">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
                        <line x1="2" y1="20" x2="2.01" y2="20"/>
                    </svg>
                </button>
                <button class="vt-float-btn vt-btn-pip" data-action="pip" title="画中画">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="14" rx="2" ry="2"/>
                        <rect x="12" y="12" width="7" height="7" rx="1" fill="currentColor" stroke="none"/>
                    </svg>
                </button>
                <button class="vt-float-btn vt-btn-fullscreen" data-action="fullscreen" title="全屏">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                    </svg>
                </button>
            `;

            // 将按钮插入到 video 的父容器中，定位在 video 右下角
            const parent = video.parentElement;
            if (!parent) return;

            // 确保父元素是定位元素
            const parentStyle = getComputedStyle(parent);
            if (parentStyle.position === 'static') {
                parent.style.position = 'relative';
            }

            parent.appendChild(container);
            this.buttonMap.set(video, container);

            // 绑定事件
            container.querySelectorAll('.vt-float-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const action = btn.dataset.action;
                    this.handleAction(action, video);
                });
            });

            // 鼠标/触摸进入视频区域时显示按钮
            const showButtons = () => {
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            };
            const hideButtons = () => {
                container.style.opacity = '0';
                container.style.pointerEvents = 'none';
            };

            parent.addEventListener('mouseenter', showButtons);
            parent.addEventListener('mouseleave', hideButtons);
            parent.addEventListener('touchstart', showButtons, { passive: true });

            // 初始显示
            showButtons();

            // 3秒后自动隐藏
            let hideTimer;
            const scheduleHide = () => {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(hideButtons, 3000);
            };
            parent.addEventListener('touchstart', scheduleHide, { passive: true });
            parent.addEventListener('mousemove', scheduleHide);
            scheduleHide();
        },

        handleAction(action, video) {
            switch (action) {
                case 'cast':
                    this.doCast(video);
                    break;
                case 'pip':
                    this.doPiP(video);
                    break;
                case 'fullscreen':
                    TakeoverPlayer.enter(video);
                    break;
            }
        },

        doCast(video) {
            // 只使用 Remote Playback API（视频投屏的标准API）
            if (video.remote && typeof video.remote.prompt === 'function') {
                video.remote.prompt().catch((err) => {
                    console.warn('[VT] 投屏失败:', err.name, err.message);
                    // 常见错误分类
                    switch (err.name) {
                        case 'NotAllowedError':
                            // 用户取消或设备选择框自动关闭
                            break;
                        case 'NotFoundError':
                            this.showToast('未找到投屏设备');
                            break;
                        case 'NotSupportedError':
                            this.showToast('当前视频不支持投屏');
                            break;
                        default:
                            this.showToast('投屏不可用');
                    }
                });
                return;
            }

            // 不支持投屏
            this.showToast('当前浏览器不支持投屏');
        },

        doPiP(video) {
            // 防止重复点击
            if (this._pipBusy) return;

            // 已经在画中画 → 退出
            if (document.pictureInPictureElement) {
                this._pipBusy = true;
                document.exitPictureInPicture()
                    .catch(() => {})
                    .finally(() => { this._pipBusy = false; });
                return;
            }

            // 浏览器不支持
            if (!document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== 'function') {
                this.showToast('当前浏览器不支持画中画');
                return;
            }

            // 移除禁用属性（某些网站会设置）
            try {
                video.removeAttribute('disablepictureinpicture');
                video.removeAttribute('disablePictureInPicture');
                video.disablePictureInPicture = false;
            } catch (e) {}

            // 调用标准 PiP
            this._pipBusy = true;
            video.requestPictureInPicture()
                .then(() => {
                    // PiP 进入成功
                    // 监听退出事件，清理状态
                    const onLeave = () => {
                        video.removeEventListener('leavepictureinpicture', onLeave);
                        this._pipBusy = false;
                    };
                    video.addEventListener('leavepictureinpicture', onLeave, { once: true });
                })
                .catch((err) => {
                    this._pipBusy = false;
                    console.warn('[VT] 画中画失败:', err.name, err.message);
                    switch (err.name) {
                        case 'NotAllowedError':
                            this.showToast('请先播放视频后再试');
                            break;
                        case 'NotSupportedError':
                            this.showToast('当前视频不支持画中画');
                            break;
                        case 'InvalidStateError':
                            this.showToast('视频未就绪');
                            break;
                        default:
                            this.showToast('画中画启动失败');
                    }
                });
        },

        showForVideo(video) {
            const container = this.buttonMap.get(video);
            if (container) {
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }
        },

        showToast(message) {
            const toast = document.createElement('div');
            toast.className = 'vt-toast';
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.classList.add('vt-toast-show');
            }, 10);
            setTimeout(() => {
                toast.classList.remove('vt-toast-show');
                setTimeout(() => toast.remove(), 300);
            }, 2000);
        },
    };

    // ==================== 全屏接管播放器 ====================
    const TakeoverPlayer = {
        enter(video) {
            state.currentVideo = video;
            state.isTakeoverActive = true;
            state.isLocked = false;
            state.fullscreenMode = 'fit';

            // 保存原始位置信息
            state.originalParent = video.parentElement;
            state.originalNextSibling = video.nextElementSibling;
            state.originalStyles = {
                style: video.getAttribute('style') || '',
                class: video.className,
            };

            // 创建接管容器
            const container = document.createElement('div');
            container.className = 'vt-takeover-container';
            container.id = 'vt-takeover-container';
            state.takeoverContainer = container;

            // 构建播放器UI
            container.innerHTML = `
                <div class="vt-takeover-video-wrapper">
                    <!-- 视频会被移动到这里 -->
                </div>
                <div class="vt-takeover-top-bar">
                    <button class="vt-top-btn vt-back-btn" data-action="exit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                    </button>
                    <div class="vt-video-url">${document.title || location.href}</div>
                    <div style="width: 40px;"></div>
                </div>
                <div class="vt-takeover-center-controls">
                    <button class="vt-center-btn vt-prev-btn" data-action="prev">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                        </svg>
                    </button>
                    <button class="vt-center-btn vt-play-btn" data-action="toggle">
                        <svg class="vt-icon-play" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                        <svg class="vt-icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                    </button>
                    <button class="vt-center-btn vt-next-btn" data-action="next">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                        </svg>
                    </button>
                </div>
                <div class="vt-takeover-progress">
                    <span class="vt-time vt-current-time">0:00</span>
                    <div class="vt-progress-bar">
                        <div class="vt-progress-buffered"></div>
                        <div class="vt-progress-played"></div>
                        <div class="vt-progress-thumb"></div>
                    </div>
                    <span class="vt-time vt-duration">0:00</span>
                </div>
                <div class="vt-takeover-bottom-bar">
                    <button class="vt-bottom-btn" data-action="screen-mode" title="全屏模式">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                        </svg>
                        <span class="vt-btn-label">适应</span>
                    </button>
                    <button class="vt-bottom-btn" data-action="subtitle" title="字幕">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="2" y="5" width="20" height="14" rx="2"/>
                            <path d="M6 10h4M12 10h2M6 14h8M16 14h2"/>
                        </svg>
                        <span class="vt-btn-label">字幕</span>
                    </button>
                    <button class="vt-bottom-btn" data-action="speed" title="倍速">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <span class="vt-btn-label">1.0x</span>
                    </button>
                    <button class="vt-bottom-btn" data-action="reload" title="重新载入">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        <span class="vt-btn-label">重载</span>
                    </button>
                    <button class="vt-bottom-btn vt-rotate-btn" data-action="rotate" title="横竖屏切换">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="7" y="2" width="10" height="20" rx="2" transform="rotate(15 12 12)"/>
                            <path d="M10 5.5h4" transform="rotate(15 12 12)"/>
                            <path d="M10 18.5h4" transform="rotate(15 12 12)"/>
                            <path d="M5.5 9.5c-1.5 2-1.5 5 0 7"/>
                            <path d="M4.8 7.5l1.5 1.5-1.5.5"/>
                            <path d="M18.5 14.5c1.5-2 1.5-5 0-7"/>
                            <path d="M19.2 16.5l-1.5-1.5 1.5-.5"/>
                        </svg>
                        <span class="vt-btn-label">旋转</span>
                    </button>
                    <button class="vt-bottom-btn vt-lock-btn" data-action="lock" title="锁定屏幕">
                        <svg class="vt-icon-unlock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <svg class="vt-icon-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <span class="vt-btn-label">锁定</span>
                    </button>
                </div>
                <!-- 倍速菜单 -->
                <div class="vt-speed-menu" style="display:none;">
                    ${CONFIG.playbackRates.map((rate) =>
                        `<div class="vt-speed-option" data-rate="${rate}">${rate}x</div>`
                    ).join('')}
                </div>
            `;

            document.body.appendChild(container);

            // 将视频移动到接管容器
            const wrapper = container.querySelector('.vt-takeover-video-wrapper');
            wrapper.appendChild(video);

            // 应用视频样式
            this.applyVideoStyle(video);

            // 绑定事件
            this.bindEvents(container, video);

            // 尝试请求全屏和横屏
            this.requestFullscreenAndLandscape(container);

            // 更新UI状态
            this.updatePlayState(video);
            this.updateTime(video);
            this.updateSpeedLabel(video);

            // 初始化旋转按钮状态
            const rotateBtn = container.querySelector('.vt-rotate-btn .vt-btn-label');
            rotateBtn.textContent = '竖屏'; // 默认横屏，点击切竖屏

            // 初始化字幕管理器
            SubtitleManager.init();
            // 如果已有字幕数据，恢复渲染
            if (SubtitleManager.state.cues.length) {
                SubtitleManager.renderLoop();
            }

            // 自动隐藏控制栏
            this.resetAutoHide();

            // 添加视频事件监听
            this.addVideoListeners(video);

            // 防意外暂停保护：进入接管后3秒内，如果视频被外部暂停（原网站JS），自动恢复播放
            const wasPlaying = !video.paused;
            let antiPauseCount = 0;
            const antiPauseMax = 3; // 最多恢复3次，防止无限循环
            state._antiPauseHandler = () => {
                if (state.isTakeoverActive && antiPauseCount < antiPauseMax && !state.userPaused) {
                    antiPauseCount++;
                    video.play().catch(() => {});
                }
            };
            video.addEventListener('pause', state._antiPauseHandler);
            setTimeout(() => {
                if (video && state._antiPauseHandler) {
                    video.removeEventListener('pause', state._antiPauseHandler);
                    state._antiPauseHandler = null;
                }
            }, 3000);

            // 如果进来时就在播放，确保继续播放
            if (wasPlaying && video.paused) {
                video.play().catch(() => {});
            }
        },

        exit() {
            const video = state.currentVideo;
            const container = state.takeoverContainer;

            if (!video || !container) return;

            // 清理视频事件监听
            this.removeVideoListeners(video);

            // 恢复视频原始样式
            video.setAttribute('style', state.originalStyles.style);
            video.className = state.originalStyles.class;
            video.style.objectFit = '';

            // 将视频放回原位置
            if (state.originalParent) {
                if (state.originalNextSibling) {
                    state.originalParent.insertBefore(video, state.originalNextSibling);
                } else {
                    state.originalParent.appendChild(video);
                }
            }

            // 退出全屏
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => { });
            }

            // 解锁屏幕方向
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }

            // 清理字幕
            SubtitleManager.cleanup();

            // 移除容器
            container.remove();

            // 清除自动隐藏定时器
            if (state.autoHideTimer) {
                clearTimeout(state.autoHideTimer);
                state.autoHideTimer = null;
            }

            // 清理长按状态
            this.cancelLongPress();

            // 重置状态
            state.isTakeoverActive = false;
            state.currentVideo = null;
            state.takeoverContainer = null;
            state.isLocked = false;
            state.userPaused = false;
            state.controlsVisible = true;
            state.orientation = 'landscape';
            state.useCssRotation = false;

            // 清理防暂停保护
            if (state._antiPauseHandler && video) {
                video.removeEventListener('pause', state._antiPauseHandler);
                state._antiPauseHandler = null;
            }
        },

        applyVideoStyle(video) {
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'contain'; // 默认适应
            video.style.display = 'block';
            video.style.margin = '0 auto';
            video.style.position = 'absolute';
            video.style.top = '50%';
            video.style.left = '50%';
            video.style.transform = 'translate(-50%, -50%)';
            video.style.maxWidth = '100%';
            video.style.maxHeight = '100%';
        },

        bindEvents(container, video) {
            // 顶部返回按钮
            container.querySelector('.vt-back-btn').addEventListener('click', () => {
                if (state.isLocked) return;
                this.exit();
            });

            // 中央播放按钮
            container.querySelector('.vt-play-btn').addEventListener('click', () => {
                if (state.isLocked) return;
                this.togglePlay(video);
            });

            // 上一个/下一个
            container.querySelector('.vt-prev-btn').addEventListener('click', () => {
                if (state.isLocked) return;
                this.seek(video, -10);
            });
            container.querySelector('.vt-next-btn').addEventListener('click', () => {
                if (state.isLocked) return;
                this.seek(video, 10);
            });

            // 底部按钮
            container.querySelectorAll('.vt-bottom-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    if (state.isLocked && btn.dataset.action !== 'lock') return;
                    const action = btn.dataset.action;
                    this.handleBottomAction(action, btn, video);
                });
            });

            // 重载按钮：短按重新应用当前模式，长按切换原生/CSS模式
            const reloadBtn = container.querySelector('[data-action="reload"]');
            if (reloadBtn) {
                let lpTimer = null;
                let longPressed = false;
                const startLp = (e) => {
                    if (state.isLocked) return;
                    longPressed = false;
                    lpTimer = setTimeout(() => {
                        longPressed = true;
                        this.switchRotationMode();
                    }, 800);
                };
                const cancelLp = () => {
                    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
                };
                reloadBtn.addEventListener('touchstart', startLp, { passive: true });
                reloadBtn.addEventListener('touchend', (e) => {
                    cancelLp();
                    if (longPressed) {
                        reloadBtn.dataset.longPressed = '1';
                        e.preventDefault();
                        e.stopPropagation();
                    }
                });
                reloadBtn.addEventListener('touchmove', cancelLp);
                reloadBtn.addEventListener('touchcancel', cancelLp);
                reloadBtn.addEventListener('mousedown', startLp);
                reloadBtn.addEventListener('mouseup', cancelLp);
                reloadBtn.addEventListener('mouseleave', cancelLp);
            }

            // 进度条
            const progressBar = container.querySelector('.vt-progress-bar');
            let isSeeking = false;

            const seekByEvent = (e) => {
                if (state.isLocked) return;
                const rect = progressBar.getBoundingClientRect();
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                let percent;
                if (state.useCssRotation) {
                    // 容器被CSS旋转90°，进度条的长度方向对应视口的 Y 轴
                    percent = clamp((cy - rect.top) / rect.height, 0, 1);
                } else {
                    percent = clamp((cx - rect.left) / rect.width, 0, 1);
                }
                if (video.duration) {
                    video.currentTime = percent * video.duration;
                }
            };

            progressBar.addEventListener('touchstart', (e) => {
                if (state.isLocked) return;
                isSeeking = true;
                seekByEvent(e);
                this.cancelAutoHide();
            }, { passive: true });

            progressBar.addEventListener('touchmove', (e) => {
                if (!isSeeking || state.isLocked) return;
                seekByEvent(e);
            }, { passive: true });

            progressBar.addEventListener('touchend', () => {
                isSeeking = false;
                this.resetAutoHide();
            });

            progressBar.addEventListener('mousedown', (e) => {
                if (state.isLocked) return;
                isSeeking = true;
                seekByEvent(e);
            });
            document.addEventListener('mousemove', (e) => {
                if (!isSeeking) return;
                seekByEvent(e);
            });
            document.addEventListener('mouseup', () => {
                isSeeking = false;
            });

            // 手势处理：单击、双击、长按、滑动（绑定在整个容器上，确保事件能捕获）
            this.setupGestures(container, video);

            // 倍速菜单选项
            container.querySelectorAll('.vt-speed-option').forEach((opt) => {
                opt.addEventListener('click', () => {
                    if (state.isLocked) return;
                    const rate = parseFloat(opt.dataset.rate);
                    video.playbackRate = rate;
                    this.updateSpeedLabel(video);
                    container.querySelector('.vt-speed-menu').style.display = 'none';
                });
            });

            // 底部锁定按钮：长按解锁
            const lockBtn = container.querySelector('.vt-lock-btn');
            let unlockTimer = null;

            const startUnlock = (e) => {
                if (!state.isLocked) return; // 未锁定时不触发长按
                e.preventDefault();
                let pressTime = 0;
                lockBtn.classList.add('vt-unlock-pressing');
                unlockTimer = setInterval(() => {
                    pressTime += 100;
                    if (pressTime >= 1000) {
                        clearInterval(unlockTimer);
                        unlockTimer = null;
                        this.toggleLock();
                        lockBtn.classList.remove('vt-unlock-pressing');
                    }
                }, 100);
            };

            const cancelUnlock = () => {
                if (unlockTimer) {
                    clearInterval(unlockTimer);
                    unlockTimer = null;
                }
                lockBtn.classList.remove('vt-unlock-pressing');
            };

            lockBtn.addEventListener('touchstart', startUnlock, { passive: false });
            lockBtn.addEventListener('touchend', cancelUnlock);
            lockBtn.addEventListener('touchcancel', cancelUnlock);
            lockBtn.addEventListener('mousedown', startUnlock);
            lockBtn.addEventListener('mouseup', cancelUnlock);
            lockBtn.addEventListener('mouseleave', cancelUnlock);
        },

        setupGestures(container, video) {
            // ============ 手势状态 ============
            const TAP_DELAY = 280;       // 单击延迟判定（ms）
            const LONG_PRESS_DELAY = 1200; // 长按触发时间（ms）—— 加长留出更多时间给音量/亮度/进度手势
            const MOVE_THRESHOLD = 20;    // 移动取消点击的阈值（px）
            const SWIPE_THRESHOLD = 30;   // 判定为滑动的阈值（px）
            const SEEK_PER_PX = 0.1;      // 每像素对应多少秒进度（根据屏幕宽度动态调整）

            let touchId = null;
            let startX = 0;
            let startY = 0;
            let startTime = 0;
            let lastX = 0;

            // 手势状态机
            let gesturePhase = 'idle'; // idle | waiting | tap-pending | long-press | swiping
            let singleTapTimer = null;

            // 双击检测
            let lastTapTime = 0;
            let lastTapX = 0;
            let lastTapY = 0;

            // 长按定时器
            let longPressTimer = null;
            let isLongPressActive = false;

            // 滑动进度
            let seekStartPosition = 0;
            let seekTotalDelta = 0;

            // 垂直滑动（音量 / 亮度）
            let verticalMode = null;      // 'volume' | 'brightness'
            let verticalStartValue = 0;
            let brightnessLevel = 1;      // 0~1，1 表示原始亮度
            let originalVideoFilter = null;  // video 原始的 style.filter，叠加亮度时保留

            // 长按倍速调节
            let longPressStartX = 0;
            let longPressBaseRate = CONFIG.longPressSpeed; // 长按时的基础倍速
            let longPressCurrentRate = CONFIG.longPressSpeed;
            const LONG_PRESS_MIN_RATE = 0.2;
            const LONG_PRESS_MAX_RATE = 6.0;
            // 每像素调整多少倍速（屏幕宽度对应从基础速度到最大速度）
            const RATE_PER_PIXEL = (LONG_PRESS_MAX_RATE - 1) / 400; // 400px 对应 5 档速度变化

            // 上一次的速率（长按快进用）
            let originalRate = null;

            // 判断点击目标是否是交互元素（按钮/进度条等）
            const isInteractiveElement = (target) => {
                return !!(target.closest('button') ||
                    target.closest('.vt-progress-bar') ||
                    target.closest('.vt-speed-menu') ||
                    target.closest('.vt-bottom-btn') ||
                    target.closest('.vt-top-btn') ||
                    target.closest('.vt-center-btn') ||
                    target.closest('.vt-takeover-top-bar') ||
                    target.closest('.vt-takeover-bottom-bar') ||
                    target.closest('.vt-takeover-progress') ||
                    target.closest('.vt-takeover-center-controls') ||
                    target.closest('.vt-sub-panel') ||
                    target.closest('.vt-sub-preview-modal'));
            };

            const getContainerWidth = () => container.clientWidth;

            // CSS旋转时容器被 rotate(90deg)，视口坐标与"用户视角"坐标轴互换
            const isCssRotated = () => state.useCssRotation;

            // 把视口坐标换算成用户视角坐标（未旋转时原样返回）
            // 旋转推导：X = innerWidth - y_local, Y = x_local
            // 反推：x_local = clientY, y_local = innerWidth - clientX
            const toUserXY = (clientX, clientY) => {
                if (!isCssRotated()) return { x: clientX, y: clientY };
                return { x: clientY, y: window.innerWidth - clientX };
            };

            // 显示进度提示
            const showSeekPreview = (deltaSeconds) => {
                let preview = container.querySelector('.vt-seek-preview');
                if (!preview) {
                    preview = document.createElement('div');
                    preview.className = 'vt-seek-preview';
                    container.appendChild(preview);
                }
                const newTime = clamp(seekStartPosition + deltaSeconds, 0, video.duration || 0);
                preview.innerHTML = `
                    <div class="vt-seek-preview-time">${formatTime(newTime)} / ${formatTime(video.duration || 0)}</div>
                    <div class="vt-seek-preview-bar">
                        <div class="vt-seek-preview-progress" style="width: ${video.duration ? (newTime / video.duration * 100) : 0}%"></div>
                    </div>
                `;
                preview.style.display = 'block';
            };

            const hideSeekPreview = () => {
                const preview = container.querySelector('.vt-seek-preview');
                if (preview) preview.style.display = 'none';
            };

            // ============ 音量 / 亮度 ============
            const getContainerHeight = () => container.clientHeight;

            const VERTICAL_META = {
                volume: { icon: '🔊', label: '音量' },
                brightness: { icon: '☀️', label: '亮度' },
            };

            const showVerticalIndicator = (mode, value) => {
                let el = container.querySelector('.vt-vertical-indicator');
                if (!el) {
                    el = document.createElement('div');
                    el.className = 'vt-vertical-indicator';
                    container.appendChild(el);
                }
                const percent = Math.round(clamp(value, 0, 1) * 100);
                el.innerHTML = `
                    <div class="vt-vi-icon">${VERTICAL_META[mode].icon}</div>
                    <div class="vt-vi-value">${percent}%</div>
                    <div class="vt-vi-bar"><div class="vt-vi-bar-fill" style="width:${percent}%"></div></div>
                `;
                el.style.display = 'flex';
            };

            const hideVerticalIndicator = () => {
                const el = container.querySelector('.vt-vertical-indicator');
                if (el) el.style.display = 'none';
            };

            // ============ 长按处理 ============
            const updateLongPressRateDisplay = (rate) => {
                let indicator = container.querySelector('.vt-longpress-indicator');
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.className = 'vt-longpress-indicator';
                    container.appendChild(indicator);
                }
                const rateFixed = rate.toFixed(1);
                indicator.innerHTML = `
                    <div class="vt-lp-rate">${rateFixed}x</div>
                    <div class="vt-lp-hint">左右滑动调节速度</div>
                `;
                indicator.style.display = 'flex';
                indicator.style.flexDirection = 'column';
                indicator.style.gap = '6px';
            };

            const startLongPress = (touchX) => {
                if (state.isLocked) return;
                isLongPressActive = true;
                gesturePhase = 'long-press';
                originalRate = video.playbackRate;
                longPressStartX = touchX;
                longPressCurrentRate = CONFIG.longPressSpeed;

                if (video.paused) {
                    video.play().catch(() => { });
                }
                video.playbackRate = longPressCurrentRate;
                updateLongPressRateDisplay(longPressCurrentRate);
            };

            const adjustLongPressRate = (deltaX) => {
                // 向右滑增加速度，向左滑减少速度
                const deltaRate = deltaX * RATE_PER_PIXEL;
                let newRate = longPressBaseRate + deltaRate;
                newRate = clamp(newRate, LONG_PRESS_MIN_RATE, LONG_PRESS_MAX_RATE);

                // 只在速度变化明显时更新，减少抖动
                if (Math.abs(newRate - longPressCurrentRate) >= 0.1) {
                    longPressCurrentRate = Math.round(newRate * 10) / 10;
                    video.playbackRate = longPressCurrentRate;
                    updateLongPressRateDisplay(longPressCurrentRate);
                }
            };

            const endLongPress = () => {
                if (!isLongPressActive) return;
                isLongPressActive = false;

                // 恢复原速度
                if (originalRate !== null) {
                    video.playbackRate = originalRate;
                    originalRate = null;
                }

                // 隐藏指示器
                const indicator = container.querySelector('.vt-longpress-indicator');
                if (indicator) indicator.style.display = 'none';
            };

            // ============ 触摸开始 ============
            const onTouchStart = (e) => {
                if (state.isLocked) return;

                // 如果点在交互元素上，不处理手势
                if (isInteractiveElement(e.target)) {
                    gesturePhase = 'idle';
                    return;
                }

                // 只处理第一个触摸点
                if (touchId !== null) return;

                const touch = e.touches[0];
                touchId = touch.identifier;
                const p = toUserXY(touch.clientX, touch.clientY);
                startX = p.x;
                startY = p.y;
                lastX = p.x;
                startTime = Date.now();
                seekStartPosition = video.currentTime || 0;
                seekTotalDelta = 0;

                // 清除之前的单击定时器
                if (singleTapTimer) {
                    clearTimeout(singleTapTimer);
                    singleTapTimer = null;
                }

                // 清除之前的长按定时器
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }

                gesturePhase = 'waiting';

                // 设置长按定时器
                longPressTimer = setTimeout(() => {
                    if (gesturePhase === 'waiting') {
                        startLongPress(p.x);
                    }
                }, LONG_PRESS_DELAY);

                // 阻止默认行为（防止长按弹出菜单）
                e.preventDefault();
            };

            // ============ 触摸移动 ============
            const onTouchMove = (e) => {
                if (state.isLocked) return;
                if (touchId === null) return;

                // 找到对应的触摸点
                let touch = null;
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === touchId) {
                        touch = e.touches[i];
                        break;
                    }
                }
                if (!touch) return;

                const p = toUserXY(touch.clientX, touch.clientY);
                const dx = p.x - startX;
                const dy = p.y - startY;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);

                // 根据不同阶段处理
                if (gesturePhase === 'waiting') {
                    // 一旦越过滑动阈值，先取消长按判定，再按主导方向锁定手势类型
                    if (absDx > SWIPE_THRESHOLD || absDy > SWIPE_THRESHOLD) {
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                        if (absDx >= absDy) {
                            // 水平滑动 → 拖动进度
                            gesturePhase = 'swiping';
                            showSeekPreview(0);
                        } else {
                            // 垂直滑动 → 左侧调亮度，右侧调音量
                            gesturePhase = 'vertical';
                            verticalMode = (startX < getContainerWidth() / 2) ? 'brightness' : 'volume';
                            verticalStartValue = verticalMode === 'volume'
                                ? (video.muted ? 0 : video.volume)
                                : brightnessLevel;
                            showVerticalIndicator(verticalMode, verticalStartValue);
                        }
                    }
                }

                if (gesturePhase === 'swiping') {
                    // 滑动调整进度
                    const width = getContainerWidth();
                    // 全屏宽度对应总时长的一半（更灵敏）
                    const secondsPerPixel = (video.duration || 0) / (width * 2);
                    const deltaSeconds = dx * secondsPerPixel;
                    seekTotalDelta = deltaSeconds;

                    // 实时更新进度
                    const newTime = clamp(seekStartPosition + deltaSeconds, 0, video.duration || 0);
                    video.currentTime = newTime;
                    showSeekPreview(deltaSeconds);

                    e.preventDefault();
                }

                if (gesturePhase === 'vertical') {
                    // 向上滑增加，向下滑减少；滑动 1.2 倍屏高对应满量程（参考 HTML 视频触摸手势优化脚本）
                    const fullRange = getContainerHeight() * 1.2;
                    const value = clamp(verticalStartValue - dy / fullRange, 0, 1);
                    if (verticalMode === 'volume') {
                        video.muted = false;
                        video.volume = value;
                    } else {
                        // 亮度范围 0.15 ~ 1，叠加到原始 filter 上而不是覆盖
                        brightnessLevel = value;
                        const b = 0.15 + value * 0.85;
                        if (!originalVideoFilter) originalVideoFilter = video.style.filter || '';
                        video.style.filter = b >= 0.995
                            ? originalVideoFilter
                            : ((originalVideoFilter && originalVideoFilter !== 'none') ? originalVideoFilter + ' ' : '') + 'brightness(' + b.toFixed(3) + ')';
                    }
                    showVerticalIndicator(verticalMode, value);
                    e.preventDefault();
                }

                if (gesturePhase === 'long-press') {
                    // 长按状态下左右滑动调节倍速
                    const deltaX = p.x - longPressStartX;
                    adjustLongPressRate(deltaX);
                    e.preventDefault();
                }

                lastX = p.x;
            };

            // ============ 触摸结束 ============
            const onTouchEnd = (e) => {
                if (state.isLocked) return;

                // 检查是否是我们追踪的触摸点
                let found = false;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === touchId) {
                        found = true;
                        break;
                    }
                }
                if (!found) return;

                touchId = null;

                // 清除长按定时器
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }

                const endTime = Date.now();
                const touchDuration = endTime - startTime;
                const touch = e.changedTouches[0];
                const p = toUserXY(touch.clientX, touch.clientY);
                const dx = p.x - startX;
                const dy = p.y - startY;

                // ===== 处理长按 =====
                if (isLongPressActive) {
                    endLongPress();
                    gesturePhase = 'idle';
                    return;
                }

                // ===== 处理滑动 =====
                if (gesturePhase === 'swiping') {
                    hideSeekPreview();
                    gesturePhase = 'idle';
                    return;
                }

                // ===== 处理垂直滑动（音量 / 亮度） =====
                if (gesturePhase === 'vertical') {
                    hideVerticalIndicator();
                    gesturePhase = 'idle';
                    return;
                }

                // ===== 处理点击 =====
                if (gesturePhase === 'waiting' &&
                    touchDuration < LONG_PRESS_DELAY &&
                    Math.abs(dx) < MOVE_THRESHOLD &&
                    Math.abs(dy) < MOVE_THRESHOLD) {

                    // 检测是否是双击
                    const now = endTime;
                    const dblDx = Math.abs(p.x - lastTapX);
                    const dblDy = Math.abs(p.y - lastTapY);

                    if (now - lastTapTime < TAP_DELAY &&
                        dblDx < 50 && dblDy < 50) {
                        // 双击
                        lastTapTime = 0;

                        const width = getContainerWidth();
                        const relX = p.x - container.getBoundingClientRect().left;

                        if (relX < width / 3) {
                            // 左侧双击：后退
                            this.seek(video, -CONFIG.doubleTapSeek);
                            this.showSeekIndicator(-CONFIG.doubleTapSeek);
                        } else if (relX > width * 2 / 3) {
                            // 右侧双击：快进
                            this.seek(video, CONFIG.doubleTapSeek);
                            this.showSeekIndicator(CONFIG.doubleTapSeek);
                        } else {
                            // 中间双击：播放/暂停
                            this.togglePlay(video);
                        }
                    } else {
                        // 单击（延迟执行）
                        lastTapTime = now;
                        lastTapX = p.x;
                        lastTapY = p.y;

                        singleTapTimer = setTimeout(() => {
                            singleTapTimer = null;
                            this.toggleControls();
                        }, TAP_DELAY);
                    }
                }

                gesturePhase = 'idle';
            };

            // ============ 触摸取消 ============
            const onTouchCancel = () => {
                touchId = null;
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
                if (singleTapTimer) {
                    clearTimeout(singleTapTimer);
                    singleTapTimer = null;
                }
                if (isLongPressActive) {
                    endLongPress();
                }
                hideSeekPreview();
                hideVerticalIndicator();
                gesturePhase = 'idle';
            };

            // ============ 绑定事件 ============
            // 使用 capture 模式确保能捕获到 video 上的事件
            container.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
            container.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
            container.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
            container.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });

            // ============ 鼠标支持（桌面调试） ============
            let isMouseDown = false;
            let mouseStartX = 0;
            let mouseStartY = 0;
            let mouseStartTime = 0;
            let mouseGesturePhase = 'idle';
            let mouseLongPressTimer = null;
            let mouseIsLongPress = false;
            let mouseOriginalRate = null;
            let mouseLongPressStartX = 0;
            let mouseLongPressCurrentRate = CONFIG.longPressSpeed;
            let mouseSingleTapTimer = null;
            let mouseLastTapTime = 0;
            let mouseLastTapX = 0;
            let mouseLastTapY = 0;
            let mouseSeekStartPos = 0;

            const mouseUpdateRateDisplay = (rate) => {
                let indicator = container.querySelector('.vt-longpress-indicator');
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.className = 'vt-longpress-indicator';
                    container.appendChild(indicator);
                }
                indicator.innerHTML = `
                    <div class="vt-lp-rate">${rate.toFixed(1)}x</div>
                    <div class="vt-lp-hint">左右滑动调节速度</div>
                `;
                indicator.style.display = 'flex';
                indicator.style.flexDirection = 'column';
                indicator.style.gap = '6px';
            };

            const mouseAdjustRate = (deltaX) => {
                const deltaRate = deltaX * RATE_PER_PIXEL;
                let newRate = longPressBaseRate + deltaRate;
                newRate = clamp(newRate, LONG_PRESS_MIN_RATE, LONG_PRESS_MAX_RATE);
                if (Math.abs(newRate - mouseLongPressCurrentRate) >= 0.1) {
                    mouseLongPressCurrentRate = Math.round(newRate * 10) / 10;
                    video.playbackRate = mouseLongPressCurrentRate;
                    mouseUpdateRateDisplay(mouseLongPressCurrentRate);
                }
            };

            container.addEventListener('mousedown', (e) => {
                if (state.isLocked) return;
                if (isInteractiveElement(e.target)) return;
                if (e.button !== 0) return; // 只处理左键

                isMouseDown = true;
                const mp = toUserXY(e.clientX, e.clientY);
                mouseStartX = mp.x;
                mouseStartY = mp.y;
                mouseStartTime = Date.now();
                mouseSeekStartPos = video.currentTime || 0;

                if (mouseSingleTapTimer) {
                    clearTimeout(mouseSingleTapTimer);
                    mouseSingleTapTimer = null;
                }

                mouseGesturePhase = 'waiting';

                mouseLongPressTimer = setTimeout(() => {
                    if (mouseGesturePhase === 'waiting') {
                        mouseGesturePhase = 'long-press';
                        mouseIsLongPress = true;
                        mouseOriginalRate = video.playbackRate;
                        mouseLongPressStartX = mp.x;
                        mouseLongPressCurrentRate = CONFIG.longPressSpeed;
                        if (video.paused) video.play().catch(() => { });
                        video.playbackRate = mouseLongPressCurrentRate;
                        mouseUpdateRateDisplay(mouseLongPressCurrentRate);
                    }
                }, LONG_PRESS_DELAY);
            });

            container.addEventListener('mousemove', (e) => {
                if (!isMouseDown || state.isLocked) return;

                const mp = toUserXY(e.clientX, e.clientY);
                const dx = mp.x - mouseStartX;
                const dy = mp.y - mouseStartY;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);

                if (mouseGesturePhase === 'waiting') {
                    if (absDx > SWIPE_THRESHOLD && absDx > absDy * 1.5) {
                        if (mouseLongPressTimer) {
                            clearTimeout(mouseLongPressTimer);
                            mouseLongPressTimer = null;
                        }
                        mouseGesturePhase = 'swiping';
                        showSeekPreview(0);
                    } else if (absDy > MOVE_THRESHOLD) {
                        if (mouseLongPressTimer) {
                            clearTimeout(mouseLongPressTimer);
                            mouseLongPressTimer = null;
                        }
                        mouseGesturePhase = 'idle';
                    }
                }

                if (mouseGesturePhase === 'swiping') {
                    const width = getContainerWidth();
                    const secondsPerPixel = (video.duration || 0) / (width * 2);
                    const deltaSeconds = dx * secondsPerPixel;
                    const newTime = clamp(mouseSeekStartPos + deltaSeconds, 0, video.duration || 0);
                    video.currentTime = newTime;
                    showSeekPreview(deltaSeconds);
                }

                if (mouseGesturePhase === 'long-press') {
                    const deltaX = mp.x - mouseLongPressStartX;
                    mouseAdjustRate(deltaX);
                }
            });

            container.addEventListener('mouseup', (e) => {
                if (state.isLocked) return;
                if (!isMouseDown) return;
                isMouseDown = false;

                if (mouseLongPressTimer) {
                    clearTimeout(mouseLongPressTimer);
                    mouseLongPressTimer = null;
                }

                if (mouseIsLongPress) {
                    mouseIsLongPress = false;
                    if (mouseOriginalRate !== null) {
                        video.playbackRate = mouseOriginalRate;
                        mouseOriginalRate = null;
                    }
                    const indicator = container.querySelector('.vt-longpress-indicator');
                    if (indicator) indicator.style.display = 'none';
                    mouseGesturePhase = 'idle';
                    return;
                }

                if (mouseGesturePhase === 'swiping') {
                    hideSeekPreview();
                    mouseGesturePhase = 'idle';
                    return;
                }

                const endTime = Date.now();
                const duration = endTime - mouseStartTime;
                const mp = toUserXY(e.clientX, e.clientY);
                const dx = mp.x - mouseStartX;
                const dy = mp.y - mouseStartY;

                if (mouseGesturePhase === 'waiting' &&
                    duration < LONG_PRESS_DELAY &&
                    Math.abs(dx) < MOVE_THRESHOLD &&
                    Math.abs(dy) < MOVE_THRESHOLD) {

                    const now = endTime;
                    const dblDx = Math.abs(mp.x - mouseLastTapX);
                    const dblDy = Math.abs(mp.y - mouseLastTapY);

                    if (now - mouseLastTapTime < TAP_DELAY && dblDx < 50 && dblDy < 50) {
                        mouseLastTapTime = 0;
                        const width = getContainerWidth();
                        const relX = mp.x - container.getBoundingClientRect().left;

                        if (relX < width / 3) {
                            this.seek(video, -CONFIG.doubleTapSeek);
                            this.showSeekIndicator(-CONFIG.doubleTapSeek);
                        } else if (relX > width * 2 / 3) {
                            this.seek(video, CONFIG.doubleTapSeek);
                            this.showSeekIndicator(CONFIG.doubleTapSeek);
                        } else {
                            this.togglePlay(video);
                        }
                    } else {
                        mouseLastTapTime = now;
                        mouseLastTapX = mp.x;
                        mouseLastTapY = mp.y;

                        mouseSingleTapTimer = setTimeout(() => {
                            mouseSingleTapTimer = null;
                            this.toggleControls();
                        }, TAP_DELAY);
                    }
                }

                mouseGesturePhase = 'idle';
            });

            container.addEventListener('mouseleave', () => {
                if (!isMouseDown) return;
                isMouseDown = false;
                if (mouseLongPressTimer) {
                    clearTimeout(mouseLongPressTimer);
                    mouseLongPressTimer = null;
                }
                if (mouseIsLongPress) {
                    mouseIsLongPress = false;
                    if (mouseOriginalRate !== null) {
                        video.playbackRate = mouseOriginalRate;
                        mouseOriginalRate = null;
                    }
                    const indicator = container.querySelector('.vt-longpress-indicator');
                    if (indicator) indicator.style.display = 'none';
                }
                hideSeekPreview();
                mouseGesturePhase = 'idle';
            });
        },

        startLongPress(video, direction) {
            if (state.isLongPressing) return;
            state.isLongPressing = true;
            state.longPressDirection = direction;

            // 保存原速度
            state.originalRate = video.playbackRate;

            // 确保视频在播放
            if (video.paused) {
                video.play().catch(() => { });
            }

            // 使用 playbackRate 实现 3 倍速快进
            video.playbackRate = CONFIG.longPressSpeed;
            this.showLongPressIndicator(CONFIG.longPressSpeed + 'x 快进');
        },

        endLongPress(video) {
            state.isLongPressing = false;

            // 恢复原速度
            if (state.originalRate !== undefined) {
                video.playbackRate = state.originalRate;
                state.originalRate = undefined;
            }

            this.hideLongPressIndicator();
        },

        cancelLongPress() {
            if (state.longPressTimer) {
                clearTimeout(state.longPressTimer);
                state.longPressTimer = null;
            }
            if (state.isLongPressing && state.currentVideo) {
                this.endLongPress(state.currentVideo);
            }
        },

        showLongPressIndicator(text) {
            let indicator = state.takeoverContainer.querySelector('.vt-longpress-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'vt-longpress-indicator';
                state.takeoverContainer.appendChild(indicator);
            }
            indicator.textContent = text;
            indicator.style.display = 'flex';
        },

        hideLongPressIndicator() {
            const indicator = state.takeoverContainer.querySelector('.vt-longpress-indicator');
            if (indicator) {
                indicator.style.display = 'none';
            }
        },

        showSeekIndicator(seconds) {
            let indicator = state.takeoverContainer.querySelector('.vt-seek-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'vt-seek-indicator';
                state.takeoverContainer.appendChild(indicator);
            }
            indicator.textContent = (seconds > 0 ? '+' : '') + seconds + 's';
            indicator.style.display = 'block';
            indicator.classList.remove('vt-seek-anim');
            // 触发重排
            void indicator.offsetWidth;
            indicator.classList.add('vt-seek-anim');

            setTimeout(() => {
                indicator.style.display = 'none';
            }, 800);
        },

        handleBottomAction(action, btn, video) {
            switch (action) {
                case 'screen-mode':
                    this.cycleScreenMode(video, btn);
                    break;
                case 'subtitle':
                    SubtitleManager.togglePanel();
                    break;
                case 'speed':
                    this.toggleSpeedMenu();
                    break;
                case 'reload':
                    // 长按触发了模式切换的话，短按不执行
                    if (btn.dataset.longPressed === '1') {
                        delete btn.dataset.longPressed;
                        break;
                    }
                    this.reapplyMode(video);
                    break;
                case 'lock':
                    this.toggleLock();
                    break;
                case 'rotate':
                    this.toggleOrientation();
                    break;
            }
            this.resetAutoHide();
        },

        cycleScreenMode(video, btn) {
            const modes = ['fit', 'crop', 'stretch'];
            const labels = ['适应', '裁剪', '拉伸'];
            const currentIndex = modes.indexOf(state.fullscreenMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            state.fullscreenMode = modes[nextIndex];

            const label = btn.querySelector('.vt-btn-label');
            label.textContent = labels[nextIndex];

            switch (state.fullscreenMode) {
                case 'fit':
                    video.style.objectFit = 'contain';
                    break;
                case 'crop':
                    video.style.objectFit = 'cover';
                    break;
                case 'stretch':
                    video.style.objectFit = 'fill';
                    break;
            }
        },

        downloadVideo(video) {
            try {
                const src = video.currentSrc || video.src;
                if (!src) {
                    this.showToast('未找到视频地址');
                    return;
                }
                const a = document.createElement('a');
                a.href = src;
                a.download = 'video.mp4';
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                a.remove();
                this.showToast('开始下载...');
            } catch (e) {
                this.showToast('下载失败：可能因跨域限制');
            }
        },

        toggleSpeedMenu() {
            const menu = state.takeoverContainer.querySelector('.vt-speed-menu');
            menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
        },

        // 重新应用当前模式（短按重载按钮触发）
        reapplyMode(video) {
            const container = state.takeoverContainer;
            if (!container) return;

            const label = container.querySelector('.vt-rotate-btn .vt-btn-label');

            if (state.rotationMode === 'native') {
                // 原生模式：重新进入原生全屏 + 横屏锁定
                state.useCssRotation = false;
                container.classList.remove('vt-css-landscape');
                container.classList.remove('vt-portrait-css');
                state.orientation = 'landscape';
                if (container.requestFullscreen) {
                    container.requestFullscreen().then(() => {
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock('landscape').catch(() => {});
                        }
                    }).catch(() => {});
                }
                if (label) label.textContent = '竖屏';
            } else {
                // CSS 模式：重新应用 CSS 横屏样式
                state.orientation = 'landscape';
                state.useCssRotation = true;
                container.classList.remove('vt-portrait-css');
                container.classList.add('vt-css-landscape');
                if (label) label.textContent = '竖屏';
            }

            // 强制 video 铺满容器
            if (video) {
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.maxWidth = 'none';
                video.style.maxHeight = 'none';
            }

            this.showToast('已重新载入');
        },

        toggleLock() {
            state.isLocked = !state.isLocked;
            const container = state.takeoverContainer;
            const lockBtn = container.querySelector('.vt-lock-btn');
            const iconUnlock = lockBtn.querySelector('.vt-icon-unlock');
            const iconLock = lockBtn.querySelector('.vt-icon-lock');
            const label = lockBtn.querySelector('.vt-btn-label');

            if (state.isLocked) {
                // 切换为锁定图标
                iconUnlock.style.display = 'none';
                iconLock.style.display = 'block';
                label.textContent = '锁定';
                // 给容器添加锁定状态类
                container.classList.add('vt-locked');
                // 隐藏所有控制栏，但保留锁定按钮
                this.hideAllControlsButLock();
                this.showToast('屏幕已锁定');
            } else {
                // 切换为解锁图标
                iconUnlock.style.display = 'block';
                iconLock.style.display = 'none';
                label.textContent = '锁定';
                // 移除锁定状态类
                container.classList.remove('vt-locked');
                // 显示所有控制栏
                this.showControls();
                this.resetAutoHide();
                this.showToast('屏幕已解锁');
            }
        },

        toggleOrientation() {
            const container = state.takeoverContainer;
            if (!container) return;

            const rotateBtn = container.querySelector('.vt-rotate-btn');
            const label = rotateBtn.querySelector('.vt-btn-label');
            const target = state.orientation === 'landscape' ? 'portrait' : 'landscape';

            if (state.rotationMode === 'css') {
                // CSS模式：通过 CSS class 切换横竖屏
                if (target === 'portrait') {
                    state.orientation = 'portrait';
                    state.useCssRotation = false;
                    container.classList.remove('vt-css-landscape');
                    label.textContent = '横屏';
                    this.showToast('已切换竖屏');
                } else {
                    state.orientation = 'landscape';
                    state.useCssRotation = true;
                    container.classList.add('vt-css-landscape');
                    label.textContent = '竖屏';
                    this.showToast('已切换横屏');
                }
                return;
            }

            // 原生模式：优先使用原生屏幕方向 API
            if (screen.orientation && screen.orientation.lock && document.fullscreenElement) {
                screen.orientation.lock(target).then(() => {
                    state.orientation = target;
                    state.useCssRotation = false;
                    container.classList.remove('vt-portrait-css');
                    label.textContent = target === 'landscape' ? '竖屏' : '横屏';
                }).catch(() => {
                    // 原生API失败，使用CSS旋转回退
                    this.toggleCssOrientation();
                });
            } else {
                // 不支持原生API，直接用CSS旋转
                this.toggleCssOrientation();
            }
        },

        toggleCssOrientation() {
            const container = state.takeoverContainer;
            if (!container) return;
            const rotateBtn = container.querySelector('.vt-rotate-btn');
            const label = rotateBtn.querySelector('.vt-btn-label');

            if (state.orientation === 'landscape') {
                // 切到竖屏（CSS旋转）
                state.orientation = 'portrait';
                state.useCssRotation = true;
                container.classList.add('vt-portrait-css');
                label.textContent = '横屏';
                this.showToast('已切换竖屏');
            } else {
                // 切到横屏
                state.orientation = 'landscape';
                state.useCssRotation = false;
                container.classList.remove('vt-portrait-css');
                label.textContent = '竖屏';
                this.showToast('已切换横屏');
            }
        },

        // 切换旋转模式：原生 <-> CSS（长按旋转按钮触发）
        switchRotationMode() {
            const container = state.takeoverContainer;
            if (!container) return;

            const label = container.querySelector('.vt-rotate-btn .vt-btn-label');

            if (state.rotationMode === 'css') {
                // 切到原生模式
                state.rotationMode = 'native';
                localStorage.setItem('vt_rotate_mode', 'native');
                state.useCssRotation = false;
                container.classList.remove('vt-css-landscape');
                container.classList.remove('vt-portrait-css');
                // 重新进入原生全屏 + 横屏
                state.orientation = 'landscape';
                if (container.requestFullscreen) {
                    container.requestFullscreen().then(() => {
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock('landscape').catch(() => {});
                        }
                    }).catch(() => {});
                }
                label.textContent = '竖屏';
                this.showToast('原生模式');
            } else {
                // 切到CSS模式：先退出原生全屏，再用CSS旋转模拟横屏
                state.rotationMode = 'css';
                localStorage.setItem('vt_rotate_mode', 'css');

                const applyCss = () => {
                    state.orientation = 'landscape';
                    state.useCssRotation = true;
                    container.classList.remove('vt-portrait-css');
                    container.classList.add('vt-css-landscape');
                    label.textContent = '竖屏';
                };

                if (screen.orientation && screen.orientation.unlock) {
                    screen.orientation.unlock();
                }
                if (document.fullscreenElement) {
                    document.exitFullscreen().then(applyCss).catch(applyCss);
                } else {
                    applyCss();
                }
                this.showToast('CSS模式');
            }
        },

        hideAllControlsButLock() {
            const container = state.takeoverContainer;
            state.controlsVisible = false;

            // 隐藏顶部栏
            const topBar = container.querySelector('.vt-takeover-top-bar');
            topBar.style.opacity = '0';
            topBar.style.pointerEvents = 'none';

            // 隐藏中央控制
            const centerControls = container.querySelector('.vt-takeover-center-controls');
            centerControls.style.opacity = '0';
            centerControls.style.pointerEvents = 'none';

            // 隐藏进度条
            const progress = container.querySelector('.vt-takeover-progress');
            progress.style.opacity = '0';
            progress.style.pointerEvents = 'none';

            // 隐藏底部除了锁定按钮外的所有按钮
            const bottomBtns = container.querySelectorAll('.vt-bottom-btn:not(.vt-lock-btn)');
            bottomBtns.forEach((btn) => {
                btn.style.opacity = '0';
                btn.style.pointerEvents = 'none';
            });

            // 隐藏倍速菜单
            container.querySelector('.vt-speed-menu').style.display = 'none';

            // 隐藏字幕面板
            const subPanel = container.querySelector('.vt-sub-panel');
            if (subPanel) {
                subPanel.classList.remove('vt-sub-panel-open');
                SubtitleManager.state.panelOpen = false;
            }

            // 清除自动隐藏定时器
            if (state.autoHideTimer) {
                clearTimeout(state.autoHideTimer);
                state.autoHideTimer = null;
            }
        },

        togglePlay(video) {
            if (video.paused) {
                state.userPaused = false;
                video.play().catch(() => { });
            } else {
                state.userPaused = true;
                video.pause();
            }
        },

        seek(video, seconds) {
            if (!video.duration) return;
            video.currentTime = clamp(video.currentTime + seconds, 0, video.duration);
        },

        toggleControls() {
            if (state.controlsVisible) {
                this.hideControls();
            } else {
                this.showControls();
                this.resetAutoHide();
            }
        },

        showControls() {
            state.controlsVisible = true;
            const container = state.takeoverContainer;
            container.querySelector('.vt-takeover-top-bar').style.opacity = '1';
            container.querySelector('.vt-takeover-top-bar').style.pointerEvents = 'auto';
            container.querySelector('.vt-takeover-center-controls').style.opacity = '1';
            container.querySelector('.vt-takeover-center-controls').style.pointerEvents = 'auto';
            container.querySelector('.vt-takeover-progress').style.opacity = '1';
            container.querySelector('.vt-takeover-progress').style.pointerEvents = 'auto';
            container.querySelector('.vt-takeover-bottom-bar').style.opacity = '1';
            container.querySelector('.vt-takeover-bottom-bar').style.pointerEvents = 'auto';
            // 恢复所有底部按钮
            const bottomBtns = container.querySelectorAll('.vt-bottom-btn');
            bottomBtns.forEach((btn) => {
                btn.style.opacity = '';
                btn.style.pointerEvents = '';
            });
        },

        hideControls() {
            if (state.isLocked) return; // 锁定状态下由锁定层控制
            if (SubtitleManager.state.panelOpen) return; // 字幕面板打开时不隐藏
            state.controlsVisible = false;
            const container = state.takeoverContainer;
            container.querySelector('.vt-takeover-top-bar').style.opacity = '0';
            container.querySelector('.vt-takeover-top-bar').style.pointerEvents = 'none';
            container.querySelector('.vt-takeover-center-controls').style.opacity = '0';
            container.querySelector('.vt-takeover-center-controls').style.pointerEvents = 'none';
            container.querySelector('.vt-takeover-progress').style.opacity = '0';
            container.querySelector('.vt-takeover-progress').style.pointerEvents = 'none';
            container.querySelector('.vt-takeover-bottom-bar').style.opacity = '0';
            container.querySelector('.vt-takeover-bottom-bar').style.pointerEvents = 'none';
            // 隐藏倍速菜单
            container.querySelector('.vt-speed-menu').style.display = 'none';
            // 隐藏字幕面板
            SubtitleManager.closePanel();
        },

        resetAutoHide() {
            // 字幕面板打开时不自动隐藏
            if (SubtitleManager.state.panelOpen) return;

            if (state.autoHideTimer) {
                clearTimeout(state.autoHideTimer);
            }
            state.autoHideTimer = setTimeout(() => {
                if (!state.isLocked) {
                    this.hideControls();
                }
            }, CONFIG.controlsAutoHideDelay);
        },

        cancelAutoHide() {
            if (state.autoHideTimer) {
                clearTimeout(state.autoHideTimer);
                state.autoHideTimer = null;
            }
        },

        requestFullscreenAndLandscape(container) {
            // 读取上次选择的模式，默认原生
            state.rotationMode = localStorage.getItem('vt_rotate_mode') || 'native';
            state.orientation = 'landscape';

            if (state.rotationMode === 'css') {
                // CSS模式：不调用原生全屏，直接用CSS旋转模拟横屏
                state.useCssRotation = true;
                container.classList.add('vt-css-landscape');
                return;
            }

            // 原生模式（默认）：请求原生全屏 + 横屏方向锁
            state.useCssRotation = false;
            if (container.requestFullscreen) {
                container.requestFullscreen().catch(() => {
                    // 全屏失败也没关系，继续播放
                });
            } else if (container.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            }

            if (screen.orientation && screen.orientation.lock) {
                const tryLock = () => {
                    screen.orientation.lock('landscape').catch(() => {
                        // 某些浏览器不支持方向锁定，忽略即可
                    });
                };
                if (document.fullscreenElement) {
                    tryLock();
                } else {
                    setTimeout(tryLock, 500);
                }
            }
        },

        addVideoListeners(video) {
            video.addEventListener('play', this._onPlay = () => this.updatePlayState(video));
            video.addEventListener('pause', this._onPause = () => this.updatePlayState(video));
            video.addEventListener('timeupdate', this._onTimeUpdate = () => this.updateTime(video));
            video.addEventListener('loadedmetadata', this._onLoaded = () => this.updateTime(video));
            video.addEventListener('ratechange', this._onRateChange = () => this.updateSpeedLabel(video));
            video.addEventListener('ended', this._onEnded = () => this.updatePlayState(video));
            video.addEventListener('progress', this._onProgress = () => this.updateBuffered(video));
        },

        removeVideoListeners(video) {
            video.removeEventListener('play', this._onPlay);
            video.removeEventListener('pause', this._onPause);
            video.removeEventListener('timeupdate', this._onTimeUpdate);
            video.removeEventListener('loadedmetadata', this._onLoaded);
            video.removeEventListener('ratechange', this._onRateChange);
            video.removeEventListener('ended', this._onEnded);
            video.removeEventListener('progress', this._onProgress);
        },

        updatePlayState(video) {
            const container = state.takeoverContainer;
            if (!container) return;
            const playIcon = container.querySelector('.vt-icon-play');
            const pauseIcon = container.querySelector('.vt-icon-pause');
            if (video.paused) {
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
            } else {
                playIcon.style.display = 'none';
                pauseIcon.style.display = 'block';
            }
        },

        updateTime(video) {
            const container = state.takeoverContainer;
            if (!container) return;
            const currentEl = container.querySelector('.vt-current-time');
            const durationEl = container.querySelector('.vt-duration');
            const playedEl = container.querySelector('.vt-progress-played');
            const thumbEl = container.querySelector('.vt-progress-thumb');

            currentEl.textContent = formatTime(video.currentTime);
            durationEl.textContent = formatTime(video.duration || 0);

            if (video.duration) {
                const percent = (video.currentTime / video.duration) * 100;
                playedEl.style.width = percent + '%';
                thumbEl.style.left = percent + '%';
            }
        },

        updateBuffered(video) {
            const container = state.takeoverContainer;
            if (!container) return;
            const bufferedEl = container.querySelector('.vt-progress-buffered');
            if (video.buffered && video.buffered.length > 0 && video.duration) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const percent = (bufferedEnd / video.duration) * 100;
                bufferedEl.style.width = percent + '%';
            }
        },

        updateSpeedLabel(video) {
            const container = state.takeoverContainer;
            if (!container) return;
            const speedBtn = container.querySelector('[data-action="speed"] .vt-btn-label');
            speedBtn.textContent = video.playbackRate + 'x';
        },

        showToast(message) {
            FloatingButtons.showToast(message);
        },
    };

    // ==================== 网络请求工具（绕过CORS） ====================
    const NetUtil = {
        // 带GM_xmlhttpRequest的GET请求，自动绕过CORS
        async getText(url) {
            // 优先使用GM_xmlhttpRequest（不受CORS限制）
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        onload: (response) => {
                            if (response.status >= 200 && response.status < 300) {
                                resolve(response.responseText);
                            } else {
                                reject(new Error('HTTP ' + response.status));
                            }
                        },
                        onerror: (err) => reject(new Error(err.error || '网络错误')),
                        ontimeout: () => reject(new Error('请求超时')),
                        timeout: 15000,
                    });
                });
            }
            // 降级使用fetch（可能受CORS限制）
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return await resp.text();
        },

        async getJSON(url) {
            const text = await this.getText(url);
            return JSON.parse(text);
        },

        async getBuffer(url) {
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        responseType: 'arraybuffer',
                        onload: (response) => {
                            if (response.status >= 200 && response.status < 300) {
                                resolve(response.response);
                            } else {
                                reject(new Error('HTTP ' + response.status));
                            }
                        },
                        onerror: (err) => reject(new Error(err.error || '网络错误')),
                        ontimeout: () => reject(new Error('请求超时')),
                        timeout: 15000,
                    });
                });
            }
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return await resp.arrayBuffer();
        },
    };

    // ==================== 字幕管理器 ====================
    const SubtitleManager = {
        // 字幕状态
        state: {
            cues: [],
            offset: 0,
            cursor: 0,
            lastCue: null,
            name: '',
            raw: '',
            visible: true,
            fontSize: 22,
            posPercent: 12,
            rafId: 0,
            panelOpen: false,
            // 字幕配置
            config: {
                fontSize: 22,
                posPercent: 12,
                color: '#ffffff',
                outline: 2,
                opacity: 1,
                offset: 0,
                assrtToken: '',
            },
        },

        // 字幕元素
        subEl: null,

        init() {
            // 从本地存储加载配置
            try {
                const saved = localStorage.getItem('vt_sub_config');
                if (saved) {
                    Object.assign(this.state.config, JSON.parse(saved));
                    this.state.fontSize = this.state.config.fontSize;
                    this.state.posPercent = this.state.config.posPercent;
                    this.state.offset = this.state.config.offset;
                }
            } catch (e) { }
        },

        saveConfig() {
            try {
                localStorage.setItem('vt_sub_config', JSON.stringify(this.state.config));
            } catch (e) { }
        },

        // ========== 编码检测 ==========
        decodeBuffer(buf) {
            const u8 = new Uint8Array(buf);
            // BOM检测
            if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
                return new TextDecoder('utf-8').decode(u8.slice(3));
            }
            if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
                return new TextDecoder('utf-16le').decode(u8.slice(2));
            }
            if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
                return new TextDecoder('utf-16be').decode(u8.slice(2));
            }
            // UTF-8严格模式
            try {
                return new TextDecoder('utf-8', { fatal: true }).decode(u8);
            } catch (e) { }
            // 候选编码尝试
            const candidates = ['gb18030', 'big5', 'shift_jis', 'euc-kr'];
            for (const enc of candidates) {
                try {
                    const text = new TextDecoder(enc).decode(u8);
                    if (text.indexOf('\uFFFD') < 0) return text;
                } catch (e) { }
            }
            // 兜底
            return new TextDecoder('utf-8').decode(u8);
        },

        // ========== 时间解析 ==========
        parseTimeSrt(s) {
            const parts = String(s).trim().split(/[,.]/);
            const hms = parts[0].split(':');
            const ms = parts[1] ? parseInt(parts[1].padEnd(3, '0').slice(0, 3), 10) : 0;
            const hh = parseInt(hms[0], 10) || 0;
            const mm = parseInt(hms[1], 10) || 0;
            const ss = parseInt(hms[2], 10) || 0;
            const v = hh * 3600 + mm * 60 + ss + ms / 1000;
            return isNaN(v) ? NaN : v;
        },

        parseTimeAss(s) {
            const t = String(s).trim().split(/[,.]/);
            const hms = t[0].split(':');
            const cs = t[1] ? parseInt(t[1].padEnd(2, '0').slice(0, 2), 10) : 0;
            return (parseInt(hms[0], 10) || 0) * 3600
                + (parseInt(hms[1], 10) || 0) * 60
                + (parseInt(hms[2], 10) || 0)
                + cs / 100;
        },

        // ========== 字幕解析 ==========
        parseSRT(text) {
            const cues = [];
            const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\n+/);
            for (const block of blocks) {
                const lines = block.trim().split('\n').filter(l => l.trim());
                if (lines.length < 2) continue;
                // 找到时间轴行
                let timeLineIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].indexOf('-->') >= 0) {
                        timeLineIdx = i;
                        break;
                    }
                }
                if (timeLineIdx < 0) continue;
                const timeParts = lines[timeLineIdx].split('-->').map(s => s.trim());
                const start = this.parseTimeSrt(timeParts[0]);
                const end = this.parseTimeSrt(timeParts[1].split(' ')[0]);
                if (isNaN(start) || isNaN(end)) continue;
                const textLines = lines.slice(timeLineIdx + 1);
                const cueText = textLines.join('\n').trim();
                if (cueText) {
                    cues.push({ s: start, e: end, text: cueText });
                }
            }
            return cues;
        },

        parseVTT(text) {
            const cues = [];
            const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            let i = 0;
            // 跳过头部
            while (i < lines.length && lines[i].indexOf('-->') < 0) i++;
            while (i < lines.length) {
                const line = lines[i];
                if (line.indexOf('-->') >= 0) {
                    const parts = line.split('-->').map(s => s.trim());
                    const start = this.parseTimeSrt(parts[0]);
                    const end = this.parseTimeSrt(parts[1].split(' ')[0]);
                    if (!isNaN(start) && !isNaN(end)) {
                        i++;
                        const textLines = [];
                        while (i < lines.length && lines[i].trim() !== '') {
                            textLines.push(lines[i]);
                            i++;
                        }
                        const cueText = textLines.join('\n').trim();
                        if (cueText) {
                            cues.push({ s: start, e: end, text: cueText });
                        }
                    }
                }
                i++;
            }
            return cues;
        },

        parseASS(text) {
            const cues = [];
            const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            let inEvents = false;
            let formatFields = [];
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.toLowerCase() === '[events]') {
                    inEvents = true;
                    continue;
                }
                if (inEvents) {
                    if (trimmed.startsWith('[')) break;
                    if (trimmed.toLowerCase().startsWith('format:')) {
                        formatFields = trimmed.substring(7).split(',').map(s => s.trim().toLowerCase());
                        continue;
                    }
                    if (trimmed.toLowerCase().startsWith('dialogue:')) {
                        const content = trimmed.substring(9);
                        const values = content.split(',');
                        if (formatFields.length === 0) continue;
                        // 找到 start, end, text 字段
                        let start = 0, end = 0, text = '';
                        let textIdx = formatFields.indexOf('text');
                        if (textIdx < 0) textIdx = formatFields.length - 1;
                        for (let i = 0; i < formatFields.length; i++) {
                            const field = formatFields[i];
                            let value = '';
                            if (i === textIdx) {
                                // text 字段可能包含逗号，取剩余所有
                                value = values.slice(i).join(',').trim();
                            } else {
                                value = (values[i] || '').trim();
                            }
                            if (field === 'start') start = this.parseTimeAss(value);
                            else if (field === 'end') end = this.parseTimeAss(value);
                            else if (field === 'text') text = value;
                        }
                        if (start >= 0 && end > start && text) {
                            // 清理ASS标签
                            let cleanText = text
                                .replace(/\{[^}]*\}/g, '')
                                .replace(/\\N/g, '\n')
                                .replace(/\\n/g, '\n')
                                .replace(/\\h/g, ' ')
                                .trim();
                            if (cleanText) {
                                cues.push({ s: start, e: end, text: cleanText });
                            }
                        }
                    }
                }
            }
            return cues;
        },

        parseMicroDVD(text) {
            const cues = [];
            const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            const fps = 25; // 假设25fps
            const re = /^\{(\d+)\}\{(\d+)\}(.*)$/;
            for (const line of lines) {
                const m = line.match(re);
                if (m) {
                    const start = parseInt(m[1], 10) / fps;
                    const end = parseInt(m[2], 10) / fps;
                    const cueText = m[3].replace(/\|/g, '\n').trim();
                    if (cueText) {
                        cues.push({ s: start, e: end, text: cueText });
                    }
                }
            }
            return cues;
        },

        parseSubtitles(text) {
            const head = text.slice(0, 2000);
            let cues = [];
            if (head.indexOf('[Script Info]') >= 0 || head.indexOf('Dialogue:') >= 0)
                cues = this.parseASS(text);
            else if (head.indexOf('WEBVTT') >= 0)
                cues = this.parseVTT(text);
            else if (/^\{\d+\}\{\d+\}/m.test(text))
                cues = this.parseMicroDVD(text);
            else
                cues = this.parseSRT(text);

            if (!cues.length) cues = this.parseSRT(text);
            cues.sort((a, b) => a.s - b.s);
            return cues;
        },

        // ========== 字幕查找 ==========
        findCue(t) {
            const c = this.state.cues;
            const off = this.state.offset;
            const n = c.length;
            if (!n) return null;
            let i = this.state.cursor;
            if (i >= n) i = n - 1;
            // 向前查找
            if (c[i].e + off < t) {
                let steps = 0;
                while (i < n - 1 && c[i].e + off < t) {
                    i++;
                    steps++;
                    if (steps > 60) {
                        // 回退到二分查找
                        let lo = 0, hi = n - 1;
                        while (lo < hi) {
                            const mid = (lo + hi) >> 1;
                            if (c[mid].e + off < t) lo = mid + 1;
                            else hi = mid;
                        }
                        i = lo;
                        break;
                    }
                }
            }
            // 向后查找
            else if (c[i].s + off > t) {
                let steps = 0;
                while (i > 0 && c[i].s + off > t) {
                    i--;
                    steps++;
                    if (steps > 60) {
                        let lo = 0, hi = n - 1;
                        while (lo < hi) {
                            const mid = (lo + hi) >> 1;
                            if (c[mid].e + off < t) lo = mid + 1;
                            else hi = mid;
                        }
                        i = lo;
                        break;
                    }
                }
            }
            this.state.cursor = i;
            if (c[i].s + off <= t && c[i].e + off >= t) return c[i];
            return null;
        },

        // ========== 渲染 ==========
        ensureSubtitleEl() {
            if (this.subEl && this.subEl.isConnected) return this.subEl;
            const container = state.takeoverContainer;
            if (!container) return null;
            const wrapper = container.querySelector('.vt-takeover-video-wrapper');
            if (!wrapper) return null;

            const el = document.createElement('div');
            el.className = 'vt-subtitle-text';
            wrapper.appendChild(el);
            this.subEl = el;
            this.applySubStyle();
            return el;
        },

        applySubStyle() {
            if (!this.subEl) return;
            const cfg = this.state.config;
            const s = this.subEl.style;
            s.fontSize = cfg.fontSize + 'px';
            s.color = cfg.color;
            s.opacity = String(cfg.opacity);
            s.textShadow = `0 0 ${cfg.outline}px #000, 0 0 ${cfg.outline * 2}px rgba(0,0,0,.85), 2px 2px 5px rgba(0,0,0,.9)`;
            s.bottom = Math.max(0, Math.min(90, cfg.posPercent)) + '%';
        },

        showCue(cue) {
            const el = this.ensureSubtitleEl();
            if (!el) return;
            const txt = (cue && this.state.visible) ? cue.text : '';
            if (el.textContent !== txt) el.textContent = txt;
            el.style.display = txt ? 'block' : 'none';
        },

        renderLoop() {
            const tick = () => {
                this.state.rafId = requestAnimationFrame(tick);
                if (document.hidden) return;
                const video = state.currentVideo;
                if (!video || !this.state.cues.length) return;
                const t = video.currentTime;
                const cue = this.findCue(t);
                if (cue !== this.state.lastCue) {
                    this.state.lastCue = cue;
                    this.showCue(cue);
                }
            };
            this.state.rafId = requestAnimationFrame(tick);
        },

        stopRenderLoop() {
            if (this.state.rafId) {
                cancelAnimationFrame(this.state.rafId);
                this.state.rafId = 0;
            }
        },

        // ========== 加载字幕 ==========
        setSubtitle(text, name, silent) {
            try {
                const cues = this.parseSubtitles(text);
                if (!cues.length) throw new Error('未解析到有效条目');
                this.state.cues = cues;
                this.state.cursor = 0;
                this.state.lastCue = null;
                this.state.raw = text;
                this.state.name = name || 'subtitle';
                this.state.visible = true;

                if (this.subEl) {
                    this.subEl.style.display = 'block';
                    this.applySubStyle();
                }

                // 启动渲染循环
                if (!this.state.rafId) {
                    this.renderLoop();
                }

                if (!silent) {
                    TakeoverPlayer.showToast('字幕加载成功（' + cues.length + ' 条）');
                }
                return true;
            } catch (e) {
                TakeoverPlayer.showToast('字幕加载失败：' + e.message);
                return false;
            }
        },

        clearSubtitle() {
            this.state.cues = [];
            this.state.cursor = 0;
            this.state.lastCue = null;
            this.state.raw = '';
            this.state.name = '';
            this.state.offset = 0;
            if (this.subEl) {
                this.subEl.textContent = '';
                this.subEl.style.display = 'none';
            }
            this.stopRenderLoop();
            TakeoverPlayer.showToast('字幕已清除');
        },

        toggleVisible() {
            this.state.visible = !this.state.visible;
            if (!this.state.visible && this.subEl) {
                this.subEl.style.display = 'none';
            } else if (this.state.cues.length && this.subEl) {
                this.showCue(this.state.lastCue);
            }
            TakeoverPlayer.showToast(this.state.visible ? '字幕已显示' : '字幕已隐藏');
        },

        setOffset(seconds) {
            this.state.offset = seconds;
            this.state.config.offset = seconds;
            this.saveConfig();
            this.state.cursor = 0;
            this.state.lastCue = null;
        },

        adjustOffset(delta) {
            this.setOffset(this.state.offset + delta);
            TakeoverPlayer.showToast('字幕偏移：' + (this.state.offset > 0 ? '+' : '') + this.state.offset.toFixed(1) + 's');
        },

        // ========== 本地字幕加载 ==========
        loadLocalFile() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.srt,.vtt,.ass,.ssa,.sub';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.onchange = async (e) => {
                const f = e.target.files && e.target.files[0];
                input.remove();
                if (!f) return;
                try {
                    const buf = await f.arrayBuffer();
                    const text = this.decodeBuffer(buf);
                    const name = f.name.replace(/\.(srt|ass|ssa|vtt|sub)$/i, '');
                    if (this.setSubtitle(text, name)) {
                        this.updatePanelSubtitleInfo();
                    }
                } catch (err) {
                    TakeoverPlayer.showToast('读取失败：' + err.message);
                }
            };
            input.click();
        },

        // ========== 在线搜索 ==========
        async searchSubtitles(keyword) {
            if (!keyword) return [];
            const sources = ['xunlei', 'subtitlecat'];
            const tasks = sources.map(src => this.searchSource(src, keyword).catch(() => []));
            const results = await Promise.all(tasks);
            let merged = [];
            results.forEach(arr => arr.forEach(x => merged.push(x)));
            // 按相似度排序
            merged.sort((a, b) => (this.similarity(keyword, b.name || '') - this.similarity(keyword, a.name || '')));
            return merged;
        },

        similarity(a, b) {
            const sa = new Set(String(a || '').toUpperCase().replace(/[^A-Z0-9]/g, '').split(''));
            const sb = new Set(String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '').split(''));
            if (!sa.size || !sb.size) return 0;
            let inter = 0;
            sa.forEach(c => { if (sb.has(c)) inter++; });
            return inter / (sa.size + sb.size - inter);
        },

        async searchSource(src, keyword) {
            if (src === 'xunlei') {
                return this.searchXunlei(keyword);
            } else if (src === 'subtitlecat') {
                return this.searchSubtitlecat(keyword);
            }
            return [];
        },

        async searchXunlei(keyword) {
            const url = 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(keyword);
            try {
                const data = await NetUtil.getJSON(url);
                const items = [];
                // 迅雷API返回 { code:0, data: [...] } 结构
                const list = data && Array.isArray(data.data) ? data.data :
                             (data && Array.isArray(data.subtitles) ? data.subtitles : []);
                for (const s of list) {
                    const srtUrl = s.url || s.srt_url || '';
                    if (/^https?:/i.test(srtUrl) && /\.(srt|ass|ssa|vtt|sub)($|\?)/i.test(srtUrl)) {
                        items.push({
                            name: s.name || s.title || s.extra_name || '未知',
                            extra: (s.languages && s.languages.join('/')) || s.ext || '',
                            url: srtUrl,
                            source: 'xunlei',
                        });
                    }
                }
                return items;
            } catch (e) {
                console.warn('迅雷字幕搜索失败:', e);
                return [];
            }
        },

        async searchSubtitlecat(keyword) {
            const url = 'https://www.subtitlecat.com/index.php?search=' + encodeURIComponent(keyword);
            try {
                const html = await NetUtil.getText(url);
                const items = [];
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                // 查找所有字幕详情链接
                const links = doc.querySelectorAll('a[href*="subs/"]');
                for (const link of links) {
                    const href = link.getAttribute('href') || '';
                    const name = link.textContent.trim();
                    // 过滤掉非字幕链接（如导航、分页等）
                    if (!name || !href || href === '#' || href.startsWith('javascript:')) continue;
                    if (name.length < 3) continue; // 太短的跳过
                    const fullUrl = href.startsWith('http') ? href : 'https://www.subtitlecat.com/' + href.replace(/^\//, '');
                    // 去重
                    if (!items.find(it => it.url === fullUrl)) {
                        items.push({
                            name: name,
                            extra: '字幕猫',
                            url: fullUrl,
                            source: 'subtitlecat',
                        });
                    }
                }
                return items.slice(0, 20);
            } catch (e) {
                console.warn('字幕猫搜索失败:', e);
                return [];
            }
        },

        async loadSubtitleItem(item) {
            try {
                let url = item.url;
                if (item.source === 'subtitlecat') {
                    // 需要从详情页解析下载链接
                    const realUrl = await this.resolveSubtitlecat(url);
                    if (!realUrl) throw new Error('未找到中文字幕下载链接');
                    url = realUrl;
                }
                const buf = await NetUtil.getBuffer(url);
                const text = this.decodeBuffer(buf);
                if (text.indexOf('-->') < 0 && text.indexOf('[Events]') < 0 && text.indexOf('WEBVTT') < 0) {
                    throw new Error('内容不是有效字幕');
                }
                if (this.setSubtitle(text, item.name)) {
                    this.updatePanelSubtitleInfo();
                }
            } catch (e) {
                TakeoverPlayer.showToast('加载失败：' + e.message);
            }
        },

        async resolveSubtitlecat(detailUrl) {
            try {
                const html = await NetUtil.getText(detailUrl);
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const links = doc.querySelectorAll('a');
                const pick = (tag) => {
                    for (const a of links) {
                        const href = a.getAttribute('href') || '';
                        const id = a.getAttribute('id') || '';
                        if (id.indexOf(tag) >= 0 || href.indexOf(tag) >= 0) {
                            const fullUrl = href.startsWith('http') ? href : 'https://www.subtitlecat.com/' + href.replace(/^\//, '');
                            return fullUrl;
                        }
                    }
                    return null;
                };
                return pick('zh-CN') || pick('zh-TW') || pick('download');
            } catch (e) {
                return null;
            }
        },

        // ========== 字幕预览 ==========
        async previewSubtitle(item) {
            const container = state.takeoverContainer;
            if (!container) return;

            // 如果已有预览弹窗，先关闭
            const existing = container.querySelector('.vt-sub-preview-modal');
            if (existing) existing.remove();

            // 创建预览弹窗
            const modal = document.createElement('div');
            modal.className = 'vt-sub-preview-modal';
            modal.innerHTML = `
                <div class="vt-sub-preview-content">
                    <div class="vt-sub-preview-header">
                        <span class="vt-sub-preview-title">字幕预览</span>
                        <button class="vt-sub-preview-close">✕</button>
                    </div>
                    <div class="vt-sub-preview-name" title="${item.name}">${item.name}</div>
                    <div class="vt-sub-preview-body">
                        <div class="vt-sub-preview-loading">正在加载字幕...</div>
                    </div>
                    <div class="vt-sub-preview-footer">
                        <button class="vt-sub-btn vt-sub-btn-secondary vt-preview-cancel">取消</button>
                        <button class="vt-sub-btn vt-sub-btn-primary vt-preview-load" disabled>加载字幕</button>
                    </div>
                </div>
            `;
            container.appendChild(modal);

            // 关闭按钮
            const closeModal = () => { modal.remove(); };
            modal.querySelector('.vt-sub-preview-close').addEventListener('click', closeModal);
            modal.querySelector('.vt-preview-cancel').addEventListener('click', closeModal);
            // 点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });

            // 加载按钮
            const loadBtn = modal.querySelector('.vt-preview-load');
            loadBtn.addEventListener('click', () => {
                TakeoverPlayer.showToast('正在加载字幕...');
                this.loadSubtitleItem(item);
                closeModal();
                this.closePanel();
            });

            try {
                // 下载并解析字幕
                let url = item.url;
                if (item.source === 'subtitlecat') {
                    const realUrl = await this.resolveSubtitlecat(url);
                    if (!realUrl) throw new Error('未找到下载链接');
                    url = realUrl;
                }

                const buf = await NetUtil.getBuffer(url);
                const text = this.decodeBuffer(buf);
                const cues = this.parseSubtitles(text);

                if (!cues.length) throw new Error('未解析到有效条目');

                // 缓存预览数据供加载按钮使用
                this._previewCues = cues;
                this._previewName = item.name;
                this._previewText = text;

                // 渲染预览列表（显示前 30 条）
                const previewBody = modal.querySelector('.vt-sub-preview-body');
                const showCount = Math.min(30, cues.length);
                previewBody.innerHTML = `
                    <div class="vt-sub-preview-count">共 ${cues.length} 条字幕，显示前 ${showCount} 条</div>
                    ${cues.slice(0, showCount).map((cue, i) => `
                        <div class="vt-sub-preview-line">
                            <span class="vt-sub-preview-time">${formatTime(cue.s)}</span>
                            <span class="vt-sub-preview-text">${cue.text.replace(/\n/g, ' / ')}</span>
                        </div>
                    `).join('')}
                    ${cues.length > showCount ? '<div class="vt-sub-preview-more">... 更多内容请加载后查看</div>' : ''}
                `;

                // 启用加载按钮
                loadBtn.disabled = false;
            } catch (e) {
                const previewBody = modal.querySelector('.vt-sub-preview-body');
                previewBody.innerHTML = `<div class="vt-sub-preview-error">预览失败：${e.message}</div>`;
            }
        },

        // 从URL提取番号/关键词
        extractKeyword() {
            try {
                const segs = location.pathname.split('/').filter(Boolean);
                const tryMatch = (s) => {
                    const m = String(s || '').match(/^([a-zA-Z]{2,8})[-_]?(\d{2,6})/i);
                    return m ? (m[1].toUpperCase() + '-' + m[2]) : '';
                };
                if (segs.length) {
                    const a = tryMatch(segs[segs.length - 1]);
                    if (a) return a;
                }
                if (segs.length >= 2) {
                    const b = tryMatch(segs[segs.length - 2]);
                    if (b) return b;
                }
                return tryMatch(location.pathname);
            } catch (e) {
                return '';
            }
        },

        // ========== 字幕面板 ==========
        togglePanel() {
            if (this.state.panelOpen) {
                this.closePanel();
            } else {
                this.openPanel();
            }
        },

        openPanel() {
            const container = state.takeoverContainer;
            if (!container) return;

            // 如果面板已存在，直接显示
            let panel = container.querySelector('.vt-sub-panel');
            if (panel) {
                panel.classList.add('vt-sub-panel-open');
                this.state.panelOpen = true;
                return;
            }

            // 创建面板
            panel = document.createElement('div');
            panel.className = 'vt-sub-panel';
            const keyword = this.extractKeyword() || document.title.slice(0, 30);
            panel.innerHTML = `
                <div class="vt-sub-panel-header">
                    <span class="vt-sub-panel-title">字幕设置</span>
                    <button class="vt-sub-panel-close">✕</button>
                </div>
                <div class="vt-sub-panel-content">
                    <!-- 当前字幕信息 -->
                    <div class="vt-sub-section">
                        <div class="vt-sub-section-title">当前字幕</div>
                        <div class="vt-sub-info">
                            <div class="vt-sub-name">未加载字幕</div>
                            <div class="vt-sub-count"></div>
                        </div>
                        <div class="vt-sub-actions">
                            <button class="vt-sub-btn vt-sub-btn-secondary" data-action="local">加载本地字幕</button>
                            <button class="vt-sub-btn vt-sub-btn-danger" data-action="clear">清除字幕</button>
                            <button class="vt-sub-btn vt-sub-btn-secondary" data-action="toggle-vis">显示/隐藏</button>
                        </div>
                    </div>
                    <!-- 在线搜索 -->
                    <div class="vt-sub-section">
                        <div class="vt-sub-section-title">在线搜索</div>
                        <div class="vt-sub-search">
                            <input type="text" class="vt-sub-search-input" placeholder="输入关键词或番号..." value="${keyword}">
                            <button class="vt-sub-btn vt-sub-btn-primary" data-action="search">搜索</button>
                        </div>
                        <div class="vt-sub-search-results">
                            <div class="vt-sub-search-hint">点击搜索查找在线字幕</div>
                        </div>
                    </div>
                    <!-- 字幕样式 -->
                    <div class="vt-sub-section">
                        <div class="vt-sub-section-title">字幕样式</div>
                        <div class="vt-sub-slider-row">
                            <span>字号</span>
                            <input type="range" class="vt-sub-slider" data-config="fontSize" min="12" max="48" value="${this.state.config.fontSize}">
                            <span class="vt-sub-slider-value">${this.state.config.fontSize}px</span>
                        </div>
                        <div class="vt-sub-slider-row">
                            <span>位置</span>
                            <input type="range" class="vt-sub-slider" data-config="posPercent" min="2" max="40" value="${this.state.config.posPercent}">
                            <span class="vt-sub-slider-value">${this.state.config.posPercent}%</span>
                        </div>
                        <div class="vt-sub-slider-row">
                            <span>描边</span>
                            <input type="range" class="vt-sub-slider" data-config="outline" min="0" max="6" value="${this.state.config.outline}">
                            <span class="vt-sub-slider-value">${this.state.config.outline}px</span>
                        </div>
                    </div>
                    <!-- 字幕偏移 -->
                    <div class="vt-sub-section">
                        <div class="vt-sub-section-title">时间偏移</div>
                        <div class="vt-sub-offset-row">
                            <button class="vt-sub-btn vt-sub-btn-secondary" data-offset="-1">-1s</button>
                            <button class="vt-sub-btn vt-sub-btn-secondary" data-offset="-0.5">-0.5s</button>
                            <span class="vt-sub-offset-value">${this.state.offset.toFixed(1)}s</span>
                            <button class="vt-sub-btn vt-sub-btn-secondary" data-offset="0.5">+0.5s</button>
                            <button class="vt-sub-btn vt-sub-btn-secondary" data-offset="1">+1s</button>
                        </div>
                    </div>
                </div>
            `;

            container.appendChild(panel);
            this.state.panelOpen = true;

            // 字幕面板打开时，清除自动隐藏定时器，保持控制栏显示
            if (state.takeoverContainer) {
                TakeoverPlayer.cancelAutoHide();
                TakeoverPlayer.showControls();
            }

            // 延迟添加打开类以触发动画
            requestAnimationFrame(() => {
                panel.classList.add('vt-sub-panel-open');
            });

            // 绑定事件
            this.bindPanelEvents(panel);

            // 更新当前字幕信息
            this.updatePanelSubtitleInfo();
        },

        closePanel() {
            const container = state.takeoverContainer;
            if (!container) return;
            const panel = container.querySelector('.vt-sub-panel');
            if (panel) {
                panel.classList.remove('vt-sub-panel-open');
                setTimeout(() => {
                    if (panel.parentNode) panel.remove();
                }, 300);
            }
            this.state.panelOpen = false;
        },

        bindPanelEvents(panel) {
            // 关闭按钮
            panel.querySelector('.vt-sub-panel-close').addEventListener('click', () => {
                this.closePanel();
            });

            // 按钮事件委托
            panel.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const action = btn.dataset.action;
                switch (action) {
                    case 'local':
                        this.loadLocalFile();
                        break;
                    case 'clear':
                        this.clearSubtitle();
                        this.updatePanelSubtitleInfo();
                        break;
                    case 'toggle-vis':
                        this.toggleVisible();
                        break;
                    case 'search':
                        this.doSearch(panel);
                        break;
                }
            });

            // 偏移按钮
            panel.querySelectorAll('[data-offset]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const delta = parseFloat(btn.dataset.offset);
                    this.adjustOffset(delta);
                    const valEl = panel.querySelector('.vt-sub-offset-value');
                    if (valEl) valEl.textContent = this.state.offset.toFixed(1) + 's';
                });
            });

            // 样式滑块
            panel.querySelectorAll('.vt-sub-slider').forEach(slider => {
                slider.addEventListener('input', () => {
                    const key = slider.dataset.config;
                    const val = parseFloat(slider.value);
                    this.state.config[key] = val;
                    this.saveConfig();
                    // 更新显示值
                    const valEl = slider.parentElement.querySelector('.vt-sub-slider-value');
                    if (valEl) {
                        valEl.textContent = val + (key === 'fontSize' || key === 'outline' ? 'px' : '%');
                    }
                    this.applySubStyle();
                });
            });

            // 搜索框回车
            const searchInput = panel.querySelector('.vt-sub-search-input');
            if (searchInput) {
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.doSearch(panel);
                    }
                });
            }
        },

        async doSearch(panel) {
            const input = panel.querySelector('.vt-sub-search-input');
            const keyword = input.value.trim();
            if (!keyword) {
                TakeoverPlayer.showToast('请输入搜索关键词');
                return;
            }

            const resultsEl = panel.querySelector('.vt-sub-search-results');
            resultsEl.innerHTML = '<div class="vt-sub-search-hint">搜索中...</div>';

            try {
                const results = await this.searchSubtitles(keyword);
                if (!results.length) {
                    resultsEl.innerHTML = '<div class="vt-sub-search-hint">未找到相关字幕</div>';
                    return;
                }

                resultsEl.innerHTML = results.map((item, i) => `
                    <div class="vt-sub-result-item" data-index="${i}">
                        <div class="vt-sub-result-info">
                            <div class="vt-sub-result-name">${item.name}</div>
                            <div class="vt-sub-result-extra">${item.source === 'xunlei' ? '迅雷' : '字幕猫'}${item.extra ? ' · ' + item.extra : ''}</div>
                        </div>
                        <button class="vt-sub-preview-btn" data-preview="${i}">预览</button>
                    </div>
                `).join('');

                // 缓存结果
                this._lastSearchResults = results;

                // 绑定点击加载（点击条目主体）
                resultsEl.querySelectorAll('.vt-sub-result-item').forEach(el => {
                    const infoEl = el.querySelector('.vt-sub-result-info');
                    infoEl.addEventListener('click', () => {
                        const idx = parseInt(el.dataset.index, 10);
                        const item = this._lastSearchResults[idx];
                        if (item) {
                            TakeoverPlayer.showToast('正在加载字幕...');
                            this.loadSubtitleItem(item);
                            this.closePanel();
                        }
                    });
                });

                // 绑定预览按钮
                resultsEl.querySelectorAll('.vt-sub-preview-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const idx = parseInt(btn.dataset.preview, 10);
                        const item = this._lastSearchResults[idx];
                        if (item) {
                            this.previewSubtitle(item);
                        }
                    });
                });
            } catch (e) {
                resultsEl.innerHTML = '<div class="vt-sub-search-hint">搜索失败</div>';
            }
        },

        updatePanelSubtitleInfo() {
            const container = state.takeoverContainer;
            if (!container) return;
            const panel = container.querySelector('.vt-sub-panel');
            if (!panel) return;

            const nameEl = panel.querySelector('.vt-sub-name');
            const countEl = panel.querySelector('.vt-sub-count');

            if (this.state.cues.length) {
                nameEl.textContent = this.state.name || '已加载字幕';
                countEl.textContent = this.state.cues.length + ' 条字幕';
            } else {
                nameEl.textContent = '未加载字幕';
                countEl.textContent = '';
            }
        },

        // 退出时清理
        cleanup() {
            this.stopRenderLoop();
            this.subEl = null;
            this.state.cues = [];
            this.state.cursor = 0;
            this.state.lastCue = null;
            this.state.panelOpen = false;
        },
    };

    // ==================== 样式 ====================
    const Styles = {
        init() {
            const css = `
                /* ========== 悬浮按钮 ========== */
                .vt-float-buttons {
                    position: absolute;
                    right: 12px;
                    bottom: 50px;
                    display: flex;
                    gap: 8px;
                    z-index: 1000;
                    opacity: 1;
                    transition: opacity 0.3s ease;
                    pointer-events: auto;
                }

                .vt-float-btn {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(4px);
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 8px;
                    transition: transform 0.15s, background 0.15s;
                    -webkit-tap-highlight-color: transparent;
                }

                .vt-float-btn:active {
                    transform: scale(0.9);
                    background: rgba(0, 0, 0, 0.8);
                }

                .vt-float-btn svg {
                    width: 100%;
                    height: 100%;
                }

                /* ========== Toast ========== */
                .vt-toast {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) scale(0.9);
                    background: rgba(0, 0, 0, 0.8);
                    color: #fff;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    z-index: 2147483647;
                    opacity: 0;
                    transition: opacity 0.3s, transform 0.3s;
                    pointer-events: none;
                }

                .vt-toast-show {
                    opacity: 1;
                    transform: translate(-50%, -50%) scale(1);
                }

                /* ========== 接管全屏容器 ========== */
                .vt-takeover-container {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: #000;
                    z-index: 2147483646;
                    overflow: hidden;
                    /* 禁止长按弹出菜单 */
                    -webkit-touch-callout: none;
                    -webkit-user-select: none;
                    user-select: none;
                    -webkit-tap-highlight-color: transparent;
                    touch-action: manipulation;
                }

                .vt-takeover-video-wrapper {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: #000;
                }

                .vt-takeover-video-wrapper video {
                    -webkit-touch-callout: none;
                    -webkit-user-select: none;
                    user-select: none;
                }

                /* 顶部栏 */
                .vt-takeover-top-bar {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 48px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 12px;
                    background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
                    z-index: 10;
                    transition: opacity 0.3s;
                }

                .vt-top-btn {
                    width: 40px;
                    height: 40px;
                    background: transparent;
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 8px;
                    -webkit-tap-highlight-color: transparent;
                }

                .vt-top-btn svg {
                    width: 24px;
                    height: 24px;
                }

                .vt-video-url {
                    flex: 1;
                    text-align: center;
                    color: rgba(255,255,255,0.9);
                    font-size: 13px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    padding: 0 8px;
                }

                /* 中央控制 */
                .vt-takeover-center-controls {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    display: flex;
                    align-items: center;
                    gap: 40px;
                    z-index: 10;
                    transition: opacity 0.3s;
                }

                .vt-center-btn {
                    width: 56px;
                    height: 56px;
                    background: rgba(0, 0, 0, 0.5);
                    border: none;
                    color: #fff;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                    -webkit-tap-highlight-color: transparent;
                    transition: transform 0.15s;
                }

                .vt-center-btn:active {
                    transform: scale(0.9);
                }

                .vt-center-btn svg {
                    width: 100%;
                    height: 100%;
                }

                .vt-play-btn {
                    width: 72px;
                    height: 72px;
                    background: rgba(255, 255, 255, 0.2);
                    backdrop-filter: blur(10px);
                    padding: 18px;
                }

                /* 进度条 */
                .vt-takeover-progress {
                    position: absolute;
                    bottom: 70px;
                    left: 16px;
                    right: 16px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    z-index: 10;
                    transition: opacity 0.3s;
                }

                .vt-time {
                    color: #fff;
                    font-size: 12px;
                    font-variant-numeric: tabular-nums;
                    min-width: 36px;
                    text-align: center;
                    opacity: 0.9;
                }

                .vt-progress-bar {
                    flex: 1;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.3);
                    border-radius: 2px;
                    position: relative;
                    cursor: pointer;
                }

                .vt-progress-buffered {
                    position: absolute;
                    top: 0;
                    left: 0;
                    height: 100%;
                    background: rgba(255, 255, 255, 0.4);
                    border-radius: 2px;
                    pointer-events: none;
                }

                .vt-progress-played {
                    position: absolute;
                    top: 0;
                    left: 0;
                    height: 100%;
                    background: #fff;
                    border-radius: 2px;
                    pointer-events: none;
                }

                .vt-progress-thumb {
                    position: absolute;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    width: 12px;
                    height: 12px;
                    background: #fff;
                    border-radius: 50%;
                    pointer-events: none;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                }

                /* 底部栏 */
                .vt-takeover-bottom-bar {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 60px;
                    display: flex;
                    justify-content: space-around;
                    align-items: center;
                    background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
                    padding: 0 8px;
                    z-index: 10;
                    transition: opacity 0.3s;
                }

                .vt-bottom-btn {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 2px;
                    background: transparent;
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    padding: 6px 12px;
                    font-size: 10px;
                    -webkit-tap-highlight-color: transparent;
                    transition: transform 0.15s;
                    opacity: 0.9;
                }

                .vt-bottom-btn:active {
                    transform: scale(0.9);
                    opacity: 1;
                }

                .vt-bottom-btn svg {
                    width: 22px;
                    height: 22px;
                }

                .vt-btn-label {
                    font-size: 10px;
                    opacity: 0.9;
                }

                /* 锁定状态：底部栏背景透明，只保留锁按钮 */
                .vt-takeover-container.vt-locked .vt-takeover-bottom-bar {
                    background: transparent;
                    justify-content: flex-end;
                }

                .vt-takeover-container.vt-locked .vt-lock-btn {
                    opacity: 0.8;
                    position: relative;
                    z-index: 20;
                }

                .vt-takeover-container.vt-locked .vt-lock-btn:active {
                    opacity: 1;
                }

                /* 长按解锁时的动画效果 */
                .vt-lock-btn.vt-unlock-pressing {
                    animation: vtUnlockPulse 1s ease-in-out infinite;
                }

                @keyframes vtUnlockPulse {
                    0%, 100% {
                        transform: scale(1);
                        opacity: 0.8;
                    }
                    50% {
                        transform: scale(1.15);
                        opacity: 1;
                    }
                }

                /* 倍速菜单 */
                .vt-speed-menu {
                    position: absolute;
                    bottom: 70px;
                    right: 16px;
                    background: rgba(0, 0, 0, 0.85);
                    border-radius: 8px;
                    padding: 10px;
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 6px;
                    z-index: 20;
                    max-height: 240px;
                    overflow-y: auto;
                }

                .vt-speed-option {
                    padding: 6px 4px;
                    color: #fff;
                    font-size: 12px;
                    cursor: pointer;
                    border-radius: 4px;
                    transition: background 0.15s;
                    text-align: center;
                }

                .vt-speed-option:active {
                    background: rgba(255,255,255,0.2);
                }

                /* 长按提示（倍速调节） */
                .vt-longpress-indicator {
                    position: absolute;
                    top: 12px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.6);
                    color: #fff;
                    padding: 6px 14px;
                    border-radius: 16px;
                    z-index: 50;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    pointer-events: none;
                    backdrop-filter: blur(4px);
                }

                .vt-lp-rate {
                    font-size: 15px;
                    font-weight: 600;
                    line-height: 1;
                    color: #fff;
                    font-variant-numeric: tabular-nums;
                }

                .vt-lp-hint {
                    display: none;
                }

                /* 音量 / 亮度提示 */
                .vt-vertical-indicator {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0, 0, 0, 0.62);
                    color: #fff;
                    padding: 12px 16px;
                    border-radius: 12px;
                    z-index: 60;
                    display: none;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    pointer-events: none;
                    backdrop-filter: blur(4px);
                    min-width: 96px;
                }

                .vt-vi-icon {
                    font-size: 22px;
                    line-height: 1;
                }

                .vt-vi-value {
                    font-size: 15px;
                    font-weight: 600;
                    line-height: 1;
                    font-variant-numeric: tabular-nums;
                }

                .vt-vi-bar {
                    width: 84px;
                    height: 4px;
                    border-radius: 2px;
                    background: rgba(255, 255, 255, 0.28);
                    overflow: hidden;
                }

                .vt-vi-bar-fill {
                    height: 100%;
                    background: #fff;
                    border-radius: 2px;
                }

                /* 跳转提示 */
                .vt-seek-indicator {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0, 0, 0, 0.6);
                    color: #fff;
                    padding: 8px 16px;
                    border-radius: 4px;
                    font-size: 18px;
                    font-weight: 600;
                    z-index: 50;
                    display: none;
                    pointer-events: none;
                }

                .vt-seek-anim {
                    animation: vtSeekFade 0.8s ease-out forwards;
                }

                @keyframes vtSeekFade {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.8);
                    }
                    20% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    80% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.9);
                    }
                }

                /* 滑动进度预览 */
                .vt-seek-preview {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0, 0, 0, 0.75);
                    color: #fff;
                    padding: 16px 24px;
                    border-radius: 8px;
                    z-index: 60;
                    display: none;
                    pointer-events: none;
                    min-width: 180px;
                    text-align: center;
                }

                .vt-seek-preview-time {
                    font-size: 18px;
                    font-weight: 600;
                    margin-bottom: 10px;
                    font-variant-numeric: tabular-nums;
                }

                .vt-seek-preview-bar {
                    width: 100%;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.3);
                    border-radius: 2px;
                    overflow: hidden;
                }

                .vt-seek-preview-progress {
                    height: 100%;
                    background: #fff;
                    border-radius: 2px;
                    transition: width 0.05s linear;
                }

                /* 横屏模式优化 */
                @media (orientation: landscape) {
                    .vt-takeover-bottom-bar {
                        height: 56px;
                    }

                    .vt-center-btn {
                        width: 48px;
                        height: 48px;
                    }

                    .vt-play-btn {
                        width: 64px;
                        height: 64px;
                    }
                }

                /* CSS旋转竖屏模式：原生方向锁不可用时的回退 */
                .vt-takeover-container.vt-portrait-css {
                    transform: rotate(90deg) translateZ(0);
                    transform-origin: center center;
                    width: 100vh;
                    height: 100vw;
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    margin-left: -50vh;
                    margin-top: -50vw;
                    z-index: 2147483647;
                }

                .vt-takeover-container.vt-portrait-css .vt-takeover-bottom-bar {
                    bottom: 70px;
                    height: 64px;
                    background: rgba(0,0,0,0.6);
                    border-radius: 12px;
                    margin: 0 12px;
                }

                .vt-takeover-container.vt-portrait-css .vt-takeover-progress {
                    bottom: 134px;
                }

                /* CSS模式横屏（CSS模式默认状态，长按切换到CSS模式时使用） */
                .vt-takeover-container.vt-css-landscape {
                    transform: rotate(90deg) translateZ(0);
                    transform-origin: center center;
                    width: 100vh;
                    height: 100vw;
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    margin-left: -50vh;
                    margin-top: -50vw;
                    z-index: 2147483647;
                }

                /* ========== 字幕文字 ========== */
                .vt-subtitle-text {
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 5;
                    max-width: 85%;
                    text-align: center;
                    padding: 4px 10px;
                    border-radius: 5px;
                    pointer-events: none;
                    background: transparent;
                    white-space: pre-wrap;
                    line-height: 1.35;
                    display: none;
                    font-family: 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
                    font-weight: 500;
                    word-break: break-word;
                }

                /* ========== 字幕面板 ========== */
                .vt-sub-panel {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: rgba(20, 20, 20, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 16px 16px 0 0;
                    z-index: 100;
                    transform: translateY(100%);
                    transition: transform 0.3s ease;
                    max-height: 80%;
                    display: flex;
                    flex-direction: column;
                    color: #fff;
                }

                .vt-sub-panel.vt-sub-panel-open {
                    transform: translateY(0);
                }

                .vt-sub-panel-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 16px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    flex-shrink: 0;
                }

                .vt-sub-panel-title {
                    font-size: 16px;
                    font-weight: 600;
                }

                .vt-sub-panel-close {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.1);
                    border: none;
                    color: #fff;
                    font-size: 14px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    -webkit-tap-highlight-color: transparent;
                }

                .vt-sub-panel-content {
                    overflow-y: auto;
                    padding: 12px 16px 24px;
                    flex: 1;
                }

                .vt-sub-section {
                    margin-bottom: 20px;
                }

                .vt-sub-section-title {
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.6);
                    margin-bottom: 10px;
                    font-weight: 500;
                }

                .vt-sub-info {
                    margin-bottom: 10px;
                }

                .vt-sub-name {
                    font-size: 14px;
                    color: #fff;
                    margin-bottom: 4px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .vt-sub-count {
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.5);
                }

                .vt-sub-actions {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .vt-sub-btn {
                    padding: 8px 14px;
                    border-radius: 8px;
                    border: none;
                    font-size: 13px;
                    cursor: pointer;
                    -webkit-tap-highlight-color: transparent;
                    transition: opacity 0.15s;
                }

                .vt-sub-btn:active {
                    opacity: 0.7;
                }

                .vt-sub-btn-primary {
                    background: #64b4ff;
                    color: #fff;
                }

                .vt-sub-btn-secondary {
                    background: rgba(255, 255, 255, 0.15);
                    color: #fff;
                }

                .vt-sub-btn-danger {
                    background: rgba(255, 80, 80, 0.2);
                    color: #ff6b6b;
                }

                /* 搜索 */
                .vt-sub-search {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 10px;
                }

                .vt-sub-search-input {
                    flex: 1;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 8px;
                    color: #fff;
                    font-size: 14px;
                    outline: none;
                }

                .vt-sub-search-input::placeholder {
                    color: rgba(255, 255, 255, 0.4);
                }

                .vt-sub-search-results {
                    max-height: 200px;
                    overflow-y: auto;
                    border-radius: 8px;
                    background: rgba(255, 255, 255, 0.05);
                }

                .vt-sub-search-hint {
                    padding: 20px;
                    text-align: center;
                    color: rgba(255, 255, 255, 0.4);
                    font-size: 13px;
                }

                .vt-sub-result-item {
                    padding: 10px 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    cursor: pointer;
                    -webkit-tap-highlight-color: transparent;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }

                .vt-sub-result-item:last-child {
                    border-bottom: none;
                }

                .vt-sub-result-info {
                    flex: 1;
                    min-width: 0;
                }

                .vt-sub-result-info:active {
                    opacity: 0.6;
                }

                .vt-sub-result-name {
                    font-size: 13px;
                    color: #fff;
                    margin-bottom: 3px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .vt-sub-result-extra {
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.4);
                }

                .vt-sub-preview-btn {
                    flex-shrink: 0;
                    padding: 5px 12px;
                    background: rgba(100, 180, 255, 0.2);
                    color: #64b4ff;
                    border: 1px solid rgba(100, 180, 255, 0.3);
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    -webkit-tap-highlight-color: transparent;
                }

                .vt-sub-preview-btn:active {
                    background: rgba(100, 180, 255, 0.35);
                }

                /* 滑块 */
                .vt-sub-slider-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 10px;
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.8);
                }

                .vt-sub-slider-row > span:first-child {
                    min-width: 36px;
                }

                .vt-sub-slider {
                    flex: 1;
                    height: 4px;
                    -webkit-appearance: none;
                    appearance: none;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 2px;
                    outline: none;
                }

                .vt-sub-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #64b4ff;
                    cursor: pointer;
                }

                .vt-sub-slider-value {
                    min-width: 40px;
                    text-align: right;
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.6);
                    font-variant-numeric: tabular-nums;
                }

                /* 偏移 */
                .vt-sub-offset-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 6px;
                }

                .vt-sub-offset-row .vt-sub-btn {
                    padding: 6px 10px;
                    font-size: 12px;
                    flex: 1;
                }

                .vt-sub-offset-value {
                    min-width: 50px;
                    text-align: center;
                    font-size: 13px;
                    color: #fff;
                    font-weight: 500;
                    font-variant-numeric: tabular-nums;
                }

                /* ========== 字幕预览弹窗 ========== */
                .vt-sub-preview-modal {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    z-index: 200;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }

                .vt-sub-preview-content {
                    background: rgba(30, 30, 30, 0.98);
                    border-radius: 12px;
                    width: 100%;
                    max-width: 400px;
                    max-height: 80%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .vt-sub-preview-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 16px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    flex-shrink: 0;
                }

                .vt-sub-preview-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #fff;
                }

                .vt-sub-preview-close {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.1);
                    border: none;
                    color: #fff;
                    font-size: 14px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    -webkit-tap-highlight-color: transparent;
                }

                .vt-sub-preview-name {
                    padding: 10px 16px;
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.7);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex-shrink: 0;
                }

                .vt-sub-preview-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px 16px;
                }

                .vt-sub-preview-loading {
                    text-align: center;
                    color: rgba(255, 255, 255, 0.5);
                    padding: 30px 0;
                    font-size: 14px;
                }

                .vt-sub-preview-error {
                    text-align: center;
                    color: #ff6b6b;
                    padding: 30px 0;
                    font-size: 13px;
                }

                .vt-sub-preview-count {
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.4);
                    margin-bottom: 10px;
                    text-align: center;
                }

                .vt-sub-preview-line {
                    display: flex;
                    gap: 10px;
                    padding: 6px 0;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    font-size: 13px;
                    line-height: 1.4;
                }

                .vt-sub-preview-line:last-child {
                    border-bottom: none;
                }

                .vt-sub-preview-time {
                    flex-shrink: 0;
                    color: #64b4ff;
                    font-size: 11px;
                    font-variant-numeric: tabular-nums;
                    padding-top: 2px;
                    min-width: 45px;
                }

                .vt-sub-preview-text {
                    flex: 1;
                    color: #fff;
                    word-break: break-all;
                    min-width: 0;
                }

                .vt-sub-preview-more {
                    text-align: center;
                    color: rgba(255, 255, 255, 0.3);
                    font-size: 12px;
                    padding: 12px 0;
                }

                .vt-sub-preview-footer {
                    display: flex;
                    gap: 10px;
                    padding: 12px 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    flex-shrink: 0;
                }

                .vt-sub-preview-footer .vt-sub-btn {
                    flex: 1;
                    padding: 10px;
                    font-size: 14px;
                }

                .vt-sub-preview-footer .vt-sub-btn[disabled] {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
            `;

            GM_addStyle(css);
        },
    };

    // ==================== 初始化 ====================
    function init() {
        // 初始化样式
        Styles.init();

        // 初始化视频检测
        VideoDetector.init();

        console.log('[Video Takeover Mobile] 移动端网页视频接管已加载');
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

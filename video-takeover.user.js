// ==UserScript==
// @name         网页视频接管 (Video Takeover)
// @namespace    https://github.com/mason173/aira-browser
// @version      1.0.0
// @description  接管网页视频播放，提供画中画、全屏、倍速、进度控制、音量调节等增强功能。灵感来自 Aira 浏览器的网页视频接管功能。
// @author       Video Takeover
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// @license      GPL-3.0
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        // 面板默认位置
        defaultPosition: 'bottom-right',
        // 面板是否默认显示
        defaultShowPanel: true,
        // 自动隐藏面板延迟（毫秒），0 表示不自动隐藏
        autoHideDelay: 0,
        // 进度条步进（秒）
        seekStep: 5,
        // 倍速选项
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3],
        // 默认倍速
        defaultRate: 1,
        // 快捷键开关
        enableHotkeys: true,
        // 是否在 iframe 中运行
        runInIframes: true,
        // 视频检测最小时长（秒），低于此时长的视频忽略
        minVideoDuration: 3,
    };

    // ==================== 状态管理 ====================
    const state = {
        videos: [],
        activeVideo: null,
        panel: null,
        isPanelVisible: true,
        isDragging: false,
        dragOffset: { x: 0, y: 0 },
        autoHideTimer: null,
        position: { x: 20, y: 20 },
        panelPosition: GM_getValue('panelPosition', CONFIG.defaultPosition),
    };

    // ==================== 工具函数 ====================
    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    // ==================== 视频检测与追踪 ====================
    const VideoTracker = {
        init() {
            this.scanVideos();
            this.observeDOM();
            // 定期重新扫描，捕获动态加载的视频
            setInterval(() => this.scanVideos(), 2000);
        },

        scanVideos() {
            const videos = document.querySelectorAll('video');
            const newVideos = [];

            videos.forEach((video) => {
                if (!video.dataset.vtTracked) {
                    video.dataset.vtTracked = 'true';
                    this.setupVideoListeners(video);
                }
                // 过滤掉太短的视频（可能是广告或装饰性视频）
                if (video.duration && video.duration >= CONFIG.minVideoDuration) {
                    newVideos.push(video);
                } else if (!video.duration || isNaN(video.duration)) {
                    // 时长未知的也加入，等 loadedmetadata 后再判断
                    newVideos.push(video);
                }
            });

            state.videos = newVideos;

            // 如果没有活跃视频，自动选择第一个正在播放的视频
            if (!state.activeVideo || !document.contains(state.activeVideo)) {
                const playingVideo = newVideos.find((v) => !v.paused && !v.ended);
                if (playingVideo) {
                    this.setActiveVideo(playingVideo);
                } else if (newVideos.length > 0) {
                    this.setActiveVideo(newVideos[0]);
                } else {
                    state.activeVideo = null;
                    Panel.updateVisibility();
                }
            }
        },

        setupVideoListeners(video) {
            video.addEventListener('play', () => this.onVideoPlay(video));
            video.addEventListener('pause', () => this.onVideoPause(video));
            video.addEventListener('timeupdate', () => this.onTimeUpdate(video));
            video.addEventListener('loadedmetadata', () => this.onLoadedMetadata(video));
            video.addEventListener('ended', () => this.onEnded(video));
            video.addEventListener('volumechange', () => this.onVolumeChange(video));
            video.addEventListener('ratechange', () => this.onRateChange(video));
            video.addEventListener('enterpictureinpicture', () => this.onEnterPiP(video));
            video.addEventListener('leavepictureinpicture', () => this.onLeavePiP(video));
        },

        onVideoPlay(video) {
            // 播放时自动设为活跃视频
            if (state.activeVideo !== video) {
                this.setActiveVideo(video);
            }
            Panel.updatePlayButton();
            Panel.show();
        },

        onVideoPause(video) {
            if (state.activeVideo === video) {
                Panel.updatePlayButton();
            }
        },

        onTimeUpdate(video) {
            if (state.activeVideo === video) {
                Panel.updateProgress();
            }
        },

        onLoadedMetadata(video) {
            this.scanVideos(); // 重新过滤
            if (state.activeVideo === video) {
                Panel.updateDuration();
                Panel.updateProgress();
            }
        },

        onEnded(video) {
            if (state.activeVideo === video) {
                Panel.updatePlayButton();
            }
        },

        onVolumeChange(video) {
            if (state.activeVideo === video) {
                Panel.updateVolume();
            }
        },

        onRateChange(video) {
            if (state.activeVideo === video) {
                Panel.updateRateButton();
            }
        },

        onEnterPiP(video) {
            if (state.activeVideo === video) {
                Panel.updatePiPButton(true);
            }
        },

        onLeavePiP(video) {
            if (state.activeVideo === video) {
                Panel.updatePiPButton(false);
            }
        },

        setActiveVideo(video) {
            state.activeVideo = video;
            Panel.refreshAll();
            Panel.updateVisibility();
        },

        observeDOM() {
            const observer = new MutationObserver((mutations) => {
                let shouldScan = false;
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === 1) {
                                if (node.tagName === 'VIDEO' ||
                                    (node.querySelectorAll && node.querySelectorAll('video').length > 0)) {
                                    shouldScan = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (shouldScan) {
                    this.scanVideos();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        },

        switchVideo(direction) {
            if (state.videos.length <= 1) return;
            const currentIndex = state.videos.indexOf(state.activeVideo);
            let newIndex;
            if (direction === 'next') {
                newIndex = (currentIndex + 1) % state.videos.length;
            } else {
                newIndex = (currentIndex - 1 + state.videos.length) % state.videos.length;
            }
            this.setActiveVideo(state.videos[newIndex]);
        },
    };

    // ==================== 控制面板 UI ====================
    const Panel = {
        init() {
            this.createPanel();
            this.setupPosition();
            this.setupDrag();
            this.updateVisibility();
        },

        createPanel() {
            const panel = document.createElement('div');
            panel.id = 'video-takeover-panel';
            panel.className = 'vt-panel';
            panel.innerHTML = `
                <div class="vt-panel-header">
                    <span class="vt-panel-title">🎬 视频接管</span>
                    <div class="vt-panel-actions">
                        <button class="vt-btn vt-icon-btn" data-action="prev-video" title="上一个视频">⏮</button>
                        <button class="vt-btn vt-icon-btn" data-action="next-video" title="下一个视频">⏭</button>
                        <button class="vt-btn vt-icon-btn" data-action="toggle-panel" title="收起/展开">−</button>
                    </div>
                </div>
                <div class="vt-panel-body">
                    <div class="vt-video-info">
                        <span class="vt-video-title" id="vt-video-title">未检测到视频</span>
                        <span class="vt-video-count" id="vt-video-count"></span>
                    </div>
                    <div class="vt-progress-container">
                        <span class="vt-time vt-current-time" id="vt-current-time">00:00</span>
                        <div class="vt-progress-bar" id="vt-progress-bar">
                            <div class="vt-progress-buffered" id="vt-progress-buffered"></div>
                            <div class="vt-progress-played" id="vt-progress-played"></div>
                            <div class="vt-progress-thumb" id="vt-progress-thumb"></div>
                        </div>
                        <span class="vt-time vt-duration" id="vt-duration">00:00</span>
                    </div>
                    <div class="vt-controls">
                        <button class="vt-btn vt-control-btn" data-action="seek-back" title="后退 ${CONFIG.seekStep}秒">⏪</button>
                        <button class="vt-btn vt-play-btn" data-action="toggle-play" title="播放/暂停">▶</button>
                        <button class="vt-btn vt-control-btn" data-action="seek-forward" title="快进 ${CONFIG.seekStep}秒">⏩</button>
                        <button class="vt-btn vt-rate-btn" data-action="cycle-rate" title="播放速度">1x</button>
                        <button class="vt-btn vt-control-btn" data-action="toggle-pip" title="画中画">📺</button>
                        <button class="vt-btn vt-control-btn" data-action="toggle-fullscreen" title="全屏">⛶</button>
                    </div>
                    <div class="vt-volume-container">
                        <button class="vt-btn vt-icon-btn vt-volume-btn" data-action="toggle-mute" title="静音">🔊</button>
                        <div class="vt-volume-bar" id="vt-volume-bar">
                            <div class="vt-volume-filled" id="vt-volume-filled"></div>
                            <div class="vt-volume-thumb" id="vt-volume-thumb"></div>
                        </div>
                    </div>
                    <div class="vt-extra-controls">
                        <button class="vt-btn vt-small-btn" data-action="screenshot" title="截图">📷 截图</button>
                        <button class="vt-btn vt-small-btn" data-action="toggle-loop" title="循环播放">🔁 循环</button>
                        <button class="vt-btn vt-small-btn" data-action="playback-speed-menu" title="速度菜单">⚡ 速度</button>
                    </div>
                    <div class="vt-speed-menu" id="vt-speed-menu" style="display: none;">
                        ${CONFIG.playbackRates.map((rate) =>
                            `<button class="vt-speed-option" data-rate="${rate}">${rate}x</button>`
                        ).join('')}
                    </div>
                </div>
            `;

            document.documentElement.appendChild(panel);
            state.panel = panel;

            // 绑定事件
            this.bindEvents();
        },

        bindEvents() {
            const panel = state.panel;

            // 按钮点击事件
            panel.querySelectorAll('[data-action]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    this.handleAction(action, btn);
                });
            });

            // 进度条点击
            const progressBar = panel.querySelector('#vt-progress-bar');
            progressBar.addEventListener('click', (e) => {
                this.seekByClick(e, progressBar);
            });

            // 进度条拖拽
            let isSeeking = false;
            progressBar.addEventListener('mousedown', (e) => {
                isSeeking = true;
                this.seekByClick(e, progressBar);
            });
            document.addEventListener('mousemove', (e) => {
                if (isSeeking) {
                    this.seekByClick(e, progressBar);
                }
            });
            document.addEventListener('mouseup', () => {
                isSeeking = false;
            });

            // 音量条点击
            const volumeBar = panel.querySelector('#vt-volume-bar');
            volumeBar.addEventListener('click', (e) => {
                this.setVolumeByClick(e, volumeBar);
            });

            // 音量条拖拽
            let isVolumeChanging = false;
            volumeBar.addEventListener('mousedown', (e) => {
                isVolumeChanging = true;
                this.setVolumeByClick(e, volumeBar);
            });
            document.addEventListener('mousemove', (e) => {
                if (isVolumeChanging) {
                    this.setVolumeByClick(e, volumeBar);
                }
            });
            document.addEventListener('mouseup', () => {
                isVolumeChanging = false;
            });

            // 速度选项
            panel.querySelectorAll('.vt-speed-option').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const rate = parseFloat(btn.dataset.rate);
                    VideoPlayer.setPlaybackRate(rate);
                    panel.querySelector('#vt-speed-menu').style.display = 'none';
                });
            });

            // 鼠标悬停显示面板
            panel.addEventListener('mouseenter', () => {
                this.cancelAutoHide();
            });
            panel.addEventListener('mouseleave', () => {
                this.scheduleAutoHide();
            });
        },

        handleAction(action, btn) {
            const video = state.activeVideo;

            switch (action) {
                case 'toggle-play':
                    VideoPlayer.togglePlay();
                    break;
                case 'seek-back':
                    VideoPlayer.seek(-CONFIG.seekStep);
                    break;
                case 'seek-forward':
                    VideoPlayer.seek(CONFIG.seekStep);
                    break;
                case 'cycle-rate':
                    VideoPlayer.cycleRate();
                    break;
                case 'toggle-pip':
                    VideoPlayer.togglePiP();
                    break;
                case 'toggle-fullscreen':
                    VideoPlayer.toggleFullscreen();
                    break;
                case 'toggle-mute':
                    VideoPlayer.toggleMute();
                    break;
                case 'prev-video':
                    VideoTracker.switchVideo('prev');
                    break;
                case 'next-video':
                    VideoTracker.switchVideo('next');
                    break;
                case 'toggle-panel':
                    this.toggleCollapse();
                    break;
                case 'screenshot':
                    VideoPlayer.takeScreenshot();
                    break;
                case 'toggle-loop':
                    VideoPlayer.toggleLoop();
                    btn.classList.toggle('vt-active', video && video.loop);
                    break;
                case 'playback-speed-menu':
                    const menu = state.panel.querySelector('#vt-speed-menu');
                    menu.style.display = menu.style.display === 'none' ? 'grid' : 'none';
                    break;
            }
        },

        seekByClick(e, progressBar) {
            const video = state.activeVideo;
            if (!video || !video.duration) return;

            const rect = progressBar.getBoundingClientRect();
            const percent = clamp((e.clientX - rect.left) / rect.width, 0, 1);
            video.currentTime = percent * video.duration;
        },

        setVolumeByClick(e, volumeBar) {
            const video = state.activeVideo;
            if (!video) return;

            const rect = volumeBar.getBoundingClientRect();
            const percent = clamp((e.clientX - rect.left) / rect.width, 0, 1);
            video.volume = percent;
            video.muted = percent === 0;
        },

        setupPosition() {
            const position = GM_getValue('panelPosition', CONFIG.defaultPosition);
            state.panelPosition = position;
            this.applyPosition(position);
        },

        applyPosition(position) {
            const panel = state.panel;
            panel.classList.remove('vt-position-top-left', 'vt-position-top-right',
                'vt-position-bottom-left', 'vt-position-bottom-right');
            panel.classList.add(`vt-position-${position}`);
        },

        setupDrag() {
            const header = state.panel.querySelector('.vt-panel-header');
            let isDragging = false;
            let startX, startY, startLeft, startTop;

            header.addEventListener('mousedown', (e) => {
                // 忽略按钮点击
                if (e.target.closest('button')) return;

                isDragging = true;
                const panel = state.panel;
                const rect = panel.getBoundingClientRect();

                startX = e.clientX;
                startY = e.clientY;
                startLeft = rect.left;
                startTop = rect.top;

                panel.style.position = 'fixed';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.style.left = startLeft + 'px';
                panel.style.top = startTop + 'px';

                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                const newLeft = clamp(startLeft + dx, 0, window.innerWidth - state.panel.offsetWidth);
                const newTop = clamp(startTop + dy, 0, window.innerHeight - state.panel.offsetHeight);

                state.panel.style.left = newLeft + 'px';
                state.panel.style.top = newTop + 'px';
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
            });
        },

        toggleCollapse() {
            const body = state.panel.querySelector('.vt-panel-body');
            const btn = state.panel.querySelector('[data-action="toggle-panel"]');
            if (body.style.display === 'none') {
                body.style.display = '';
                btn.textContent = '−';
            } else {
                body.style.display = 'none';
                btn.textContent = '+';
            }
        },

        show() {
            state.isPanelVisible = true;
            state.panel.style.display = '';
            this.cancelAutoHide();
            if (CONFIG.autoHideDelay > 0) {
                this.scheduleAutoHide();
            }
        },

        hide() {
            state.isPanelVisible = false;
            state.panel.style.display = 'none';
        },

        scheduleAutoHide() {
            if (CONFIG.autoHideDelay <= 0) return;
            this.cancelAutoHide();
            state.autoHideTimer = setTimeout(() => {
                this.hide();
            }, CONFIG.autoHideDelay);
        },

        cancelAutoHide() {
            if (state.autoHideTimer) {
                clearTimeout(state.autoHideTimer);
                state.autoHideTimer = null;
            }
        },

        updateVisibility() {
            if (state.videos.length > 0 && state.activeVideo) {
                this.show();
            } else {
                // 没有视频时也显示面板，方便用户知道插件在运行
                this.show();
            }
        },

        refreshAll() {
            this.updatePlayButton();
            this.updateProgress();
            this.updateDuration();
            this.updateVolume();
            this.updateRateButton();
            this.updatePiPButton();
            this.updateVideoInfo();
        },

        updatePlayButton() {
            const video = state.activeVideo;
            const btn = state.panel.querySelector('[data-action="toggle-play"]');
            if (!video) {
                btn.textContent = '▶';
                return;
            }
            btn.textContent = video.paused ? '▶' : '⏸';
        },

        updateProgress() {
            const video = state.activeVideo;
            const currentTimeEl = state.panel.querySelector('#vt-current-time');
            const playedEl = state.panel.querySelector('#vt-progress-played');
            const thumbEl = state.panel.querySelector('#vt-progress-thumb');
            const bufferedEl = state.panel.querySelector('#vt-progress-buffered');

            if (!video) {
                currentTimeEl.textContent = '00:00';
                playedEl.style.width = '0%';
                thumbEl.style.left = '0%';
                bufferedEl.style.width = '0%';
                return;
            }

            currentTimeEl.textContent = formatTime(video.currentTime);

            if (video.duration) {
                const percent = (video.currentTime / video.duration) * 100;
                playedEl.style.width = percent + '%';
                thumbEl.style.left = percent + '%';
            }

            // 缓冲进度
            if (video.buffered && video.buffered.length > 0 && video.duration) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const bufferedPercent = (bufferedEnd / video.duration) * 100;
                bufferedEl.style.width = bufferedPercent + '%';
            }
        },

        updateDuration() {
            const video = state.activeVideo;
            const durationEl = state.panel.querySelector('#vt-duration');
            if (!video || !video.duration) {
                durationEl.textContent = '00:00';
                return;
            }
            durationEl.textContent = formatTime(video.duration);
        },

        updateVolume() {
            const video = state.activeVideo;
            const volumeBtn = state.panel.querySelector('.vt-volume-btn');
            const filledEl = state.panel.querySelector('#vt-volume-filled');
            const thumbEl = state.panel.querySelector('#vt-volume-thumb');

            if (!video) {
                volumeBtn.textContent = '🔊';
                filledEl.style.width = '100%';
                thumbEl.style.left = '100%';
                return;
            }

            if (video.muted || video.volume === 0) {
                volumeBtn.textContent = '🔇';
            } else if (video.volume < 0.5) {
                volumeBtn.textContent = '🔉';
            } else {
                volumeBtn.textContent = '🔊';
            }

            const volume = video.muted ? 0 : video.volume;
            filledEl.style.width = (volume * 100) + '%';
            thumbEl.style.left = (volume * 100) + '%';
        },

        updateRateButton() {
            const video = state.activeVideo;
            const btn = state.panel.querySelector('.vt-rate-btn');
            if (!video) {
                btn.textContent = '1x';
                return;
            }
            btn.textContent = video.playbackRate + 'x';
        },

        updatePiPButton(isInPiP) {
            const btn = state.panel.querySelector('[data-action="toggle-pip"]');
            if (isInPiP === undefined) {
                isInPiP = state.activeVideo && document.pictureInPictureElement === state.activeVideo;
            }
            btn.classList.toggle('vt-active', isInPiP);
            btn.title = isInPiP ? '退出画中画' : '画中画';
        },

        updateVideoInfo() {
            const titleEl = state.panel.querySelector('#vt-video-title');
            const countEl = state.panel.querySelector('#vt-video-count');

            if (!state.activeVideo) {
                titleEl.textContent = '未检测到视频';
                countEl.textContent = '';
                return;
            }

            // 尝试获取视频标题
            let title = '';
            // 从页面标题获取
            if (document.title) {
                title = document.title;
            }
            // 从 video 的 src 或 poster 获取线索
            if (!title && state.activeVideo.src) {
                try {
                    const url = new URL(state.activeVideo.src, location.href);
                    title = url.pathname.split('/').pop() || '视频';
                } catch (e) {
                    title = '视频';
                }
            }
            if (!title) {
                title = '当前视频';
            }

            titleEl.textContent = title.length > 30 ? title.substring(0, 30) + '...' : title;
            titleEl.title = title;

            if (state.videos.length > 1) {
                const currentIndex = state.videos.indexOf(state.activeVideo) + 1;
                countEl.textContent = `${currentIndex}/${state.videos.length}`;
            } else {
                countEl.textContent = '';
            }
        },
    };

    // ==================== 视频播放控制 ====================
    const VideoPlayer = {
        togglePlay() {
            const video = state.activeVideo;
            if (!video) return;

            if (video.paused) {
                video.play().catch((err) => {
                    console.warn('[Video Takeover] 播放失败:', err);
                });
            } else {
                video.pause();
            }
        },

        seek(seconds) {
            const video = state.activeVideo;
            if (!video || !video.duration) return;

            video.currentTime = clamp(video.currentTime + seconds, 0, video.duration);
        },

        setPlaybackRate(rate) {
            const video = state.activeVideo;
            if (!video) return;

            video.playbackRate = rate;
        },

        cycleRate() {
            const video = state.activeVideo;
            if (!video) return;

            const rates = CONFIG.playbackRates;
            const currentRate = video.playbackRate;
            const currentIndex = rates.indexOf(currentRate);

            let nextIndex;
            if (currentIndex === -1) {
                // 当前速度不在列表中，找到最接近的
                nextIndex = rates.findIndex((r) => r >= currentRate);
                if (nextIndex === -1) nextIndex = rates.length - 1;
            } else {
                nextIndex = (currentIndex + 1) % rates.length;
            }

            this.setPlaybackRate(rates[nextIndex]);
        },

        async togglePiP() {
            const video = state.activeVideo;
            if (!video) return;

            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else if (document.pictureInPictureEnabled) {
                    await video.requestPictureInPicture();
                } else {
                    // 浏览器不支持 PiP，尝试使用 webkit 版本
                    if (video.webkitSupportsPresentationMode) {
                        const currentMode = video.webkitPresentationMode;
                        video.webkitSetPresentationMode(currentMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
                    } else {
                        alert('您的浏览器不支持画中画功能');
                    }
                }
            } catch (err) {
                console.warn('[Video Takeover] 画中画操作失败:', err);
            }
        },

        toggleFullscreen() {
            const video = state.activeVideo;
            if (!video) return;

            // 尝试各种全屏 API
            if (document.fullscreenElement) {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
            } else {
                // 优先让视频元素全屏
                if (video.requestFullscreen) {
                    video.requestFullscreen().catch(() => {
                        // 失败则尝试父容器
                        this.requestContainerFullscreen(video);
                    });
                } else if (video.webkitRequestFullscreen) {
                    video.webkitRequestFullscreen();
                } else if (video.webkitEnterFullscreen) {
                    // iOS Safari
                    video.webkitEnterFullscreen();
                } else {
                    this.requestContainerFullscreen(video);
                }
            }
        },

        requestContainerFullscreen(video) {
            // 向上找一个合适的容器
            let container = video.parentElement;
            for (let i = 0; i < 5 && container; i++) {
                if (container.requestFullscreen) {
                    container.requestFullscreen().catch(() => { });
                    return;
                }
                container = container.parentElement;
            }
            // 最后尝试整个页面
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(() => { });
            }
        },

        toggleMute() {
            const video = state.activeVideo;
            if (!video) return;

            if (video.muted) {
                video.muted = false;
                if (video.volume === 0) {
                    video.volume = 0.5;
                }
            } else {
                video.muted = true;
            }
        },

        toggleLoop() {
            const video = state.activeVideo;
            if (!video) return;
            video.loop = !video.loop;
        },

        takeScreenshot() {
            const video = state.activeVideo;
            if (!video) return;

            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // 下载截图
                const link = document.createElement('a');
                link.download = `screenshot-${Date.now()}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            } catch (err) {
                console.warn('[Video Takeover] 截图失败（可能因跨域限制）:', err);
                alert('截图失败：可能因视频跨域限制，无法截取画面');
            }
        },
    };

    // ==================== 快捷键支持 ====================
    const Hotkeys = {
        init() {
            if (!CONFIG.enableHotkeys) return;

            document.addEventListener('keydown', (e) => {
                // 如果焦点在输入框中，忽略快捷键
                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' ||
                    activeEl.tagName === 'TEXTAREA' ||
                    activeEl.isContentEditable)) {
                    return;
                }

                // 只在有活跃视频时响应
                if (!state.activeVideo) return;

                switch (e.key) {
                    case ' ':
                        e.preventDefault();
                        VideoPlayer.togglePlay();
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        VideoPlayer.seek(-CONFIG.seekStep);
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        VideoPlayer.seek(CONFIG.seekStep);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        this.adjustVolume(0.1);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        this.adjustVolume(-0.1);
                        break;
                    case 'f':
                    case 'F':
                        e.preventDefault();
                        VideoPlayer.toggleFullscreen();
                        break;
                    case 'p':
                    case 'P':
                        e.preventDefault();
                        VideoPlayer.togglePiP();
                        break;
                    case 'm':
                    case 'M':
                        e.preventDefault();
                        VideoPlayer.toggleMute();
                        break;
                    case 'n':
                    case 'N':
                        e.preventDefault();
                        VideoTracker.switchVideo('next');
                        break;
                    case 'N':
                        if (e.shiftKey) {
                            e.preventDefault();
                            VideoTracker.switchVideo('prev');
                        }
                        break;
                    case '>':
                    case '.':
                        e.preventDefault();
                        VideoPlayer.cycleRate();
                        break;
                    case '<':
                    case ',':
                        e.preventDefault();
                        this.cycleRateBackward();
                        break;
                    case 'l':
                    case 'L':
                        e.preventDefault();
                        VideoPlayer.toggleLoop();
                        break;
                    case 's':
                    case 'S':
                        if (e.ctrlKey) {
                            e.preventDefault();
                            VideoPlayer.takeScreenshot();
                        }
                        break;
                }
            });
        },

        adjustVolume(delta) {
            const video = state.activeVideo;
            if (!video) return;
            video.volume = clamp(video.volume + delta, 0, 1);
            if (video.volume > 0) {
                video.muted = false;
            }
        },

        cycleRateBackward() {
            const video = state.activeVideo;
            if (!video) return;

            const rates = CONFIG.playbackRates;
            const currentRate = video.playbackRate;
            const currentIndex = rates.indexOf(currentRate);

            let prevIndex;
            if (currentIndex === -1) {
                prevIndex = rates.length - 1;
            } else {
                prevIndex = (currentIndex - 1 + rates.length) % rates.length;
            }

            VideoPlayer.setPlaybackRate(rates[prevIndex]);
        },
    };

    // ==================== 样式 ====================
    const Styles = {
        init() {
            const css = `
                .vt-panel {
                    position: fixed;
                    z-index: 2147483647;
                    width: 320px;
                    background: rgba(20, 20, 20, 0.95);
                    color: #fff;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    font-size: 13px;
                    user-select: none;
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    overflow: hidden;
                }

                .vt-position-top-left { top: 20px; left: 20px; }
                .vt-position-top-right { top: 20px; right: 20px; }
                .vt-position-bottom-left { bottom: 20px; left: 20px; }
                .vt-position-bottom-right { bottom: 20px; right: 20px; }

                .vt-panel-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    cursor: move;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }

                .vt-panel-title {
                    font-weight: 600;
                    font-size: 13px;
                }

                .vt-panel-actions {
                    display: flex;
                    gap: 4px;
                }

                .vt-btn {
                    background: transparent;
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    padding: 6px 10px;
                    border-radius: 6px;
                    font-size: 13px;
                    transition: background 0.15s, transform 0.1s;
                }

                .vt-btn:hover {
                    background: rgba(255, 255, 255, 0.15);
                }

                .vt-btn:active {
                    transform: scale(0.95);
                }

                .vt-btn.vt-active {
                    background: rgba(100, 180, 255, 0.3);
                    color: #64b4ff;
                }

                .vt-icon-btn {
                    padding: 4px 8px;
                    font-size: 14px;
                }

                .vt-panel-body {
                    padding: 12px;
                }

                .vt-video-info {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }

                .vt-video-title {
                    font-size: 12px;
                    opacity: 0.8;
                    max-width: 200px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .vt-video-count {
                    font-size: 11px;
                    opacity: 0.6;
                    background: rgba(255, 255, 255, 0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .vt-progress-container {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .vt-time {
                    font-size: 11px;
                    opacity: 0.7;
                    min-width: 40px;
                    text-align: center;
                    font-variant-numeric: tabular-nums;
                }

                .vt-progress-bar {
                    flex: 1;
                    height: 6px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 3px;
                    position: relative;
                    cursor: pointer;
                    transition: height 0.15s;
                }

                .vt-progress-bar:hover {
                    height: 8px;
                }

                .vt-progress-buffered {
                    position: absolute;
                    top: 0;
                    left: 0;
                    height: 100%;
                    background: rgba(255, 255, 255, 0.25);
                    border-radius: 3px;
                    pointer-events: none;
                }

                .vt-progress-played {
                    position: absolute;
                    top: 0;
                    left: 0;
                    height: 100%;
                    background: linear-gradient(90deg, #64b4ff, #8b7cf6);
                    border-radius: 3px;
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
                    opacity: 0;
                    transition: opacity 0.15s;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
                }

                .vt-progress-bar:hover .vt-progress-thumb {
                    opacity: 1;
                }

                .vt-controls {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    margin-bottom: 12px;
                }

                .vt-control-btn {
                    padding: 8px 10px;
                    font-size: 16px;
                }

                .vt-play-btn {
                    width: 44px;
                    height: 44px;
                    padding: 0;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #64b4ff, #8b7cf6);
                    font-size: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .vt-play-btn:hover {
                    background: linear-gradient(135deg, #7bc0ff, #9d8fff);
                }

                .vt-rate-btn {
                    padding: 6px 8px;
                    font-size: 11px;
                    font-weight: 600;
                    background: rgba(255, 255, 255, 0.1);
                    min-width: 36px;
                }

                .vt-volume-container {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .vt-volume-btn {
                    font-size: 16px;
                    padding: 4px 6px;
                }

                .vt-volume-bar {
                    flex: 1;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 2px;
                    position: relative;
                    cursor: pointer;
                }

                .vt-volume-filled {
                    position: absolute;
                    top: 0;
                    left: 0;
                    height: 100%;
                    background: #fff;
                    border-radius: 2px;
                    pointer-events: none;
                }

                .vt-volume-thumb {
                    position: absolute;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    width: 10px;
                    height: 10px;
                    background: #fff;
                    borderRadius: 50%;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.15s;
                }

                .vt-volume-bar:hover .vt-volume-thumb {
                    opacity: 1;
                }

                .vt-extra-controls {
                    display: flex;
                    gap: 6px;
                    flex-wrap: wrap;
                }

                .vt-small-btn {
                    flex: 1;
                    padding: 6px 8px;
                    font-size: 11px;
                    background: rgba(255, 255, 255, 0.08);
                    border-radius: 6px;
                }

                .vt-small-btn:hover {
                    background: rgba(255, 255, 255, 0.18);
                }

                .vt-speed-menu {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 4px;
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                }

                .vt-speed-option {
                    background: rgba(255, 255, 255, 0.08);
                    border: none;
                    color: #fff;
                    padding: 6px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                    transition: background 0.15s;
                }

                .vt-speed-option:hover {
                    background: rgba(100, 180, 255, 0.3);
                }

                /* 响应式：小屏幕调整 */
                @media (max-width: 480px) {
                    .vt-panel {
                        width: 280px;
                    }
                }
            `;

            GM_addStyle(css);
        },
    };

    // ==================== 菜单命令 ====================
    const MenuCommands = {
        init() {
            GM_registerMenuCommand('🎬 显示/隐藏控制面板', () => {
                if (state.isPanelVisible) {
                    Panel.hide();
                } else {
                    Panel.show();
                }
            });

            GM_registerMenuCommand('📍 面板位置：左上', () => {
                this.setPosition('top-left');
            });

            GM_registerMenuCommand('📍 面板位置：右上', () => {
                this.setPosition('top-right');
            });

            GM_registerMenuCommand('📍 面板位置：左下', () => {
                this.setPosition('bottom-left');
            });

            GM_registerMenuCommand('📍 面板位置：右下', () => {
                this.setPosition('bottom-right');
            });

            GM_registerMenuCommand('⏮ 上一个视频', () => {
                VideoTracker.switchVideo('prev');
            });

            GM_registerMenuCommand('⏭ 下一个视频', () => {
                VideoTracker.switchVideo('next');
            });

            GM_registerMenuCommand('📷 截图保存', () => {
                VideoPlayer.takeScreenshot();
            });

            GM_registerMenuCommand('⌨️ 快捷键列表', () => {
                alert(
                    '网页视频接管 - 快捷键列表\n\n' +
                    '空格       - 播放/暂停\n' +
                    '← / →     - 后退/快进 ' + CONFIG.seekStep + ' 秒\n' +
                    '↑ / ↓     - 音量加/减\n' +
                    'F          - 全屏切换\n' +
                    'P          - 画中画切换\n' +
                    'M          - 静音切换\n' +
                    'N          - 下一个视频\n' +
                    'Shift + N  - 上一个视频\n' +
                    '> / .      - 增加播放速度\n' +
                    '< / ,      - 降低播放速度\n' +
                    'L          - 循环播放切换\n' +
                    'Ctrl + S   - 截图保存'
                );
            });
        },

        setPosition(position) {
            GM_setValue('panelPosition', position);
            state.panelPosition = position;
            Panel.applyPosition(position);
            // 重置内联样式
            state.panel.style.left = '';
            state.panel.style.top = '';
            state.panel.style.right = '';
            state.panel.style.bottom = '';
        },
    };

    // ==================== 初始化 ====================
    function init() {
        // 防止在 iframe 中重复运行（根据配置决定）
        if (window.top !== window.self && !CONFIG.runInIframes) {
            return;
        }

        // 初始化样式
        Styles.init();

        // 初始化面板
        Panel.init();

        // 初始化视频追踪
        VideoTracker.init();

        // 初始化快捷键
        Hotkeys.init();

        // 初始化菜单命令
        MenuCommands.init();

        console.log('[Video Takeover] 网页视频接管插件已加载');
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

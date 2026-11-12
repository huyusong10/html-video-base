/* 视频声明配置：画幅、转场、开放式多模型 TTS 配音（默认微软 Emma）、背景音乐与专有词汇发音 */
(function () {
  const rootScope = typeof window !== 'undefined' ? window : globalThis;
  const V = (rootScope.V = rootScope.V || {});
  V.config = {
    id: '__VIDEO_ID__',
    title: '__VIDEO_TITLE__',
    subtitle: '基于纯函数时间轴驱动的交互式 HTML 视频',
    width: __STAGE_WIDTH__,
    height: __STAGE_HEIGHT__,
    fps: 30,
    theme: 'light',            // 'light' | 'dark'（或在 style.css 自定义 :root 变量）
    transition: 'fade',        // 'fade' | 'slide' | 'wipe' | 'tiles' | 'none'
    audioSrc: 'assets/soundtrack.m4a',
    timingsScript: 'assets/voice/timings.js',
    sceneScripts: ['js/scenes.js'],
    tts: {
      provider: 'edge',        // 'edge'（默认） | 'openai' | 'elevenlabs' | 'azure' | 'http' | 'command' | 自定义插件名
      voice: 'en-US-EmmaMultilingualNeural', // 默认微软 Emma 多语种温柔女声
      speed: 1.15,
    },
    bgm: {
      preset: 'ambient',       // 'ambient' | 'chiptune' | 'none'，或指定外部文件 src: 'assets/bgm.mp3'
      volume: 0.14,
      duck: 0.55,
    },
    sfx: {
      preset: 'soft',          // 'soft' | 'chiptune' | 'none'，或指定外部文件 transition / impact
      volume: 0.16,
    },
    pronunciation: {
      'HTML': 'H T M L',
      'MP4': 'M P 4',
    },
  };
})();

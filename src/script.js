// AD module
const adMod = 'ytp-ad-module';
// ミュートボタン
const muteButton = 'ytp-mute-button';

function $(className, doc = document) {
  return doc.getElementsByClassName(className ?? '')[0];
}

function isDisplayNone(target$) {
  return target$?.style.getPropertyValue('display') === 'none';
}

function getVideoEl() {
  return $('html5-main-video');
}

function setPlaybackRate(rate) {
  getVideoEl().playbackRate = rate;
}

function getPlaybackRate() {
  return getVideoEl().playbackRate;
}

function getSkipButton() {
  const className = [...$(adMod).getElementsByTagName('button')]
    .flatMap((btn) => [...btn.classList])
    .find((n) => n.includes('skip'));
  return $(className);
}

function getVisibilityParent(target$) {
  if (!target$) {
    return undefined;
  }
  if (isDisplayNone(target$)) {
    return target$;
  }
  return getVisibilityParent(target$.parentElement);
}

function isMuted() {
  return getVideoEl().muted;
}

function mute(shouldMute) {
  const mute$ = $(muteButton);
  const muted = isMuted();
  /// #if mode == 'development'
  console.log('mute', { shouldMute, muted });
  /// #endif
  if (shouldMute) {
    if (!muted) {
      mute$.click();
    }
    return;
  }
  if (muted) {
    mute$.click();
  }
}

function setObserver(target$, callback, filter) {
  const observer = (new MutationObserver(callback));
  observer.observe(target$, filter);
  return observer;
}

async function getOptions() {
  return chrome.storage.local.get();
}

function getChannelInfo() {
  let title;
  let channelId$;
  const [channelImg$, channelInfo1$] = document.querySelectorAll('ytd-video-owner-renderer a');
  const img = channelImg$?.querySelector('img').src;
  if (channelInfo1$) {
    channelId$ = channelImg$;
    title = channelInfo1$.textContent;
  } else {
    const channelInfo2$ = document.querySelector('[itemprop="author"]');
    channelId$ = channelInfo2$.querySelector('[itemprop="url"]');
    title = channelInfo2$.querySelector('[itemprop="name"]')?.getAttribute('content');
  }
  const [, channelId] = /(?<=\/)([^/]+$)/.exec(channelId$.href) || [];
  return { channelId, title, img };
}

function checkExcludeChannel(exChannels) {
  const channelInfo = getChannelInfo();
  const result = exChannels.some(([id]) => id === channelInfo.channelId);
  /// #if mode == 'development'
  console.log('checkExcludeChannel', result, channelInfo);
  /// #endif
  return result;
}

async function readySkip(options) {
  if (options.mute) mute(true);

  setPlaybackRate(options.playbackRate ?? 1);

  if (!options.skip) {
    return undefined;
  }

  const skipButton$ = getSkipButton();
  // スキップボタン／親要素
  const target$ = getVisibilityParent(skipButton$);

  if (!target$) {
    return undefined;
  }

  if (!isDisplayNone(target$)) {
    skipButton$.click();
    return undefined;
  }

  return new Promise((resolve) => {
    let timer;
    const callback = ([record], observer) => {
      if (isDisplayNone(record?.target)) {
        return;
      }
      clearTimeout(timer);
      observer.disconnect();
      skipButton$.click();
      resolve();
    };

    const filter = {
      attributes: true,
      attributeFilter: ['style'],
    };

    const observer = setObserver(target$, callback, filter);
    timer = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 10000);
  });
}

async function run(isInit) {
  /// #if mode == 'development'
  console.log('run');
  /// #endif

  // Ad module
  const adMod$ = $(adMod);

  if (!adMod$) {
    if (isInit) {
      setTimeout(run, 1000);
    }
    return;
  }

  let muted = isMuted();
  let defer = Promise.resolve(true);
  let playbackRate = getPlaybackRate();
  let options = await getOptions();

  const isExcludeChannel = checkExcludeChannel(options.exChannels);

  if (adMod$.children.length > 0 && options.enabled && !isExcludeChannel) {
    readySkip(options);
    /// #if mode == 'development'
    console.log('adMod$.children.length > 0');
    /// #endif
  }

  setObserver(
    adMod$,
    async ([record]) => {
      if (!record?.addedNodes?.length) {
        setPlaybackRate(playbackRate);
        if (!muted) {
          mute(false);
        }
        defer = defer.then(() => true);
        return;
      }
      /// #if mode == 'development'
      console.log('observe', (new Date()).toLocaleTimeString(), defer);
      /// #endif
      options = await getOptions();
      if (!options.enabled || checkExcludeChannel(options.exChannels)) {
        /// #if mode == 'development'
        console.log('disable skip', options.enabled);
        /// #endif
        return;
      }
      defer = defer.then((restart) => {
        if (!restart) {
          return undefined;
        }
        muted = isMuted();
        playbackRate = getPlaybackRate();
        return readySkip(options);
      });
    },
    { childList: true },
  );
}

chrome.runtime.onMessage.addListener(({ msg }, __, sendResponse) => {
  if (msg !== 'get-channel-info') {
    sendResponse({ msg: 'done' });
    return;
  }
  const channelInfo = getChannelInfo();
  sendResponse(channelInfo);
});

/// #if mode == 'development'
console.log('window.scripting', window.scripting);
/// #endif

if (!window.scripting) {
  window.scripting = 'done';
  run(true);
}

// AD module
const adMod = 'ytp-ad-module';
// ミュートボタン
const muteButton = 'ytp-mute-button';

const promiseChannel = Promise.withResolvers();

function $c(className, doc = document) {
  return doc.getElementsByClassName(className ?? '')[0];
}

function $q(className, doc = document) {
  return doc.querySelector(className ?? '');
}

function isDisplayNone(target$) {
  return target$?.style.getPropertyValue('display') === 'none';
}

function tryUntilElement(fn, getter, resolver = () => { }, times = 0) {
  const el$ = getter();
  if (el$) {
    fn(el$);
    resolver(el$);
    return;
  }
  if (times > 10) {
    resolver();
    return;
  }
  setTimeout(() => tryUntilElement(fn, getter, resolver, times + 1), 500);
}

async function getLocal() {
  return chrome.storage.local.get();
}

function setObserver(target$, callback, filter) {
  if (!target$) {
    return {};
  }
  const observer = new MutationObserver(callback);
  observer.observe(target$, filter);
  return observer;
}

async function promiseState(p) {
  const t = {};
  const v = await Promise.race([p, t]);
  return (v === t) ? 'pending' : 'fulfilled';
}

function getVideoEl() {
  return $c('html5-main-video');
}

function setPlaybackRate(rate) {
  getVideoEl().playbackRate = rate;
}

function getPlaybackRate() {
  return parseFloat($c('ytp-bezel-text').textContent) || 1;
}

function getSkipButton() {
  const className = [...$c(adMod).getElementsByTagName('button')]
    .flatMap((btn) => [...btn.classList])
    .find((n) => n.includes('skip'));
  return $c(className);
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
  const mute$ = $c(muteButton);
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

function isWatchPage() {
  return document.URL.startsWith('https://www.youtube.com/watch');
}

function getChannelInfo() {
  const [channelImg$, channelInfo$] = document.querySelectorAll('ytd-video-owner-renderer a');
  if (!channelImg$) {
    return {};
  }
  const img = channelImg$?.querySelector('img').src;
  const title = channelInfo$.textContent;
  const [, channelId] = /(?<=\/)([^/]+$)/.exec(channelImg$.href) || [];
  return { channelId, title, img };
}

async function checkExcludeChannel(exChannels) {
  const channelInfo = await promiseChannel.promise;
  const result = exChannels.some(([id]) => id === channelInfo.channelId);
  /// #if mode == 'development'
  console.log('checkExcludeChannel', result, channelInfo);
  /// #endif
  return result;
}

async function setBadge() {
  const channelInfo = getChannelInfo();
  if (!channelInfo.channelId) {
    return;
  }
  promiseChannel.resolve(channelInfo);
  promiseChannel.promise = promiseChannel.promise.then(() => channelInfo);
  const options = await getLocal();
  const isExcludeChannel = await checkExcludeChannel(options.exChannels);
  chrome.runtime.sendMessage({ msg: 'set-badge-text', value: isExcludeChannel ? 'Ex' : '' });
}

function resolveSkip([observer1, observer2], timer, skipButton$, resolve) {
  clearTimeout(timer);
  observer2.disconnect();
  observer1.disconnect();
  skipButton$?.click();
  resolve();
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
    skipButton$?.click();
    return undefined;
  }

  if (!isDisplayNone(target$)) {
    skipButton$.click();
    return undefined;
  }

  return new Promise((resolve) => {
    let timer;
    const observers = [
      setObserver(
        target$,
        ([record]) => {
          if (isDisplayNone(record.target)) {
            return;
          }
          resolveSkip(observers, timer, skipButton$, resolve);
        },
        {
          attributes: true,
          attributeFilter: ['style'],
        },
      ),
      setObserver(
        $c('html5-video-player'),
        ([record]) => {
          if (!record.target.classList.contains('ended-mode')) {
            return;
          }
          /// #if mode == 'development'
          console.log('html5-video-player: ended-mode', $c(adMod).outerHTML);
          /// #endif
          resolveSkip(observers, timer, getSkipButton(), resolve);
        },
        {
          attributes: true,
          attributeFilter: ['class'],
        },
      ),
    ];

    timer = setTimeout(() => {
      observers.forEach((observer) => observer.disconnect());
      resolve();
    }, 10000);
  });
}

function setChannelObserver(pageManager$) {
  setObserver(pageManager$, (_, observerPageManager) => {
    /// #if mode == 'development'
    console.log('Observe 1');
    /// #endif
    if (!isWatchPage()) {
      return;
    }
    const formattedString$ = $q('ytd-video-owner-renderer #img', pageManager$);
    if (!formattedString$) {
      return;
    }
    if (formattedString$.src) {
      /// #if mode == 'development'
      console.log('setBadge 1');
      /// #endif
      setBadge();
    }
    setObserver(formattedString$, () => {
      /// #if mode == 'development'
      console.log('setBadge 2');
      /// #endif
      if (formattedString$.src) {
        setBadge();
      }
    }, {
      attributes: true,
      attributeFilter: ['src'],
    });
    const watchFlexy$ = $q('ytd-watch-flexy');
    if (!watchFlexy$) {
      return;
    }
    setObserver(watchFlexy$, () => {
      /// #if mode == 'development'
      console.log('setBadge 3');
      /// #endif
      if (watchFlexy$.hasAttribute('hidden')) {
        return;
      }
      setBadge();
    }, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    observerPageManager.disconnect();
  }, {
    childList: true,
    subtree: true,
  });
}

function setAdObserver(adMod$, initMuted, initPlaybackRate) {
  let muted = initMuted;
  let playbackRate = initPlaybackRate;
  let defer = Promise.resolve(true);
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
      const options = await getLocal();
      if (!options.enabled) {
        return;
      }
      const isExcludeChannel = await checkExcludeChannel(options.exChannels);
      if (isExcludeChannel) {
        return;
      }
      /// #if mode == 'development'
      console.log(adMod$.outerHTML);
      /// #endif
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

async function run(adMod$) {
  /// #if mode == 'development'
  console.log('run');
  /// #endif

  tryUntilElement(setChannelObserver, () => $q('ytd-page-manager'));

  setTimeout(() => promiseState(promiseChannel.promise).then((state) => {
    if (state === 'pending') {
      promiseChannel.resolve({});
    }
  }), 3000);

  const muted = isMuted();
  const playbackRate = getPlaybackRate();

  const options = await getLocal();
  const isExcludeChannel = await checkExcludeChannel(options.exChannels);

  /// #if mode == 'development'
  console.log('isExcludeChannel', isExcludeChannel);
  /// #endif

  if (adMod$.children.length > 0 && options.enabled && !isExcludeChannel) {
    /// #if mode == 'development'
    console.log('adMod$.children.length > 0');
    /// #endif
    readySkip(options);
  }

  setAdObserver(adMod$, muted, playbackRate);
}

window.adMod$ = undefined;

async function rerun() {
  window.adMod$ = await new Promise((resolve) => {
    tryUntilElement(run, () => $c(adMod), resolve);
  });
}

chrome.runtime.onMessage.addListener(({ msg }, __, sendResponse) => {
  if (msg === 'get-channel-info') {
    if (!isWatchPage()) {
      sendResponse({});
      return false;
    }
    promiseChannel.promise.then(sendResponse);
    return true;
  }
  if (msg === 'exists') {
    sendResponse({ exists: true });
    if (window.adMod$ !== $c(adMod)) {
      rerun();
    }
  }
  return false;
});

/// #if mode == 'development'
console.log('window.scripting', window.scripting);
/// #endif

if (!window.scripting) {
  window.scripting = 'done';
  rerun();
}

// ==UserScript==
// @name         YouTube Tweaks
// @namespace    https://github.com/maykot/Tampermonkey-YouTubeTweaks
// @version      0.1
// @author       Felipe Maykot
// @description  Creates an interface for the YouTube webpage and player that allows for them to be modularly tweaked.
// @homepage     https://github.com/maykot/Tampermonkey-YouTubeTweaks
// @icon         https://www.youtube.com/s/desktop/8ec23982/img/favicon_144x144.png
// @include      https://www.youtube.com*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// TODO: Features to add:
// - Implement local storage for user settings;
// - Show total playtime of playlist;
// - Change paused video UI behaviour:
//   - UI should be hidden when video is paused, shown if video is hovered;
// - Create a button to open all subscriptions which have new content.
// - Skip to next chapter.

// TODO: Fix needed:
// - Tweaks are adversely affected by ad state. The ad state needs to be
//   monitored somehow and an event has to be fired when it changes so that
//   tweaks can respond appropriately.
//
// The following tweaks are being affected so far:
// - EffectiveTimeDisplay: has to constantly call enableEffTDs/disableEffTDs
//   to guarantee that effTD will not be displayed during ads.
// - CustomPreferredQuality: cannot set preferred quality when ad plays as soon
//   as the page is loaded.
// - ModPlaybackRate: playback rate is sometimes set to 1x regardless of
//   previous user choice when returning to video after ad is played.

// TODO: Refactor:
// - Create a closeAds method for both the YouTubeApp and YouTubePlayer classes.

(() => {
    "use strict";

    /**
     * Events which can possibly trigger Tweaks to be applied.
     * @enum {string}
     */
    const EVENTS = { INIT: "init", REFRESH: "refresh" };

    /**
     * YouTube player quality level aliases.
     * @enum {string}
     */
    const QUALITY_LEVELS = {
        AUTO: "auto",
        _144p: "tiny",
        _240p: "small",
        _360p: "medium",
        _480p: "large",
        _720p: "hd720",
        _1080p: "hd1080",
        _1440p: "hd1440",
        _2160p: "hd2160",
        _4320p: "highres",
        _4K: "hd2160",
        _8K: "highres",
        HD: "hd720",
        FHD: "hd1080",
        QHD: "hd1440",
    };

    /**
     * Interface for interacting with and modding the YouTube webpage.
     */
    class TweakedYouTubeApp {
        /**
         * @param {Array<Tweak>} tweaks List of tweaks to be applied.
         */
        constructor(tweaks = []) {
            this.tweaks = tweaks;

            // A single YouTube webpage can often have more than one active
            // player at once (e.g. main video player, miniplayer, channel home
            // screen player).
            this.players = [];

            this.applyEagerTweaks();
            this.applyTweaks(EVENTS.INIT);
            this.updatePlayers();
            window.addEventListener(
                "yt-visibility-refresh",
                this.refreshHandler.bind(this)
            );
        }

        applyEagerTweaks() {
            for (const tweak of this.tweaks) {
                tweak.onAppEagerInit(this);
            }
        }

        applyTweaks(event) {
            for (const tweak of this.tweaks) {
                switch (event) {
                    case EVENTS.INIT:
                        tweak.onAppInit(this);
                        break;
                    case EVENTS.REFRESH:
                        tweak.onAppRefresh(this);
                        break;
                }
            }
        }

        updatePlayers() {
            const players = document.getElementsByClassName(
                "html5-video-player"
            );
            for (const element of players) {
                const isNew = !this.players.find(e => (e.element === element));
                if (isNew) {
                    const player = new TweakedYouTubePlayer(
                        element, this.tweaks
                    );
                    this.players.push(player);
                }
            }
        }

        refreshHandler() {
            this.updatePlayers();

            this.applyTweaks(EVENTS.REFRESH);
            for (const player of this.players) {
                player.applyTweaks(EVENTS.REFRESH);
            }
        }

        get mainPlayer() {
            for (const player of this.players) {
                if (player.matches("#movie_player")) {
                    return player;
                }
            }
        }

        get focusedPlayer() {
            for (const player of this.players) {
                if (player.contains(document.activeElement)) {
                    return player;
                }
            }
        }

        focusNextPlayer() {
            const numberOfPlayers = this.players.length;
            if (!numberOfPlayers) return;

            let focusedPlayerIdx = this.players.indexOf(this.focusedPlayer);
            focusedPlayerIdx = (focusedPlayerIdx + 1) % numberOfPlayers;
            this.players[focusedPlayerIdx].focus();
        }
    }

    /**
     * Interface for interacting with and modding the YouTube player.
     * @extends {NativeYouTubePlayer}
     */
    class TweakedYouTubePlayer {
        /**
         * @param {HTMLDivElement} player Div containing the YouTube player.
         * @param {Array<Tweaks>} tweaks List of tweaks to be applied.
         */
        constructor(player, tweaks = []) {
            this.element = player;
            this.tweaks = tweaks;

            // Proxy is used so that the class can act as an extension of the
            // player element.
            this.proxy = new Proxy(this, { get: this.getHandler });

            // Monitors changes to the UI elements so that the proper display
            // style can be set when toggling the UI.
            this._isUIEnabled = true;
            this._ignoreNextUIMutation = false;
            const observerOptions = {
                attributes: true,
                attributeFilter: ["style"],
                subtree: true,
            };
            const UIObserver = new MutationObserver(
                (mutations) => this.UIMutationHandler(mutations)
            );
            UIObserver.observe(this.element, observerOptions);

            this.applyEagerTweaks();
            this.applyTweaks(EVENTS.INIT);

            return this.proxy;
        }

        getHandler(target, prop, receiver) {
            const proto = Object.getPrototypeOf(target);
            const isOwnProp = target.hasOwnProperty(prop);
            const isOwnMethod = proto.hasOwnProperty(prop);
            if (isOwnProp || isOwnMethod) {
                // Class default getter.
                return Reflect.get(...arguments);
            }

            // Fallback getter.
            return Reflect.get(
                target.element, prop, receiver
            ).bind(target.element);
        }

        UIMutationHandler(mutations) {
            if (this._ignoreNextUIMutation) {
                this._ignoreNextUIMutation = false;
                return;
            }

            const UIElements = this.UIElements;
            for (const mutation of mutations) {
                const el = mutation.target;
                if (!UIElements.includes(el)) continue;

                el.oldDisplayStyle = el.style.display;
                if (!this._isUIEnabled) {
                    el.style.display = "none";
                }
            }
        }

        applyEagerTweaks() {
            for (const tweak of this.tweaks) {
                tweak.onPlayerEagerInit(this.proxy);
            }
        }

        applyTweaks(event) {
            for (const tweak of this.tweaks) {
                switch (event) {
                    case EVENTS.INIT:
                        tweak.onPlayerInit(this.proxy);
                        break;
                    case EVENTS.REFRESH:
                        tweak.onPlayerRefresh(this.proxy);
                }
            }
        }

        addEventListener(type, listener, options = {}, useCapture = false) {
            // This is necessary because the player element 'addEventListener'
            // method is not the native one.
            const addEventListener = EventTarget.prototype.addEventListener;
            return addEventListener.bind(this.element)(...arguments);
        }

        get video() {
            return this.element.getElementsByClassName("video-stream")[0];
        }

        get controls() {
            return this.element.getElementsByClassName("ytp-chrome-bottom")[0];
        }

        get UIElements() {
            let UIElements = [...this.element.children];
            UIElements = UIElements.filter(
                e => e.className !== "html5-video-container"
            );
            return UIElements;
        }

        get timeDisplays() {
            return this.element.getElementsByClassName(
                "ytp-time-display notranslate"
            );
        }

        get OSDElement() {
            return this.element.getElementsByClassName("ytp-bezel-text")[0];
        }

        get scrollableElements() {
            const scrollableSelectors = {
                MENU: ".ytp-popup.ytp-settings-menu",
                VOLUME_SLIDER: ".ytp-volume-slider",
                TIME_DISPLAY: ".ytp-time-display",
                SIDE_DRAWER: "#iv-drawer",
            };
            const selectors = Object.values(scrollableSelectors);

            const scrollableElements = [];
            for (const selector of selectors) {
                const element = this.element.querySelector(selector);
                scrollableElements.push(element);
            }

            return scrollableElements;
        }

        get volume() {
            return this.element.getVolume();
        }

        set volume(value) {
            // HACK: Workaround to be able to use YouTube's native OSD.
            // A possibly undesired side effect is that the "volumechange" event
            // is fired twice every time the volume is changed.
            const direction = Math.sign(value - this.volume);
            this.stepVolume(direction);

            this.element.setVolume(value);
        }

        stepVolume(direction) {
            const keyCode = (direction === -1) ? 40 : 38;
            this.element.dispatchEvent(
                new KeyboardEvent("keydown", { keyCode: keyCode })
            );
        }

        get playbackRate() {
            return this.video.playbackRate;
        }

        set playbackRate(value) {
            // Prevents changing playback rate during ads.
            if (this.element.getAdState() !== -1) return;

            // HACK: Workaround to be able to use YouTube's native OSD.
            // A possibly undesired side effect is that the "ratechange" event
            // is fired twice every time the playback rate is changed.
            const direction = Math.sign(value - this.playbackRate);
            this.stepPlaybackRate(direction);
            this.OSDElement.innerText = value + "x";

            this.element.setPlaybackRate(value);
        }

        stepPlaybackRate(direction) {
            const keyCode = (direction === -1) ? 188 : 190;
            this.element.dispatchEvent(
                new KeyboardEvent(
                    "keydown", { keyCode: keyCode, shiftKey: true }
                )
            );
        }

        get playbackQuality() {
            return this.element.getPlaybackQuality();
        }

        set playbackQuality(quality) {
            const availableQualities = this.element.getAvailableQualityLevels();
            if (!availableQualities.includes(quality)) {
                // Fallback is the highest available quality.
                quality = availableQualities[0];
            }
            this.element.setPlaybackQualityRange(quality, quality);
        }

        toggleStatsForNerds() {
            if (this.element.isVideoInfoVisible()) {
                this.element.hideVideoInfo();
            } else {
                this.element.showVideoInfo();
            }
        }

        // This is purposefully different from the native
        // hideControls/showControls methods. Those do not toggle all UI
        // elements, only the controls.

        // BUG: Ad elements that were hidden by the user might show up during
        // normal playback.
        toggleUI() {
            if (this._isUIEnabled) {
                this.hideUI();
            } else {
                this.showUI();
                this.wakeUpControls();
            }
        }

        hideUI() {
            this._ignoreNextUIMutation = true;
            for (const element of this.UIElements) {
                element.oldDisplayStyle = element.style.display;
                element.style.display = "none";
            }
            this._isUIEnabled = false;
        }

        showUI() {
            this._ignoreNextUIMutation = true;
            for (const element of this.UIElements) {
                element.style.display = element.oldDisplayStyle;
                element.removeAttribute("oldDisplayStyle");
            }
            this._isUIEnabled = true;
        }

        wakeUpControls() {
            if (!this.element.wakeUpControls) return;
            this.element.wakeUpControls();
        }
    }

    /**
     * Abstract class representing the interfaces a Tweak can implement to
     * interact with TweakedYouTubeApp and TweakedYouTubePlayer.
     * @abstract
     */
    class Tweak {
        constructor() {
            if (new.target == Tweak) {
                throw new Error("Abstract classes cannot be instantiated.");
            }
        }

        /**
         * Called on app initialization before all other callbacks. Should only
         * be used for overriding class methods.
         * @param {TweakedYouTubeApp} app The app to be tweaked.
         */
        onAppEagerInit(app) { }

        /**
         * Called on app initialization.
         * @param {TweakedYouTubeApp} app The app to be tweaked.
         */
        onAppInit(app) { }

        /**
         * Called on app refresh (on "yt-visibility-refresh" event).
         * @param {TweakedYouTubeApp} app The app to be tweaked.
         */
        onAppRefresh(app) { }

        /**
         * Called on player initialization before all other callbacks. Should be
         * used only for overriding class methods.
         * @param {TweakedYouTubePlayer} player The player to be tweaked.
         */
        onPlayerEagerInit(player) { }

        /**
         * Called on player initialization.
         * @param {TweakedYouTubePlayer} player The player to be tweaked.
         */
        onPlayerInit(player) { }

        /**
         * Called for every player on app refresh (on "yt-visibility-refresh"
         * event).
         * @param {TweakedYouTubePlayer} player The player to be tweaked.
         */
        onPlayerRefresh(player) { }


        retryOnFail(callback, interval = 500, maxTries = 10) {
            const success = callback();
            if (success || maxTries <= 1) return;
            setTimeout(
                () => this.retryOnFail(callback, interval, maxTries - 1),
                interval
            );
        }
    }

    /**
     * Periodically save the current time as a parameter on the URL.
     */
    class SaveProgressOnURL extends Tweak {
        /**
         * @param {number} updateInterval How often, in milliseconds, the
         * progress should be saved.
         */
        constructor(updateInterval) {
            super();
            this.updateInterval = updateInterval;
        }

        onAppInit(app) {
            this.app = app;
            this.retryOnFail(
                () => this.bindListeners()
            );
        }

        bindListeners() {
            if (!this.app.mainPlayer || !this.app.mainPlayer.video) {
                return false;
            }

            this.app.mainPlayer.video.addEventListener(
                "timeupdate",
                () => { this.progressSaved = false }
            );
            setInterval(
                () => this.saveProgressOnUrl(),
                this.updateInterval
            );

            return true;
        }

        saveProgressOnUrl() {
            if (this.progressSaved) return;

            const path = window.location.pathname.split("/");
            const isWatchPage = (path[1] === "watch");
            if (!isWatchPage) return;

            const seconds = "" + Math.floor(
                this.app.mainPlayer.getCurrentTime()
            );
            const newState = this.stateWithUpToDateTime(seconds);
            window.history.replaceState("", "", newState);
            this.progressSaved = true;
        }

        stateWithUpToDateTime(seconds) {
            const location = window.location;
            const origin = location.origin;

            const newState = location.href.slice(origin.length);
            const timeQueryRegex = /(\?|\&)t=([0-9]*[a-z])*/g;
            const urlHasTimeParam = newState.search(timeQueryRegex) !== -1;
            const urlHasQueries = newState.indexOf("?") !== -1;

            seconds += "s";
            if (urlHasTimeParam) {
                return newState.replace(timeQueryRegex, `$1t=${seconds}`);
            } else if (urlHasQueries) {
                return newState + "&t=" + seconds;
            } else {
                return newState + "?t=" + seconds;
            }
        }
    };

    /**
     * Adds the ability to control the volume with the mouse wheel by scrolling
     * over the player.
     */
    class MouseWheelVolumeControl extends Tweak {
        constructor() {
            super();
        }

        onPlayerInit(player) {
            player.addEventListener(
                "wheel",
                (event) => this.eventHandler(player, event)
            );
        }

        eventHandler(player, event) {
            const scrollables = player.scrollableElements;
            for (const scrollable of scrollables) {
                if (event.path.includes(scrollable)) return;
            }

            event.preventDefault();

            const direction = -Math.sign(event.deltaY);
            player.stepVolume(direction);
        }
    }

    /**
     * Adds the ability to control the playback rate with the mouse wheel by
     * scrolling over the player time display.
     */
    class MouseWheelPlaybackRateControl extends Tweak {
        constructor() {
            super();
            this.tweakedTimeDisplays = new Set();
        }

        onPlayerInit(player) {
            const timeDisplays = player.timeDisplays;
            for (const timeDisplay of timeDisplays) {
                if (this.tweakedTimeDisplays.has(timeDisplay)) {
                    continue;
                }
                timeDisplay.addEventListener(
                    "wheel",
                    (event) => this.eventHandler(player, event)
                );
                this.tweakedTimeDisplays.add(timeDisplay);
            }
        }

        onPlayerRefresh(player) {
            this.onPlayerInit(player);
        }

        eventHandler(player, event) {
            event.preventDefault();

            const direction = -Math.sign(event.deltaY);
            player.stepPlaybackRate(direction);
        }
    }

    /**
     * Overrides the playback rate control of the players, allowing for custom
     * non-native values.
     */
    class ModPlaybackRate extends Tweak {
        /**
         * @param {Array<number>} playbackRates List of desired playback rates.
         */
        constructor(playbackRates = []) {
            super();

            if (!playbackRates.length) {
                this.playbackRates = [
                    0.10, 0.15, 0.20, 0.25, 0.50, 0.75, 1.00, 1.25, 1.50,
                    1.75, 2.00, 2.50, 3.00, 4.00, 5.00, 6.00, 8.00, 10.0,
                ];
            } else {
                this.playbackRates = playbackRates;
            }

            this.timerStart = new Date();
        }

        onPlayerEagerInit(player) {
            const pbRateDescriptor = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(player), "playbackRate"
            );
            pbRateDescriptor.set = (value) => {
                this.moddedSetPlaybackRate(player, value);
            };
            pbRateDescriptor.configurable = true;
            Object.defineProperty(player, "playbackRate", pbRateDescriptor);

            player.stepPlaybackRate = (direction) => {
                this.moddedStepPlaybackRate(player, direction);
            };
        }

        moddedSetPlaybackRate(player, value) {
            // Prevents changing playback rate during ads.
            if (player.getAdState() !== -1) return;

            // Workaround to be able to use YouTube's native OSD.
            // A possibly undesired side effect is that the "ratechange" event
            // is fired twice every time the playback rate is changed.
            const direction = Math.sign(value - player.playbackRate);
            const keyCode = (direction === -1) ? 188 : 190;
            player.dispatchEvent(
                new KeyboardEvent(
                    "keydown", { keyCode: keyCode, shiftKey: true }
                )
            );
            player.OSDElement.innerText = value + "x";

            player.setPlaybackRate(value);
            // Necessary for non-native values.
            player.video.playbackRate = value;
        }

        moddedStepPlaybackRate(player, direction) {
            const oldRate = player.playbackRate;
            const newRate = this.nextRate(oldRate, direction);

            const isOutsideNativeRange = (newRate < 0.25 || newRate > 2);
            const now = new Date();
            if (isOutsideNativeRange && (now - this.timerStart < 500)) {
                return;
            }

            player.playbackRate = newRate;

            if (newRate == 0.25 || newRate == 2) {
                this.timerStart = new Date();
            }
        }

        nextRate(oldRate, direction) {
            let closestPlaybackRateIdx = this.playbackRates.length - 1;
            for (const [i, playbackRate] of Object.entries(this.playbackRates)) {
                if (oldRate < playbackRate) {
                    closestPlaybackRateIdx = i - 0.5;
                    break;
                }
                if (oldRate === playbackRate) {
                    closestPlaybackRateIdx = i - 0;
                    break;
                }
            }

            let playbackRateIdx = closestPlaybackRateIdx + direction;
            playbackRateIdx = Math.trunc(playbackRateIdx);
            playbackRateIdx = Math.max(
                0, Math.min(this.playbackRates.length - 1, playbackRateIdx)
            );

            return this.playbackRates[playbackRateIdx];
        }
    }

    /**
     * Modifies the default playback rate to the desired value. If the user
     * changes the playback rate that will be set as the new default playback
     * rate for the app.
     */
    class DefaultPlaybackRate extends Tweak {
        /**
         * @param {number} playbackRate The player's default playback rate.
         */
        constructor(playbackRate = 1.25) {
            super();
            this.playbackRate = playbackRate;
        }

        onPlayerInit(player) {
            player.playbackRate = this.playbackRate;
            player.video.addEventListener(
                "ratechange",
                () => { this.playbackRate = player.playbackRate }
            );
        }
    }

    /**
     * Sets the preferred quality of the player.
     */
    class CustomPreferredQuality extends Tweak {
        /**
         * @param {QUALITY_LEVELS} preferredQuality The player's preferred
         * quality.
         */
        constructor(preferredQuality = QUALITY_LEVELS._8K) {
            super();
            this.preferredQuality = preferredQuality;
        }

        onPlayerInit(player) {
            player.playbackQuality = this.preferredQuality;
        }
    }

    // TODO: CustomKeyboardShortcuts needs a refactor:
    // - The actual shortcuts should be a separate class.
    // - The original class should only take care of listening for events and
    //   applying the shortcut actions.
    // - Make user input detection more robust to different platforms/locales.
    // - Get rid of default shortcuts.
    /**
     * Adds custom actions that can be called via user defined shortcuts.
     */
    class CustomKeyboardShortcuts extends Tweak {
        /**
         * @param {Array<shortcut>} shortcuts List of custom shortcuts.
         */
        constructor(shortcuts = []) {
            super();

            // TODO: Add the following shortcuts:
            // - remove current video from playlist;
            // - toggle PiP.
            this.defaultShortcuts = [{
                description: "Closes all ads",
                modifiers: ["Alt"],
                key: "S",
                tweakAction: ["closeAds"],
            },

            {
                description: "Toggles stats for nerds",
                modifiers: ["Alt"],
                key: "V",
                playerAction: ["toggleStatsForNerds"],
            },

            {
                description: "Toggles player UI",
                modifiers: ["Alt"],
                key: "C",
                playerAction: ["toggleUI"],
            },

            {
                description: "Sets playback rate to '1x'",
                modifiers: ["Alt"],
                key: "1",
                tweakAction: ["setPlaybackRate", [1]],
            },

            {
                description: "Set playback rate to '2x'",
                modifiers: ["Alt"],
                key: "2",
                tweakAction: ["setPlaybackRate", [2]],
            },

            {
                description: "Decreases volume",
                modifiers: ["Alt"],
                key: "ArrowDown",
                playerAction: ["stepVolume", [-1]],
            },

            {
                description: "Increases volume",
                modifiers: ["Alt"],
                key: "ArrowUp",
                playerAction: ["stepVolume", [1]],
            },

            {
                description: "Decreases playback rate",
                modifiers: ["Ctrl", "Shift"],
                key: "<",
                playerAction: ["stepPlaybackRate", [-1]],
            },

            {
                description: "Increases playback rate",
                modifiers: ["Ctrl", "Shift"],
                key: ">",
                playerAction: ["stepPlaybackRate", [1]],
            },

            {
                description: "Pauses JavaScript execution (only works if " +
                    "dev tools are already open)",
                modifiers: ["Alt", "Ctrl"],
                key: "D",
                action: function () { debugger },
            },
            ];
            this.shortcuts = [...this.defaultShortcuts, ...shortcuts];
            this.modifiers = {
                Alt: "altKey",
                Ctrl: "ctrlKey",
                Meta: "metaKey",
                Shift: "shiftKey",
            };

            this.adSelectors = {
                SKIP_AD: ".ytp-ad-skip-button-container",
                CLOSE_BANNER: ".ytp-ad-overlay-close-button",
            };
        }

        onAppInit(app) {
            this.app = app;
            window.addEventListener(
                "keydown",
                this.eventHandler.bind(this)
            );
        }

        eventHandler(event) {
            const mods = this.modifiers;
            const shortcuts = this.shortcuts;

            shortcutsLoop: for (const shortcut of shortcuts) {
                // Checks that proper key is pressed.
                const key = shortcut.key.toUpperCase();
                if (event.key.toUpperCase() !== key) {
                    continue shortcutsLoop;
                }

                // Checks that relevant modifiers and only them are pressed.
                for (const [modName, modKey] of Object.entries(mods)) {
                    const shouldBePressed = shortcut.modifiers.includes(modName);
                    const isPressed = event[modKey];

                    if (shouldBePressed != isPressed) {
                        continue shortcutsLoop;
                    }
                }

                // Correct key and modifiers were pressed.
                if (shortcut.tweakAction) {
                    let [action, args] = shortcut.tweakAction;
                    this[action](...(args || []));
                }
                if (shortcut.playerAction) {
                    const player = this.app.focusedPlayer || this.app.mainPlayer;
                    if (!player) return;

                    let [action, args] = shortcut.playerAction;
                    player[action](...(args || []));
                }
                if (shortcut.action) {
                    shortcut.action();
                }
            }
        }

        /**
         * Closes all ads and returns focus to a player.
         */
        closeAds() {
            const focusedPlayer = this.app.focusedPlayer;
            const skipAdSelector = this.adSelectors.SKIP_AD;

            for (const button of this.getAdButtons()) {
                // Check to prevent skipping ads before timer runs out.
                const isSkipAdButton = button.matches(skipAdSelector);
                const isHidden = (button.style.display === "none");
                if (isSkipAdButton && isHidden) continue;

                button.click();
            }

            if (focusedPlayer) {
                focusedPlayer.focus();
            } else {
                this.app.focusNextPlayer();
            }
        }

        getAdButtons() {
            const selectors = Object.values(this.adSelectors);
            const adButtons = [];
            for (const selector of selectors) {
                adButtons.push(...document.querySelectorAll(selector))
            }

            return adButtons;
        }

        setPlaybackRate(value) {
            const player = this.app.focusedPlayer || this.app.mainPlayer;
            player.playbackRate = value;
        }
    }

    // BUG: Live badge is hidden in live videos and eff time is shown.
    // TODO: Replace only the required individual elements instead of replacing the whole 'ytp-time-display'.
    // TODO: Do not update time if display is hidden.
    /**
     * Tweaks the time display to show the effective time, taking the current
     * playback rate into account.
     */
    class EffectiveTimeDisplay extends Tweak {
        constructor() {
            super();

            this.effTDClassName = "eff-time-display ytp-time-display";
            this.effTDChildren = {
                current: {
                    className: "eff-time-current ytp-time-current",
                },
                separator: {
                    className: "eff-time-separator ytp-time-separator",
                    innerText: " / ",
                },
                duration: {
                    className: "eff-time-duration ytp-time-duration",
                },
                playbackRate: {
                    className: "eff-playback-rate ytp-time-duration",
                },
            };

            this.tweakedTDs = [];
        }

        onPlayerInit(player) {
            this.tweakTDs(player);
            this.bindListeners(player);
        }

        onPlayerRefresh(player) {
            this.tweakTDs(player);
        }

        tweakTDs(player) {
            const nonTweakedTDs = this.getNonTweakedTDs(player);
            for (const nativeTD of nonTweakedTDs) {
                const effTD = this.createEffTD();
                this.addMouseWheelPlaybackRateControl(player, effTD);

                this.tweakedTDs.push({
                    native: nativeTD,
                    eff: effTD,
                    active: nativeTD,
                    player: player,
                });
            }
            this.updateTDs(player);
        }

        bindListeners(player) {
            player.video.addEventListener(
                "timeupdate", () => this.updateTDs(player)
            );
            player.video.addEventListener(
                "ratechange", () => this.updateTDs(player)
            );
        }

        getNonTweakedTDs(player) {
            const nativeTDs = player.timeDisplays;
            const nonTweakedTDs = [];

            for (const nativeTD of nativeTDs) {
                const TDAlreadyTweaked = this.tweakedTDs.find(
                    e => (e.native === nativeTD)
                );
                if (TDAlreadyTweaked) continue;

                nonTweakedTDs.push(nativeTD);
            }

            return nonTweakedTDs;
        }

        createEffTD() {
            const effTD = document.createElement("div");
            effTD.className = this.effTDClassName;

            for (const child of Object.values(this.effTDChildren)) {
                const element = document.createElement("span");
                for (const [attr, val] of Object.entries(child)) {
                    element[attr] = val;
                }
                effTD.appendChild(element);
            }

            return effTD;
        }

        updateTDs(player) {
            // HACK: Temporary workaround until an ad state change event is
            // implemented.
            const adState = player.getAdState();
            const tweakedTDs = this.tweakedTDs.filter(e => e.player == player);

            if (adState != -1) {
                this.disableEffTDs(tweakedTDs);
                return;
            }

            this.enableEffTDs(tweakedTDs);
            this.updateEffTime(tweakedTDs);
        }

        disableEffTDs(tweakedTDs) {
            for (const tweakedTD of tweakedTDs) {
                this.replaceTDElements(tweakedTD.active, tweakedTD.native);
                tweakedTD.active = tweakedTD.native;
            }
        }

        enableEffTDs(tweakedTDs) {
            for (const tweakedTD of tweakedTDs) {
                this.replaceTDElements(tweakedTD.active, tweakedTD.eff);
                tweakedTD.active = tweakedTD.eff;
            }
        }

        replaceTDElements(td1, td2) {
            const liveBadge = td1.getElementsByClassName(
                "ytp-live-badge ytp-button"
            )[0];
            if (liveBadge) {
                td2.appendChild(liveBadge);
            }

            td1.replaceWith(td2);
        }

        addMouseWheelPlaybackRateControl(player, effTD) {
            effTD.addEventListener(
                "wheel",
                function (event) {
                    event.preventDefault();

                    const direction = -Math.sign(event.deltaY);
                    player.stepPlaybackRate(direction);
                }
            )
        }

        updateEffTime(tweakedTDs) {
            for (const tweakedTD of tweakedTDs) {
                const eff = tweakedTD.eff;
                const player = tweakedTD.player;

                const current = player.getCurrentTime();
                const duration = player.getDuration();
                const rate = player.playbackRate;
                const tdStrings = this.effTimeStrings(current, duration, rate);

                for (const [child, text] of Object.entries(tdStrings)) {
                    const className = this.effTDChildren[child].className;
                    const element = eff.getElementsByClassName(className)[0];
                    element.innerText = text;
                }
            }
        }

        effTimeStrings(current, duration, rate) {
            let effCurrent, effDuration, rateStr;
            if (!rate || rate == 1) {
                effCurrent = current;
                effDuration = duration;
                rateStr = "";
            } else {
                effCurrent = current / rate;
                effDuration = duration / rate;
                rateStr = ` (${rate}x)`;
            }

            const effCurrentStr = this.secsToDisplayFormat(effCurrent);
            const effDurationStr = this.secsToDisplayFormat(effDuration);

            return {
                current: effCurrentStr,
                duration: effDurationStr,
                playbackRate: rateStr
            };
        }

        /**
         * Converts number of seconds to time display format.
         * @param {number} secs Number of seconds to convert.
         * @returns {string} Time formatted as [[[[[d]d:]h]h:]m]m:ss.
         */
        secsToDisplayFormat(secs) {
            let d = Math.floor(secs / 86400);
            secs -= d * 86400;
            let h = Math.floor(secs / 3600);
            secs -= h * 3600;
            let m = Math.floor(secs / 60);
            secs -= m * 60;
            let s = Math.floor(secs);

            const separator = ":";
            let dhSeparator = separator;
            let hmSeparator = separator;
            let msSeparator = separator;

            if (d == 0) { d = dhSeparator = "" };
            if (d == 0 && h == 0) { h = hmSeparator = "" };
            if (h < 10 && d != 0) { h = "0" + h }
            if (m < 10 && (d != 0 || h != 0)) { m = "0" + m };
            if (s < 10) { s = "0" + s };

            return d + dhSeparator + h + hmSeparator + m + msSeparator + s;
        }
    }


    const tweaks = [
        new SaveProgressOnURL(5000),
        new MouseWheelVolumeControl(),
        new MouseWheelPlaybackRateControl(),
        new ModPlaybackRate([]),
        new DefaultPlaybackRate(2),
        new CustomPreferredQuality(QUALITY_LEVELS.FHD),
        new CustomKeyboardShortcuts([]),
        new EffectiveTimeDisplay(),
    ];
    new TweakedYouTubeApp(tweaks);
})();

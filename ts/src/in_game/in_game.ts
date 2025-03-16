import {
  OWGames,
  OWGamesEvents,
  OWHotkeys
} from "@overwolf/overwolf-api-ts";

import { AppWindow } from "../AppWindow";
import { kHotkeys, kWindowNames, kGamesFeatures } from "../consts";

import WindowState = overwolf.windows.WindowStateEx;

// The window displayed in-game while a game is running.
// It listens to all info events and to the game events listed in the consts.ts file
// and writes them to the relevant log using <pre> tags.
// The window also sets up Ctrl+F as the minimize/restore hotkey.
// Like the background window, it also implements the Singleton design pattern.
class InGame extends AppWindow {
  private static _instance: InGame;
  private _gameEventsListener: OWGamesEvents;
  private _eventsLog: HTMLElement;
  private _infoLog: HTMLElement;



  private constructor() {
    super(kWindowNames.inGame);

    this._eventsLog = document.getElementById('eventsLog');
    this._infoLog = document.getElementById('infoLog');

    this.setToggleHotkeyBehavior();
    this.setToggleHotkeyText();

    this.setDebugHotkeyBehavior();
    this.initializeDebugOverlay();
    
    this.initializeTranscriptionOverlay();

    // Listen for messages from background – e.g. “TRANSCRIPTION_RESULT”
    overwolf.windows.onMessageReceived.addListener((message) => {
      switch (message.id) {
        case 'TRANSCRIPTION_RESULT':
          this.displayTranscribedText(message.content?.text || '');
          break;
        case 'CLOSE_OVERLAY':
          this.hideOverlay();
          this.hideCurrentWindow();
          break;
        case 'SHOW_DEBUG':
          // Show debug overlay (or toggle it)
          const debugOverlay = document.getElementById('debug-overlay');
          if (debugOverlay) {
            debugOverlay.style.display = 'block';
          }
          break;
      }
    });
  }

  public static instance() {
    if (!this._instance) {
      this._instance = new InGame();
    }

    return this._instance;
  }

  public async run() {
    const gameClassId = await this.getCurrentGameClassId();

    const gameFeatures = kGamesFeatures.get(gameClassId);

    if (gameFeatures && gameFeatures.length) {
      this._gameEventsListener = new OWGamesEvents(
        {
          onInfoUpdates: this.onInfoUpdates.bind(this),
          onNewEvents: this.onNewEvents.bind(this)
        },
        gameFeatures
      );

      this._gameEventsListener.start();
    }
  }

  
  private onInfoUpdates(info) {
    this.logLine(this._infoLog, info, false);
  }

  // Special events will be highlighted in the event log
  private onNewEvents(e) {
    const shouldHighlight = e.events.some(event => {
      switch (event.name) {
        case 'kill':
        case 'death':
        case 'assist':
        case 'level':
        case 'matchStart':
        case 'match_start':
        case 'matchEnd':
        case 'match_end':
          return true;
      }

      return false
    });
    this.logLine(this._eventsLog, e, shouldHighlight);
  }

  // Displays the toggle minimize/restore hotkey in the window header
  private async setToggleHotkeyText() {
    const gameClassId = await this.getCurrentGameClassId();
    const hotkeyText = await OWHotkeys.getHotkeyText(kHotkeys.toggle, gameClassId);
    const hotkeyElem = document.getElementById('hotkey');
    if (hotkeyElem) {
      hotkeyElem.textContent = hotkeyText;
    }
  }

  // Sets toggleInGameWindow as the behavior for the hotkey
  private async setToggleHotkeyBehavior() {
    const toggleInGameWindow = async (
      hotkeyResult: overwolf.settings.hotkeys.OnPressedEvent
    ): Promise<void> => {
      console.log(`pressed hotkey for ${hotkeyResult.name}`);
      const inGameState = await this.getWindowState();

      if (inGameState.window_state === WindowState.NORMAL ||
        inGameState.window_state === WindowState.MAXIMIZED) {
        this.currWindow.minimize();
      } else if (inGameState.window_state === WindowState.MINIMIZED ||
        inGameState.window_state === WindowState.CLOSED) {
        this.currWindow.restore();
      }
    }

    OWHotkeys.onHotkeyDown(kHotkeys.toggle, toggleInGameWindow);
  }

    // Appends a new line to the specified log
  private logLine(log: HTMLElement, data, highlight) {
    const line = document.createElement('pre');
    line.textContent = JSON.stringify(data);

    if (highlight) {
      line.className = 'highlight';
    }

    // Check if scroll is near bottom
    const shouldAutoScroll =
      log.scrollTop + log.offsetHeight >= log.scrollHeight - 10;

    log.appendChild(line);

    if (shouldAutoScroll) {
      log.scrollTop = log.scrollHeight;
    }

    // Additionally, append to the debug log container
    const debugLog = document.getElementById('debug-log');
    if (debugLog) {
      const debugLine = document.createElement('pre');
      debugLine.textContent = JSON.stringify(data);
      if (highlight) {
        debugLine.className = 'highlight';
      }
      debugLog.appendChild(debugLine);
    }
  }

  private async getCurrentGameClassId(): Promise<number | null> {
    const info = await OWGames.getRunningGameInfo();

    return (info && info.isRunning && info.classId) ? info.classId : null;
  }


  // -------------------------------------------------------------------------
  // Functions for debug hotkey:
  // -------------------------------------------------------------------------

  private setDebugHotkeyBehavior() {
    OWHotkeys.onHotkeyDown(kHotkeys.debug, async (hotkeyResult) => {
      this.logLine(this._eventsLog, { message: `############# Debug hotkey pressed: ${hotkeyResult.name}` }, false);
      console.log(`Debug hotkey pressed: ${hotkeyResult.name}`);
      const debugOverlay = document.getElementById('debug-overlay');
      if (debugOverlay) {
        // Toggle visibility
        debugOverlay.style.display = (debugOverlay.style.display === 'none' || debugOverlay.style.display === '') ? 'block' : 'none';
      }
    });
  }
  
  private initializeDebugOverlay() {
    const closeButton = document.getElementById('close-debug-overlay');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        const debugOverlay = document.getElementById('debug-overlay');
        if (debugOverlay) {
          debugOverlay.style.display = 'none';
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // Overlays
  // -------------------------------------------------------------------------
  private initializeTranscriptionOverlay() {
    const overlay     = document.getElementById('transcription-overlay');
    const acceptBtn   = document.getElementById('accept-button');
    const cancelBtn   = document.getElementById('cancel-button');
    const textElement = document.getElementById('transcribed-text');

    // Hook up buttons to send messages to background
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        // e.g. user accepted the text
        overwolf.windows.sendMessage(kWindowNames.background, 'ACCEPT_CLICKED', {}, (result) => {
          console.log('Message sent:', result);
        });
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        overwolf.windows.sendMessage(kWindowNames.background, 'DISCARD_CLICKED', {}, (result) => {
          console.log('Message sent:', result);
        });
      });
    }
  }

  private hideOverlay() {
    const overlay = document.getElementById('transcription-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Function to hide the window that currently has focus
  private hideCurrentWindow() {
    overwolf.windows.getCurrentWindow(result => {
      if (result && result.window) {
        overwolf.windows.hide(result.window.id);
      }
    });
  }

  public displayTranscribedText(text: string) {
    const overlay     = document.getElementById('transcription-overlay');
    const textElement = document.getElementById('transcribed-text');

    this.currWindow.restore();
    
    if (overlay && textElement) {
      textElement.textContent = text;
      overlay.style.display = 'block';
    }
  }
}

InGame.instance().run();

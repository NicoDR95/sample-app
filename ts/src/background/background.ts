import {
  OWGames,
  OWGameListener,
  OWWindow
} from '@overwolf/overwolf-api-ts';

import { kWindowNames, kGameClassIds } from "../consts";

import RunningGameInfo = overwolf.games.RunningGameInfo;
import AppLaunchTriggeredEvent = overwolf.extensions.AppLaunchTriggeredEvent;

// The background controller holds all of the app's background logic - hence its name. it has
// many possible use cases, for example sharing data between windows, or, in our case,
// managing which window is currently presented to the user. To that end, it holds a dictionary
// of the windows available in the app.
// Our background controller implements the Singleton design pattern, since only one
// instance of it should exist.
class BackgroundController {
  private static _instance: BackgroundController;
  private _windows: Record<string, OWWindow> = {};
  private _gameListener: OWGameListener;

  private constructor() {
    // Populating the background controller's window dictionary
    this._windows[kWindowNames.desktop] = new OWWindow(kWindowNames.desktop);
    this._windows[kWindowNames.inGame] = new OWWindow(kWindowNames.inGame);

    // When a a supported game game is started or is ended, toggle the app's windows
    this._gameListener = new OWGameListener({
      onGameStarted: this.toggleWindows.bind(this),
      onGameEnded: this.toggleWindows.bind(this)
    });

    overwolf.extensions.onAppLaunchTriggered.addListener(
      e => this.onAppLaunchTriggered(e)
    );

    // ********** NEW: Listen for messages ***********
    overwolf.windows.onMessageReceived.addListener((message) => {
      if (message.id === 'SEND_TEXT') {
        const textToSend = message.content && message.content.text || '';
        console.log('[Background] Received SEND_TEXT message:', textToSend);
        this.injectTextIntoLoL(textToSend);
      }
    });
  };

  // Implementing the Singleton design pattern
  public static instance(): BackgroundController {
    if (!BackgroundController._instance) {
      BackgroundController._instance = new BackgroundController();
    }

    return BackgroundController._instance;
  }

  // When running the app, start listening to games' status and decide which window should
  // be launched first, based on whether a supported game is currently running
  public async run() {
    this._gameListener.start();

    const currWindowName = (await this.isSupportedGameRunning())
      ? kWindowNames.inGame
      : kWindowNames.desktop;

    this._windows[currWindowName].restore();
  }

  // -------------------------------------------------------------------------
  // Function for writing transcription to chat:
  // -------------------------------------------------------------------------
  private injectTextIntoLoL(text: string) {
    if (!text || text.trim() === '') {
      console.warn('[Background] Attempted to send empty text.');
      return;
    }
    console.log('[Background] injectTextIntoLoL():', text);

    // Copy text to clipboard
    overwolf.utils.placeOnClipboard(text);

    // Wait briefly for the clipboard to update
    setTimeout(() => {
      overwolf.utils.getFromClipboard((clipboardString) => {
        if (!clipboardString || clipboardString !== text) {
          console.error(`[Background] Clipboard mismatch. Expected: '${text}', got: '${clipboardString}'`);
          return;
        }

        // Now do the keystrokes as normal:
        // (No window hide needed here, because the background window is never in the foreground anyway.)
        setTimeout(() => {
          overwolf.utils.sendKeyStroke('Enter');
          setTimeout(() => {
            overwolf.utils.sendKeyStroke('Ctrl+V');
            setTimeout(() => {
              overwolf.utils.sendKeyStroke('Enter');
            }, 150);
          }, 150);
        }, 50);
      });
    }, 200);
  }
  // ************************************************************

private async onAppLaunchTriggered(e: AppLaunchTriggeredEvent) {
    console.log('onAppLaunchTriggered():', e);

    if (!e || e.origin.includes('gamelaunchevent')) {
      return;
    }

    if (await this.isSupportedGameRunning()) {
      this._windows[kWindowNames.desktop].close();
      this._windows[kWindowNames.inGame].restore();
    } else {
      this._windows[kWindowNames.desktop].restore();
      this._windows[kWindowNames.inGame].close();
    }
  }

  private toggleWindows(info: RunningGameInfo) {
    if (!info || !this.isSupportedGame(info)) {
      return;
    }

    if (info.isRunning) {
      this._windows[kWindowNames.desktop].close();
      this._windows[kWindowNames.inGame].restore();
    } else {
      this._windows[kWindowNames.desktop].restore();
      this._windows[kWindowNames.inGame].close();
    }
  }

  private async isSupportedGameRunning(): Promise<boolean> {
    const info = await OWGames.getRunningGameInfo();

    return info && info.isRunning && this.isSupportedGame(info);
  }

  // Identify whether the RunningGameInfo object we have references a supported game
  private isSupportedGame(info: RunningGameInfo) {
    return kGameClassIds.includes(info.classId);
  }
}

BackgroundController.instance().run();

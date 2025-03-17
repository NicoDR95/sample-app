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


  private constructor() {
    super(kWindowNames.inGame);

    this.setToggleHotkeyBehavior();
    this.setToggleHotkeyText();

    this.initializeTranscriptionOverlay();

    // Listen for messages from background – e.g. “TRANSCRIPTION_RESULT”
    overwolf.windows.onMessageReceived.addListener((message) => {
      switch (message.id) {
        case 'TRANSCRIPTION_RESULT':
          this.displayTranscribedText(message.content?.text || '');
          break;
        case 'CLOSE_OVERLAY':
          this.hideCurrentWindow();
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
    // Note keeping this for future reference and to show how to use the game events listener
    // if (gameFeatures && gameFeatures.length) {
    //   this._gameEventsListener = new OWGamesEvents(
    //     {
    //       onInfoUpdates: this.onInfoUpdates.bind(this),
    //       onNewEvents: this.onNewEvents.bind(this)
    //     },
    //     gameFeatures
    //   );

    //   this._gameEventsListener.start();
    // }
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


  private async getCurrentGameClassId(): Promise<number | null> {
    const info = await OWGames.getRunningGameInfo();

    return (info && info.isRunning && info.classId) ? info.classId : null;
  }



  // -------------------------------------------------------------------------
  // Overlays
  // -------------------------------------------------------------------------
  private initializeTranscriptionOverlay() {
    const acceptBtn   = document.getElementById('accept-button');
    const cancelBtn   = document.getElementById('cancel-button');

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



  // Function to hide the window that currently has focus
  private hideCurrentWindow() {
    overwolf.windows.getCurrentWindow(result => {
      if (result && result.window) {
        overwolf.windows.hide(result.window.id);
      }
    });
  }


  public displayTranscribedText(text: string) {
    console.log('Displaying transcribed text:', text); // Add logging
    const transcribedText = document.getElementById('transcribed-text') as HTMLDivElement;

    this.currWindow.restore();

    if (transcribedText) {
      transcribedText.textContent = text;
      transcribedText.style.display = 'block'; // Ensure visibility
    } else {
      console.error('Element #transcribed-text not found');
    }
  }
}

InGame.instance().run();

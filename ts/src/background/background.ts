import {
  OWGames,
  OWGameListener,
  OWWindow,
  OWHotkeys
} from '@overwolf/overwolf-api-ts';

import { kWindowNames, kGameClassIds, kHotkeys } from '../consts';

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

  // We'll keep a single MediaRecorder for both “record” + push-to-talk
  private mediaRecorder: MediaRecorder | null = null;
  private currentStream: MediaStream | null = null;

  // Keep the last transcription text in a variable so we don't rely on overlay focus:
  private _lastTranscribedText: string;

  private constructor() {
    // Populating the background controller's window dictionary
    this._windows[kWindowNames.desktop] = new OWWindow(kWindowNames.desktop);
    this._windows[kWindowNames.inGame] = new OWWindow(kWindowNames.inGame);
    this._lastTranscribedText = '';

    // When a a supported game game is started or is ended, toggle the app's windows
    this._gameListener = new OWGameListener({
      onGameStarted: this.toggleWindows.bind(this),
      onGameEnded: this.toggleWindows.bind(this)
    });

    overwolf.extensions.onAppLaunchTriggered.addListener(
      e => this.onAppLaunchTriggered(e)
    );

    // Listen for messages from in_game
    overwolf.windows.onMessageReceived.addListener((message) => {
      switch (message.id) {
        case 'ACCEPT_CLICKED':
          this.onAcceptClicked();
          break;
        case 'DISCARD_CLICKED':
          this.onDiscardClicked();
          break;
        case 'START_RECORDING':
          this.startTimedRecording();
          break;
        case 'STOP_RECORDING':
          this.stopRecording();
          break;
        // etc. if you want to handle more
      }
    });

    // Initialize all hotkeys here:
    this.initializeHotkeys();
    // Initialize push-to-talk here:
    this.initializePushToTalk();
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

  // -------------------------------------------------------------------------
  // HOTKEYS + EVENTS
  // -------------------------------------------------------------------------
  private initializeHotkeys() {
    // Accept hotkey:
    OWHotkeys.onHotkeyDown(kHotkeys.accept, (hotkeyResult) => {
      console.log('[Background] Accept hotkey pressed:', hotkeyResult.name);
      // We can handle acceptance logic directly here, or
      this.onAcceptClicked();
    });

    // Discard hotkey:
    OWHotkeys.onHotkeyDown(kHotkeys.discard, (hotkeyResult) => {
      console.log('[Background] Discard hotkey pressed:', hotkeyResult.name);
      this.onDiscardClicked();
    });

    // Record hotkey:
    OWHotkeys.onHotkeyDown(kHotkeys.record, (hotkeyResult) => {
      console.log('[Background] Record hotkey pressed:', hotkeyResult.name);
      this.startTimedRecording();
    });

    // Debug hotkey, etc.:
    OWHotkeys.onHotkeyDown(kHotkeys.debug, (hotkeyResult) => {
      console.log('[Background] Debug hotkey pressed:', hotkeyResult.name);
      // Possibly send a message to in_game to show the debug overlay
      overwolf.windows.sendMessage(kWindowNames.inGame, 'SHOW_DEBUG', {}, (result) => {
        console.log('Message sent:', result);
      }
      );
    });
  }

  // Push-to-talk (onHold):
  private initializePushToTalk() {
    overwolf.settings.hotkeys.onHold.addListener((event: overwolf.settings.hotkeys.OnHoldEvent) => {
      if (event.name === 'push_to_talk') {
        if (event.state === 'down') {
          this.startRecording(true); // Start PTT
        } else if (event.state === 'up') {
          this.stopRecording();      // Stop PTT
        }
      }
    });
  }

  private onAcceptClicked() {
    // sending a "CLOSE_OVERLAY" message to in game window:
    overwolf.windows.sendMessage(kWindowNames.inGame, 'CLOSE_OVERLAY', {}, (result) => {
      console.log('Message sent:', result);
    }
    );

    // Pasta the transcription into LoL chat:
    this.injectTextIntoLoL(this._lastTranscribedText);

  }

  private onDiscardClicked() {
    // Hide overlay, do nothing else
    overwolf.windows.sendMessage(kWindowNames.inGame, 'CLOSE_OVERLAY', {}, (result) => {
      console.log('Message sent:', result);
    });
  }


  // -------------------------------------------------------------------------
  // RECORDING + MEDIARECORDER
  // -------------------------------------------------------------------------
  private startTimedRecording() {
    console.log('[Background] startTimedRecording()');
    this.startRecording(false);

    // If we want a fixed 5-second limit, do:
    setTimeout(() => {
      this.stopRecording();
    }, 5000);
  }

  private async startRecording(isPushToTalk: boolean) {
    console.log(`[Background] startRecording (PTT? ${isPushToTalk})`);

    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        console.warn('[Background] Already recording!');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.currentStream = stream;
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = async (event) => {
        const audioBlob = event.data;
        await this.sendAudioToBackend(audioBlob);
      };
      this.mediaRecorder.start();
      console.log('[Background] Recording started!');
    } catch (error) {
      console.error('[Background] Error starting recording:', error);
    }
  }

  private stopRecording() {
    if (!this.mediaRecorder) {
      return;
    }
    if (this.mediaRecorder.state === 'inactive') {
      return;
    }

    this.mediaRecorder.stop();
    console.log('[Background] Recording stopped.');

    // Release the mic stream:
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
    }
    this.currentStream = null;
    this.mediaRecorder = null;
  }

  // -------------------------------------------------------------------------
  // SENDING AUDIO -> PYTHON BACKEND
  // -------------------------------------------------------------------------
  private async sendAudioToBackend(audioBlob: Blob) {
    console.log('[Background] sendAudioToBackend() called');

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');

      const response = await fetch('http://localhost:5000/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const transcription = data.transcription || '';
        console.log('[Background] Transcription result:', transcription);

        // Save transcription for later use
        this._lastTranscribedText = transcription;

        // Now send a message to in_game to show the text overlay
        overwolf.windows.sendMessage(
          kWindowNames.inGame,
          'TRANSCRIPTION_RESULT',
          { text: transcription },
          (result) => {
            console.log('Message sent:', result);
          }
        );

      } else {
        console.error('[Background] Error from backend:', response.statusText);
      }
    } catch (error) {
      console.error('[Background] Error sending audio to backend:', error);
    }
  }

  // -------------------------------------------------------------------------
  // INJECT TEXT INTO LOL
  // -------------------------------------------------------------------------
  private injectTextIntoLoL(text: string) {
    if (!text || text.trim() === '') {
      console.warn('[Background] Attempted to send empty text.');
      return;
    }
    console.log('[Background] injectTextIntoLoL():', text);

    overwolf.utils.placeOnClipboard(text);
    setTimeout(() => {
      overwolf.utils.getFromClipboard((clipboardString) => {
        if (!clipboardString || clipboardString !== text) {
          console.error(`[Background] Clipboard mismatch. Expected: '${text}', got: '${clipboardString}'`);
          return;
        }

        // Because the background is never in the foreground, we can inject quickly:
        setTimeout(() => {
          overwolf.utils.sendKeyStroke('Enter');
          setTimeout(() => {
            overwolf.utils.sendKeyStroke('Ctrl+V');
            setTimeout(() => {
              overwolf.utils.sendKeyStroke('Enter');
            }, 200);
          }, 200);
        }, 200);
      });
    }, 200);
  }
}

BackgroundController.instance().run();

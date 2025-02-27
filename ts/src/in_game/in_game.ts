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
  private mediaRecorder: MediaRecorder;

  private constructor() {
    console.log('###### InGame constructor called ####');
    super(kWindowNames.inGame);

    this._eventsLog = document.getElementById('eventsLog');
    this._infoLog = document.getElementById('infoLog');

    this.setToggleHotkeyBehavior();
    this.setToggleHotkeyText();

    this.setDebugHotkeyBehavior();
    this.initializeDebugOverlay();
    
    // Add event listeners after the DOM is loaded
    // document.addEventListener('DOMContentLoaded', () => {
    //   this.initializeTranscriptionOverlay();
    //   this.initializeRecording();
    // });

    // Directly call the initialization methods
    this.initializeTranscriptionOverlay();
    this.initializeRecording();
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




  // Initialize the transcription overlay
  private initializeTranscriptionOverlay() {
    const overlay = document.getElementById('transcription-overlay');
    const acceptButton = document.getElementById('accept-button');
    const cancelButton = document.getElementById('cancel-button');
    const textElement = document.getElementById('transcribed-text');

    if (acceptButton && cancelButton && textElement && overlay) {
      acceptButton.addEventListener('click', () => {
        const text = textElement.textContent;
        this.sendTextToChat(text);
        this.hideOverlay();
      });

      cancelButton.addEventListener('click', () => {
        this.hideOverlay();
      });
    } else {
      console.error('Transcription overlay elements not found');
    }
  }

  // Method to display the transcribed text
  public displayTranscribedText(text: string) {
    const overlay = document.getElementById('transcription-overlay');
    const textElement = document.getElementById('transcribed-text');
    if (overlay && textElement) {
      textElement.textContent = text;
      overlay.style.display = 'block';
    } else {
      console.error('Overlay or text element not found');
    }
  }

  private hideOverlay() {
    const overlay = document.getElementById('transcription-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Send text to the in-game chat
  private sendTextToChat(text: string) {
    // Ensure the text is not empty
    if (text && text.trim() !== '') {
      try {
        // Place the text onto the clipboard
        overwolf.utils.placeOnClipboard(text);
  
        // Proceed with sending the text
        overwolf.utils.sendKeyStroke('Enter');
  
        setTimeout(() => {
          overwolf.utils.sendKeyStroke('Ctrl+V');
  
          setTimeout(() => {
            overwolf.utils.sendKeyStroke('Enter');
          }, 100);
        }, 100);
      } catch (error) {
        console.error('Error placing text on clipboard:', error);
      }
    } else {
      console.warn('Attempted to send empty text to chat');
    }
  }

  // Initialize recording functionality
  private initializeRecording() {
    console.log('%c initializeRecording called', 'background: yellow; color: black; font-weight: bold;');

    OWHotkeys.onHotkeyDown(kHotkeys.record, (hotkeyResult) => {
      console.log('Start Recording hotkey pressed:', hotkeyResult);
      this.logLine(this._eventsLog, { message: `############# Start Recording hotkey pressed: ${hotkeyResult}` }, false);

      this.startRecording();
    });
  }

  // Function to start audio recording
  private async startRecording() {
    console.log('startRecording called');
    this.logLine(this._eventsLog, { message: 'Recording is starting...' }, false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = async (event) => {
        const audioBlob = event.data;
        // Send the audio blob to the Python backend
        await this.sendAudioToBackend(audioBlob);
      };

      this.mediaRecorder.start();

      // Stop recording after a certain duration or when the key is released
      setTimeout(() => {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
          this.logLine(this._eventsLog, { message: 'Recording stopped' }, false);
        }
      }, 5000); // Record for 5 seconds
    } catch (error) {
      console.error('Error starting audio recording:', error);
      this.logLine(this._eventsLog, { message: `Error starting audio recording: ${error}` }, true);
    }
  }

  private async sendAudioToBackend(audioBlob: Blob) {
    console.log('sendAudioToBackend called');
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');

      const response = await fetch('http://localhost:5000/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        // Call the method to display the transcribed text
        this.displayTranscribedText(data.transcription);
      } else {
        console.error('Error from backend:', response.statusText);
      }
    } catch (error) {
      console.error('Error sending audio to backend:', error);
    }
  }
}

InGame.instance().run();

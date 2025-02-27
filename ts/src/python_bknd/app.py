# app.py
from flask import Flask, request, jsonify
import whisper
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

model = whisper.load_model("base")  # You can choose a different model size

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    audio_file.save('temp_audio.webm')

    # Convert webm to wav if necessary
    # Use ffmpeg or pydub to handle conversion if Whisper requires it

    result = model.transcribe('temp_audio.webm')
    transcription = result['text']

    return jsonify({'transcription': transcription})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)

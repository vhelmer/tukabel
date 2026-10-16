#!/usr/bin/env python3
"""Local technical demo: eSpeak NG Slovak WAV, no network or paid API.
Requires libespeak-ng (system library); production only needs the resulting WAV.
"""
import ctypes
import ctypes.util
from pathlib import Path
import wave

TEXT = 'Ahoj. Mrkám a rozprávam. Oči a ústa fungujú nezávisle.'
ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'src/assets/speech/animation-demo'


def generate():
    lib = ctypes.CDLL(ctypes.util.find_library('espeak-ng'))
    sample_rate = lib.espeak_Initialize(2, 0, None, 0)
    if sample_rate <= 0:
        raise RuntimeError('eSpeak NG initialization failed')
    samples = []
    callback_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)

    @callback_type
    def collect(data, count, _events):
        if data and count:
            samples.append(ctypes.string_at(data, count * 2))
        return 0

    lib.espeak_SetSynthCallback(collect)
    if lib.espeak_SetVoiceByName(b'sk'):
        raise RuntimeError('Install the eSpeak NG Slovak voice')
    lib.espeak_SetParameter(1, 145, 0)
    text = TEXT.encode('utf8') + b'\0'
    if lib.espeak_Synth(text, len(text), 0, 1, 0, 1, None, None):
        raise RuntimeError('Speech synthesis failed')
    lib.espeak_Synchronize()
    DEST.mkdir(parents=True, exist_ok=True)
    with wave.open(str(DEST / 'audio.wav'), 'wb') as output:
        output.setparams((1, 2, sample_rate, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(samples))
    lib.espeak_Terminate()
    print(TEXT)
    print(DEST / 'audio.wav')


if __name__ == '__main__':
    generate()

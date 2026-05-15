"""faster-whisper をローカルで HTTP サーバとして動かす。

エンドポイント:
  POST /transcribe   multipart/form-data file=<audio>
                     → { "text": "...", "language": "...", "duration": 1.23 }
  GET  /health       → { "ok": true, "model": "small", "device": "cpu" }

Chrome拡張から localhost:9000 で叩く前提。
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from faster_whisper import WhisperModel

LOG = logging.getLogger("whisper-server")

DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "small")
DEFAULT_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
DEFAULT_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
DEFAULT_LANG = os.environ.get("WHISPER_LANGUAGE", "ja")
DEFAULT_PORT = int(os.environ.get("WHISPER_PORT", "9000"))


def build_app(model: WhisperModel, default_language: str) -> FastAPI:
    app = FastAPI(title="meeting-extension whisper server", version="1.0.0")

    # Chrome拡張は chrome-extension:// オリジン。 * で許可しても自前ローカル限定。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health():
        return {
            "ok": True,
            "model": DEFAULT_MODEL,
            "device": DEFAULT_DEVICE,
            "compute": DEFAULT_COMPUTE,
            "language": default_language,
        }

    @app.post("/transcribe")
    async def transcribe(file: UploadFile = File(...), language: str | None = None):
        if not file:
            raise HTTPException(status_code=400, detail="file is required")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="empty audio")

        suffix = Path(file.filename or "audio.webm").suffix or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fp:
            fp.write(data)
            tmp_path = fp.name

        try:
            start = time.time()
            segments_iter, info = model.transcribe(
                tmp_path,
                language=language or default_language,
                vad_filter=True,
                beam_size=1,
                temperature=0.0,
                without_timestamps=True,
            )
            texts: list[str] = []
            for segment in segments_iter:
                if segment.text:
                    texts.append(segment.text.strip())
            elapsed = time.time() - start
            return {
                "text": " ".join(t for t in texts if t),
                "language": info.language,
                "duration": info.duration,
                "elapsed": elapsed,
            }
        finally:
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass

    return app


def main():
    parser = argparse.ArgumentParser(description="faster-whisper local HTTP server")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="model name (tiny/base/small/medium/large-v3)")
    parser.add_argument("--compute", default=DEFAULT_COMPUTE, help="int8 / int8_float16 / float16 / float32")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="cpu / cuda / auto")
    parser.add_argument("--language", default=DEFAULT_LANG, help="default language hint")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    LOG.info("loading whisper model: %s (compute=%s, device=%s)", args.model, args.compute, args.device)
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute)
    LOG.info("model ready")

    app = build_app(model, args.language)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    sys.exit(main())

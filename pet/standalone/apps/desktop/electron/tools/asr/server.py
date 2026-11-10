#!/usr/bin/env python3
"""Local ASR server for Cyrene (faster-whisper, OpenAI-compatible).

Why this exists
---------------
The desktop app can wake on a spoken keyword. Cloud ASR works out of the box
but sends audio off the machine; this server keeps everything local.

Contract
--------
GET  /health                    -> {"ok": true, "model": ..., "device": ...}
POST /v1/audio/transcriptions   -> {"text": "..."}   (multipart/form-data)

The transcript endpoint is shaped like OpenAI's so the Electron side can use
one code path for both backends.

Run
---
    python server.py
    python server.py --port 8123 --model small --device cpu --compute-type int8

First run downloads the model from HuggingFace. Set HF_ENDPOINT to use a
mirror:  set HF_ENDPOINT=https://hf-mirror.com
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import threading

try:
    from fastapi import FastAPI, File, Form, UploadFile
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:  # pragma: no cover - guidance beats a traceback
    print("Missing dependencies. Run: pip install -r requirements.txt", file=sys.stderr)
    raise

MODEL_NAME = os.environ.get("CYRENE_ASR_MODEL", "small")
DEVICE = os.environ.get("CYRENE_ASR_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("CYRENE_ASR_COMPUTE", "int8")
DEFAULT_LANG = os.environ.get("CYRENE_ASR_LANG", "zh")
# 模型缓存目录：install.ps1 下到 %LOCALAPPDATA%，这里读回来。
# 为空时退回 HuggingFace 默认缓存。
MODEL_DIR = os.environ.get("CYRENE_ASR_MODEL_DIR") or None

app = FastAPI(title="Cyrene Local ASR", version="1.0")

_model = None
_model_lock = threading.Lock()


def local_snapshot_path():
    """找到已下载的模型快照目录，直接当本地模型路径用。

    为什么绕这一层：把 "small" 交给 WhisperModel 时它会去 Hub 问一次 revision，
    断网或连不上就抛 ConnectTimeout，哪怕文件明明已经在硬盘上。
    先认出本地快照就能彻底离线启动。
    """
    if not MODEL_DIR:
        return None
    repo = "models--Systran--faster-whisper-" + MODEL_NAME.replace("/", "--")
    root = os.path.join(MODEL_DIR, repo)
    revision = None
    try:
        with open(os.path.join(root, "refs", "main"), "r", encoding="utf-8") as handle:
            revision = handle.read().strip()
    except OSError:
        revision = None
    snapshots = os.path.join(root, "snapshots")
    for candidate in ([os.path.join(snapshots, revision)] if revision else []) + [snapshots]:
        if not os.path.isdir(candidate):
            continue
        if os.path.basename(candidate) == "snapshots":
            entries = [os.path.join(candidate, name) for name in sorted(os.listdir(candidate))]
            entries = [item for item in entries if os.path.isdir(item)]
            if not entries:
                continue
            return entries[-1]
        return candidate
    return None


def get_model():
    """Load lazily: the process must answer /health before the model is ready,
    otherwise the desktop app gives up on a cold start."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            local = local_snapshot_path()
            target = local or MODEL_NAME
            print(
                f"[asr] model_dir={MODEL_DIR} local={local}",
                flush=True,
            )
            print(
                f"[asr] loading model={target} device={DEVICE} compute={COMPUTE_TYPE}",
                flush=True,
            )
            _model = WhisperModel(
                target,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
                download_root=MODEL_DIR,
            )
            print("[asr] model ready", flush=True)
    return _model


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "loaded": _model is not None,
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(default=""),
    prompt: str = Form(default=""),
):
    raw = await file.read()
    if not raw:
        return JSONResponse({"error": "empty audio"}, status_code=400)

    suffix = os.path.splitext(file.filename or "clip.wav")[1] or ".wav"
    handle, temp_path = tempfile.mkstemp(suffix=suffix)
    os.close(handle)
    try:
        with open(temp_path, "wb") as out:
            out.write(raw)
        model = get_model()
        segments, info = model.transcribe(
            temp_path,
            language=(language.strip() or DEFAULT_LANG),
            beam_size=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            initial_prompt=(prompt.strip() or None),
        )
        text = "".join(segment.text for segment in segments).strip()
        return {
            "text": text,
            "language": getattr(info, "language", None),
            "duration": getattr(info, "duration", None),
        }
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


def main() -> None:
    global MODEL_NAME, DEVICE, COMPUTE_TYPE
    parser = argparse.ArgumentParser(description="Cyrene local ASR server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CYRENE_ASR_PORT", "8123")))
    parser.add_argument("--model", default=MODEL_NAME)
    parser.add_argument("--device", default=DEVICE)
    parser.add_argument("--compute-type", default=COMPUTE_TYPE)
    args = parser.parse_args()

    MODEL_NAME, DEVICE, COMPUTE_TYPE = args.model, args.device, args.compute_type

    print(f"[asr] listening on http://{args.host}:{args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

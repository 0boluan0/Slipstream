# Local formula OCR components

Slipstream source is MIT licensed. Bundled third-party models and runtime retain their own licenses.

- PP-DocLayoutV3 ONNX, PaddlePaddle, Apache License 2.0. Unmodified model from https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_onnx at revision 46bbdf188bb0a772c08aed74882ce7e51a8f1ea6. Renamed inference.onnx to detector.onnx. License: PP-DocLayoutV3-Apache-2.0.txt. Upstream project: https://github.com/PaddlePaddle/PaddleX.
- Pix2Text MFR 1.5 encoder, decoder and tokenizer, Copyright (c) 2022 BreezeDeus, MIT License. Unmodified files from https://huggingface.co/breezedeus/pix2text-mfr-1.5 at revision 1cef9f0bdcd6a4c63df7de1311fb0894593340cc. Renamed ONNX files to encoder.onnx and decoder.onnx. License: Pix2Text-MIT.txt. Upstream project: https://github.com/breezedeus/Pix2Text.
- ONNX Runtime 1.18.0, Microsoft Corporation, MIT License. License: ONNX-Runtime-MIT.txt. Bundled dependency notices: ONNX-Runtime-ThirdPartyNotices.txt. https://github.com/microsoft/onnxruntime.

Model URLs and SHA-256 checksums are pinned in src/main/local-formula-models.json. Installation includes these notices; no screenshot is sent to model publishers.

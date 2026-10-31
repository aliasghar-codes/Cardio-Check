import base64
import cv2
import numpy as np
import torch
from transformers import AutoModel

# load the model once, when this file is first imported
model = AutoModel.from_pretrained("ianpan/chest-x-ray-basic", trust_remote_code=True)
model.eval()


def _png(arr):
    """numpy image -> PNG data URL the browser can show"""
    _, buf = cv2.imencode(".png", arr)
    return "data:image/png;base64," + base64.b64encode(buf).decode()


def analyze(image_bytes):
    """Takes the raw bytes of an X-ray image and returns the results as a dictionary.
    Raises ValueError with a friendly message if the image can't be used."""

    data = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Could not read this image")

    x = model.preprocess(img)
    x = torch.from_numpy(x).unsqueeze(0).unsqueeze(0).float()

    with torch.inference_mode():
        out = model(x)

    view = ["AP", "PA", "Lateral"][out["view"].argmax(1).item()]
    if view == "Lateral":
        raise ValueError("This is a side-view X-ray. Please upload a front-view chest X-ray.")

    # 1 = right lung, 2 = left lung, 3 = heart
    mask = out["mask"].argmax(1)[0].numpy()
    heart = mask == 3
    lungs = (mask == 1) | (mask == 2)

    if not heart.any() or not lungs.any():
        raise ValueError("Heart or lungs not found. Use a front-view chest X-ray.")

    # Horizontal spans of the heart and lung masks. Lung width stands in for the
    # inner rib width, so this approximates the clinical cardiothoracic ratio.
    _, lx = np.where(lungs)
    _, hx = np.where(heart)

    lung_width = int(lx.max() - lx.min())
    heart_width = int(hx.max() - hx.min())

    if lung_width <= 0:
        raise ValueError("Could not measure the lung segmentation.")

    ctr = round(heart_width / lung_width, 2)
    result = "Possible cardiomegaly" if ctr > 0.5 else "Normal heart size"

    # plain X-ray (no overlay)
    base = x[0, 0].numpy()
    base = (base - base.min()) / (base.max() - base.min() + 1e-8)
    base = (base * 255).astype(np.uint8)
    h, w = base.shape

    row = int(np.where(heart)[0].mean())
    heart_line = ((int(hx.min()), row), (int(hx.max()), row))
    chest_line = ((int(lx.min()), row + 12), (int(lx.max()), row + 12))

    # two transparent layers, so the page can show or hide each one
    heart_layer = np.zeros((h, w, 4), np.uint8)
    heart_layer[heart] = (0, 0, 255, 128)  # BGRA: red, half transparent
    lines_layer = np.zeros((h, w, 4), np.uint8)
    cv2.line(lines_layer, *heart_line, (0, 255, 255, 255), 2)  # yellow
    cv2.line(lines_layer, *chest_line, (255, 255, 0, 255), 2)  # cyan

    # full picture with everything drawn in (used by the hero image)
    pic = cv2.cvtColor(base, cv2.COLOR_GRAY2BGR)
    red = pic.copy()
    red[heart] = (0, 0, 255)
    pic = cv2.addWeighted(red, 0.5, pic, 0.5, 0)
    cv2.line(pic, *heart_line, (0, 255, 255), 2)
    cv2.line(pic, *chest_line, (255, 255, 0), 2)

    return {
        "view": view,
        "heart_width": heart_width,
        "chest_width": lung_width,
        "ctr": round(ctr, 2),
        "result": result,
        "image": _png(pic),
        "base": _png(base),
        "heart_layer": _png(heart_layer),
        "lines_layer": _png(lines_layer),
    }
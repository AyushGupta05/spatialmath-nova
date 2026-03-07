#!/usr/bin/env python3
"""
Train a TensorFlow gesture classifier for SpatialMath Nova hand signals.

Gesture classes/signals:
- pinch_place        -> Pinch (thumb + index) = place object
- fist_delete        -> Fist = delete object
- open_palm_cycle    -> Open palm = cycle shape
- peace_draw         -> Two fingers (peace) = draw lines
- point_rotate       -> Point (index finger) = rotate object
- neutral_cancel     -> Flat open palm held still = cancel/neutral

This trainer builds synthetic landmark data (21 hand keypoints x/y/z),
trains a compact MLP, and exports:
- model (Keras format)
- labels JSON
- metrics JSON
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import tensorflow as tf

GESTURES = [
    "pinch_place",
    "fist_delete",
    "open_palm_cycle",
    "peace_draw",
    "point_rotate",
    "neutral_cancel",
]


@dataclass
class PoseSpec:
    thumb_open: float
    index_open: float
    middle_open: float
    ring_open: float
    pinky_open: float
    spread: float
    palm_flatness: float


def _base_hand_template() -> np.ndarray:
    # 21 landmarks in MediaPipe Hands ordering (x, y, z)
    pts = np.zeros((21, 3), dtype=np.float32)

    # wrist
    pts[0] = [0.0, 0.0, 0.0]

    # MCP anchors (approximate)
    pts[5] = [0.18, 0.18, 0.0]   # index mcp
    pts[9] = [0.03, 0.22, 0.0]   # middle mcp
    pts[13] = [-0.12, 0.20, 0.0] # ring mcp
    pts[17] = [-0.24, 0.15, 0.0] # pinky mcp

    # thumb base chain anchors
    pts[1] = [0.12, 0.05, -0.01]
    pts[2] = [0.20, 0.02, -0.01]
    pts[3] = [0.27, 0.04, -0.015]
    pts[4] = [0.33, 0.08, -0.02]
    return pts


def _set_finger_chain(pts: np.ndarray, mcp: int, pip: int, dip: int, tip: int, openness: float, x_shift: float = 0.0) -> None:
    # openness in [0,1] where 1 is straight/open, 0 is folded near palm.
    base = pts[mcp].copy()
    open_vec = np.array([x_shift, 0.30, -0.01], dtype=np.float32)
    fold_vec = np.array([x_shift * 0.4, 0.07, 0.03], dtype=np.float32)

    v = fold_vec * (1.0 - openness) + open_vec * openness
    pts[pip] = base + v * 0.42
    pts[dip] = base + v * 0.72
    pts[tip] = base + v * 1.00


def synthesize_pose(spec: PoseSpec) -> np.ndarray:
    pts = _base_hand_template()

    # thumb (manual for better pinch control)
    thumb_dir_open = np.array([0.23, 0.15, -0.02], dtype=np.float32)
    thumb_dir_fold = np.array([0.12, 0.03, 0.02], dtype=np.float32)
    tdir = thumb_dir_fold * (1.0 - spec.thumb_open) + thumb_dir_open * spec.thumb_open
    pts[2] = pts[1] + tdir * 0.35
    pts[3] = pts[1] + tdir * 0.65
    pts[4] = pts[1] + tdir * 1.00

    _set_finger_chain(pts, 5, 6, 7, 8, spec.index_open, x_shift=0.03)
    _set_finger_chain(pts, 9, 10, 11, 12, spec.middle_open, x_shift=0.0)
    _set_finger_chain(pts, 13, 14, 15, 16, spec.ring_open, x_shift=-0.02)
    _set_finger_chain(pts, 17, 18, 19, 20, spec.pinky_open, x_shift=-0.03)

    # spread effect between fingers
    spread = spec.spread
    for i, mult in [(8, 1.4), (12, 0.5), (16, -0.5), (20, -1.2)]:
        pts[i, 0] += spread * mult * 0.06

    # palm flatness: smaller variance on z when flat
    z_scale = max(0.004, 0.024 * (1.0 - spec.palm_flatness))
    pts[:, 2] += np.random.normal(0.0, z_scale, size=(21,)).astype(np.float32)

    # random rigid-ish transforms for augmentation
    scale = np.random.uniform(0.85, 1.15)
    theta = np.random.uniform(-0.35, 0.35)
    rot = np.array(
        [[np.cos(theta), -np.sin(theta), 0.0], [np.sin(theta), np.cos(theta), 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float32,
    )
    pts = (pts @ rot.T) * scale
    pts += np.random.normal(0.0, 0.008, size=pts.shape).astype(np.float32)

    # tiny translation jitter
    pts[:, 0] += np.random.uniform(-0.03, 0.03)
    pts[:, 1] += np.random.uniform(-0.03, 0.03)

    return pts


def class_specs() -> Dict[str, PoseSpec]:
    return {
        "pinch_place": PoseSpec(thumb_open=0.75, index_open=0.65, middle_open=0.95, ring_open=0.95, pinky_open=0.95, spread=0.30, palm_flatness=0.55),
        "fist_delete": PoseSpec(thumb_open=0.20, index_open=0.08, middle_open=0.05, ring_open=0.05, pinky_open=0.08, spread=0.05, palm_flatness=0.35),
        "open_palm_cycle": PoseSpec(thumb_open=0.95, index_open=0.98, middle_open=0.98, ring_open=0.98, pinky_open=0.98, spread=0.60, palm_flatness=0.90),
        "peace_draw": PoseSpec(thumb_open=0.35, index_open=0.98, middle_open=0.98, ring_open=0.10, pinky_open=0.10, spread=0.70, palm_flatness=0.70),
        "point_rotate": PoseSpec(thumb_open=0.30, index_open=0.99, middle_open=0.12, ring_open=0.10, pinky_open=0.10, spread=0.30, palm_flatness=0.60),
        "neutral_cancel": PoseSpec(thumb_open=0.92, index_open=0.94, middle_open=0.94, ring_open=0.94, pinky_open=0.94, spread=0.45, palm_flatness=0.98),
    }


def post_adjust_for_class(name: str, pts: np.ndarray) -> np.ndarray:
    # Fine gesture-specific geometry adjustments.
    if name == "pinch_place":
        # pull thumb tip near index tip for pinch
        mid = (pts[4] + pts[8]) * 0.5
        pts[4] = mid + np.random.normal(0.0, 0.008, size=3)
        pts[8] = mid + np.random.normal(0.0, 0.008, size=3)
    elif name == "neutral_cancel":
        # flatter open palm: fingertips more level in y
        y_target = np.mean([pts[8, 1], pts[12, 1], pts[16, 1], pts[20, 1]])
        for idx in [8, 12, 16, 20]:
            pts[idx, 1] = 0.7 * pts[idx, 1] + 0.3 * y_target
    return pts


def normalize_landmarks(pts: np.ndarray) -> np.ndarray:
    # translation-invariant by wrist, scale-invariant by palm size
    wrist = pts[0].copy()
    centered = pts - wrist
    palm_scale = np.linalg.norm(pts[9] - pts[0]) + 1e-6
    centered /= palm_scale
    return centered.reshape(-1)


def make_dataset(samples_per_class: int, seed: int = 42) -> Tuple[np.ndarray, np.ndarray]:
    np.random.seed(seed)
    specs = class_specs()

    xs: List[np.ndarray] = []
    ys: List[int] = []

    for class_idx, g in enumerate(GESTURES):
        spec = specs[g]
        for _ in range(samples_per_class):
            pts = synthesize_pose(spec)
            pts = post_adjust_for_class(g, pts)
            xs.append(normalize_landmarks(pts))
            ys.append(class_idx)

    x = np.stack(xs).astype(np.float32)
    y = np.array(ys, dtype=np.int32)

    # shuffle
    order = np.random.permutation(len(y))
    return x[order], y[order]


def split_dataset(x: np.ndarray, y: np.ndarray, train_ratio=0.7, val_ratio=0.15):
    n = len(y)
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)

    x_train, y_train = x[:n_train], y[:n_train]
    x_val, y_val = x[n_train : n_train + n_val], y[n_train : n_train + n_val]
    x_test, y_test = x[n_train + n_val :], y[n_train + n_val :]
    return (x_train, y_train), (x_val, y_val), (x_test, y_test)


def build_model(input_dim: int, num_classes: int) -> tf.keras.Model:
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(input_dim,)),
            tf.keras.layers.Dense(192, activation="relu"),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Dropout(0.20),
            tf.keras.layers.Dense(96, activation="relu"),
            tf.keras.layers.Dropout(0.15),
            tf.keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def train(args):
    x, y = make_dataset(samples_per_class=args.samples_per_class, seed=args.seed)
    (x_train, y_train), (x_val, y_val), (x_test, y_test) = split_dataset(x, y)

    model = build_model(input_dim=x.shape[1], num_classes=len(GESTURES))

    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", mode="max", patience=8, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=4, min_lr=1e-5),
    ]

    history = model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=args.epochs,
        batch_size=args.batch_size,
        verbose=1,
        callbacks=callbacks,
    )

    test_loss, test_acc = model.evaluate(x_test, y_test, verbose=0)

    os.makedirs(args.output_dir, exist_ok=True)
    model_path = os.path.join(args.output_dir, "gesture_signal_model.keras")
    labels_path = os.path.join(args.output_dir, "gesture_labels.json")
    metrics_path = os.path.join(args.output_dir, "gesture_train_metrics.json")

    model.save(model_path)

    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump({"labels": GESTURES}, f, indent=2)

    metrics = {
        "samples_total": int(len(y)),
        "samples_per_class": int(args.samples_per_class),
        "test_loss": float(test_loss),
        "test_accuracy": float(test_acc),
        "best_val_accuracy": float(max(history.history.get("val_accuracy", [0.0]))),
        "epochs_ran": int(len(history.history.get("loss", []))),
    }

    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print("Training complete")
    print(json.dumps(metrics, indent=2))
    print(f"Saved model: {model_path}")
    print(f"Saved labels: {labels_path}")
    print(f"Saved metrics: {metrics_path}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples-per-class", type=int, default=2200)
    p.add_argument("--epochs", type=int, default=45)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--output-dir", default="models/tf_gesture")
    args = p.parse_args()
    train(args)


if __name__ == "__main__":
    main()

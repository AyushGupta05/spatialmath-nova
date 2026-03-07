#!/usr/bin/env python3
"""
Stress-test TensorFlow gesture signal model under noisy synthetic perturbations.

Loads model + labels produced by tools/train_gesture_model_tf.py and evaluates
accuracy by class plus confusion matrix under increasing noise/occlusion.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Dict, List

import numpy as np
import tensorflow as tf

from train_gesture_model_tf import GESTURES, class_specs, synthesize_pose, post_adjust_for_class, normalize_landmarks


def generate_stress_samples(per_class: int, noise_scale: float, occlusion_prob: float, seed: int):
    np.random.seed(seed)
    xs = []
    ys = []

    for class_idx, gesture in enumerate(GESTURES):
        spec = class_specs()[gesture]
        for _ in range(per_class):
            pts = synthesize_pose(spec)
            pts = post_adjust_for_class(gesture, pts)

            # additive landmark noise
            pts += np.random.normal(0.0, noise_scale, size=pts.shape).astype(np.float32)

            # random partial occlusion/dropout simulation
            for i in range(21):
                if np.random.rand() < occlusion_prob:
                    pts[i] += np.random.normal(0.0, noise_scale * 2.2, size=(3,)).astype(np.float32)

            xs.append(normalize_landmarks(pts))
            ys.append(class_idx)

    x = np.stack(xs).astype(np.float32)
    y = np.array(ys, dtype=np.int32)
    return x, y


def confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray, n_classes: int) -> np.ndarray:
    cm = np.zeros((n_classes, n_classes), dtype=np.int32)
    for t, p in zip(y_true, y_pred):
        cm[int(t), int(p)] += 1
    return cm


def run_stress(model_path: str, labels_path: str, per_class: int, seed: int):
    model = tf.keras.models.load_model(model_path)
    labels = GESTURES
    if os.path.exists(labels_path):
        with open(labels_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            labels = data.get("labels", GESTURES)

    scenarios = [
        {"name": "mild", "noise": 0.010, "occlusion": 0.03},
        {"name": "moderate", "noise": 0.020, "occlusion": 0.08},
        {"name": "aggressive", "noise": 0.030, "occlusion": 0.14},
    ]

    report: Dict[str, object] = {"scenarios": []}

    for i, sc in enumerate(scenarios):
        x, y = generate_stress_samples(
            per_class=per_class,
            noise_scale=sc["noise"],
            occlusion_prob=sc["occlusion"],
            seed=seed + i * 11,
        )
        probs = model.predict(x, verbose=0)
        pred = np.argmax(probs, axis=1)

        acc = float(np.mean(pred == y))
        cm = confusion_matrix(y, pred, len(labels))

        class_acc = {}
        for class_idx, name in enumerate(labels):
            row = cm[class_idx]
            denom = int(np.sum(row))
            class_acc[name] = float((row[class_idx] / denom) if denom else 0.0)

        report["scenarios"].append(
            {
                "name": sc["name"],
                "noise": sc["noise"],
                "occlusion": sc["occlusion"],
                "accuracy": acc,
                "class_accuracy": class_acc,
                "confusion_matrix": cm.tolist(),
            }
        )

    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="models/tf_gesture/gesture_signal_model.keras")
    p.add_argument("--labels", default="models/tf_gesture/gesture_labels.json")
    p.add_argument("--per-class", type=int, default=1200)
    p.add_argument("--seed", type=int, default=123)
    p.add_argument("--out", default="models/tf_gesture/gesture_stress_report.json")
    args = p.parse_args()

    report = run_stress(args.model, args.labels, args.per_class, args.seed)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))
    print(f"Saved stress report: {args.out}")


if __name__ == "__main__":
    main()

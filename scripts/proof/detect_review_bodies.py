"""Offline Torchvision person-detection baseline; no puck/identity claims."""
import argparse
import hashlib
import json
from pathlib import Path
import torch
import torchvision
from PIL import Image
from torchvision.models.detection import fasterrcnn_resnet50_fpn_v2, FasterRCNN_ResNet50_FPN_V2_Weights


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('landmarks', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    manifest = json.loads((args.landmarks/'index.json').read_bytes())
    weights = FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT
    torch.set_num_threads(4)
    model = fasterrcnn_resnet50_fpn_v2(weights=weights).eval()
    frames = []
    with torch.inference_mode():
        for f in manifest['frames']:
            path = args.landmarks/f['file']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == f['sha256']
            image = Image.open(path).convert('RGB')
            prediction = model([weights.transforms()(image)])[0]
            boxes = []
            for b, score, label in zip(prediction['boxes'], prediction['scores'], prediction['labels']):
                if int(label) != 1 or float(score) < .5:
                    continue
                x1, y1, x2, y2 = b.tolist()
                boxes.append(dict(x=x1/image.width, y=y1/image.height,
                                  width=(x2-x1)/image.width, height=(y2-y1)/image.height,
                                  detector_score=float(score)))
            frames.append(dict(f, bodies=boxes, possession_status='unknown_no_video_puck_or_stick_detection'))
            print(f"{f['file']}: {len(boxes)} person detections", flush=True)
    checkpoint = Path(torch.hub.get_dir())/'checkpoints'/weights.url.rsplit('/', 1)[1]
    result = dict(schema_version=1, detector='torchvision Faster R-CNN ResNet50 FPN v2 COCO person',
                  detector_weights=weights.url, weights_sha256=hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                  torch_version=torch.__version__, torchvision_version=torchvision.__version__,
                  score_threshold=.5, coordinates='normalized top-left image coordinates',
                  video_sha256=manifest['video_sha256'], frames=frames, production_eligible=False,
                  limitations=['Generic person detector; includes officials and possible spectators',
                               'Scores are not calibrated hockey accuracy or possession probabilities',
                               'No player identity, video puck tracking, or possession established'])
    with args.output.open('x') as out:
        json.dump(result, out, indent=2, allow_nan=False)


if __name__ == '__main__':
    run()

# Magic Hour POC: Quality Gate Thresholds

This document serves as the master catalog and explanation for every heuristic, numeric constant, and boundary condition utilized in the AssemblyScript (WASM) computer vision pipeline for frame analysis.

**IMPORTANT DISCLAIMER**:
The numeric constants outlined in this document are currently **placeholders**. They were chosen based on fundamental classical computer vision intuitions as reasonable starting points for this Proof of Concept (POC), but they are **not derived from real-world empirical data**. 

It is expected and necessary that these values will be heavily tuned and adjusted during Phase 4 integration testing against the actual sample clips (`clean-sample.mp4`, `blurry-sample.mp4`, `no-face-sample.mp4`, `multi-face-sample.mp4`) introduced in P0-08. If the tests fail to correctly classify frames, these constants are the primary levers you will need to adjust.

---

## 1. YCbCr Skin Tone Segmentation Bounds

**Thresholds:** 
- `Cb` (Blue-difference chroma): `77.0` to `127.0`
- `Cr` (Red-difference chroma): `133.0` to `173.0`

**Where it is used:**
- `segmentSkin` (P1-06) in `assembly/index.ts`

**What is it?**
Before we can find faces, we need to find "skin". Converting RGB colors to the YCbCr color space separates luma (brightness, `Y`) from chroma (color, `Cb` and `Cr`). Because human skin—across all ethnicities and pigmentations—shares a similar underlying blood-based hue under normal lighting conditions, it reliably clusters within a specific range of the `Cb` and `Cr` spectrum, effectively ignoring how bright or dark the lighting is. These thresholds define the "bounding box" of what we consider skin.

**Why these values?**
These values represent standard academic bounds for generic human skin detection in computer vision. They cast a reasonably wide net to account for variations in lighting and camera color science.

**How changing these values affects the system:**
- **If you widen the ranges (e.g., lower the minimums or raise the maximums):** The system becomes much more sensitive. It will successfully detect faces under extreme lighting conditions (like harsh blue or red neon lights). **However**, it will dramatically increase false positives, misclassifying walls, clothing, wood, or dirt as "skin".
- **If you narrow the ranges:** The system becomes much stricter. It will rarely misclassify background objects as skin. **However**, it will fail to detect people with differing complexions, or fail entirely if the subject is in shadows, under warm indoor lighting, or if the video has a heavy color grade.

---

## 2. Minimum Connected Component (Blob) Size Filter

**Threshold:** `2%` of total `ANALYSIS_PIXEL_COUNT` (which is roughly 288 pixels on a 160x90 canvas).

**Where it is used:** 
- `estimateFaces` (P1-07) in `assembly/index.ts`
- Applied after the YCbCr skin mask is generated and grouped into connected "blobs".

**What is it?**
Once we find all the "skin" pixels, we group contiguous (touching) pixels into separate objects ("blobs"). This threshold defines the absolute minimum size a blob must be for us to even consider it a candidate for a human face. Anything smaller is instantly discarded.

**Why 2%?**
A single object taking up less than 2% of the frame is incredibly small. In the context of a Magic Hour portrait video, the subject should be clearly visible. Small blobs are usually background noise, distant hands, a piece of clothing that tricked the skin filter, or a person so far away that their face is irrelevant to our quality gate.

**How changing this value affects the system:**
- **If you increase the threshold (e.g., to 5%):** You demand that faces be much larger in the frame to be counted. The system will aggressively ignore background characters or subjects standing far from the camera. If a user uploads a video where they are full-body (standing far back), they might be incorrectly flagged as "No Face Detected".
- **If you decrease the threshold (e.g., to 0.5%):** The system will start counting tiny specks of skin-colored background noise or hands as "faces". This will artificially inflate the `faceCount` metric, often causing a perfectly good video with a single person to be rejected under the `MULTI_FACE` penalty because the system thinks a hand in the background is a second person.

---

## 3. Maximum Connected Component (Blob) Size Filter

**Threshold:** `40%` of total `ANALYSIS_PIXEL_COUNT` (which is roughly 5,760 pixels on a 160x90 canvas).

**Where it is used:** 
- `estimateFaces` (P1-07) in `assembly/index.ts`

**What is it?**
Similar to the minimum filter, this defines the maximum allowed size for a single blob of skin. If a contiguous block of skin-colored pixels exceeds 40% of the entire screen space, it is discarded and not counted as a face.

**Why 40%?**
In standard, well-framed video content, a human face almost never takes up half of the screen. If a skin blob covers 40% or more of the frame, one of two things is happening: either the subject's face is uncomfortably close to the lens (an extreme, undesirable macro shot), or a massive background element (like a beige wall, a desert dune, or wooden furniture) has accidentally triggered the skin-tone filter and grouped into a giant false-positive blob.

**How changing this value affects the system:**
- **If you increase the threshold (e.g., to 60%):** You allow massive areas of the screen to be classified as faces. If a video features a beige wall in the background, the system might mistakenly think the wall is a giant face, leading to false positives and wildly incorrect framing confidence scores.
- **If you decrease the threshold (e.g., to 20%):** You restrict the framing severely. Close-up shots of users (e.g., from the neck up) will be immediately rejected because their face is "too big".

---

## 4. Single-Face Confidence "Sweet Spot"

**Thresholds:** `[8%, 25%]` of total frame area, centered precisely at a `0.165` (16.5%) midpoint.

**Where it is used:**
- `estimateFaces` (P1-07) in `assembly/index.ts`
- This drives the core math that generates the `confidenceOut` floating-point value (a score from `0.0` to `1.0`).

**What is it?**
Simply counting faces isn't enough; we need to know if the primary face is framed *well*. This logic takes the physical area of the largest valid face blob and scores it based on how close it is to an ideal target size. 
The mathematical formula used is: `confidence = 1.0 - min(1.0, abs(area_fraction - 0.165) / 0.165)`

**Why a 16.5% Midpoint?**
We posit that in a well-composed Magic Hour portrait or standard medium-shot video, a human face optimally takes up roughly 16.5% of the frame. 

**How the math works (and what changing it does):**
- If the face is exactly **16.5%**, the deviation is 0, and the `confidence` score is a perfect `1.0`.
- As the face size deviates away from 16.5% (shrinking towards our 2% minimum boundary, or growing towards our 40% maximum boundary), the absolute deviation increases, mathematically pulling the confidence score down towards `0.0`.
- **If you shift the midpoint higher (e.g., to 25%):** The system will suddenly start preferring and rewarding extreme close-up videos. Normal medium shots (waist up) will receive terrible confidence scores and might be rejected.
- **If you shift the midpoint lower (e.g., to 5%):** The system will prefer videos where the subject is very far away. 
- **If you adjust the denominator scaling (currently locked to 0.165):** You control the "slope" of the penalty. A smaller denominator makes the penalty harsh (only perfectly framed faces get good scores). A larger denominator flattens the curve, making the system much more forgiving of slightly bad framing.

---

## 5. Multi-Face Penalty Cap

**Threshold:** `0.5` (Maximum Confidence)

**Where it is used:**
- `estimateFaces` (P1-07) in `assembly/index.ts`

**What is it?**
If the pipeline detects more than one valid face blob surviving the size filters, the `confidence` score is artificially capped at a maximum of `0.5`, no matter how perfectly the main face is framed.

**Why 0.5?**
Magic Hour aims to extract a *single* identity. A scene with multiple valid faces introduces heavy uncertainty regarding which subject is the primary target. Capping the confidence ensures that downstream systems treat the frame with skepticism, preventing it from being accidentally selected as an ideal "anchor" frame for processing.

---
*(Note: Additional TS-layer thresholds, such as maximum Sharpness, Motion Delta caps, and file size ceilings, will be appended to this document during Phase 2 as they are implemented in the TypeScript wrapper layer.)*

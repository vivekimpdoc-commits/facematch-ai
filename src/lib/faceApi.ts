import * as faceapi from 'face-api.js';

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

let modelsLoaded = false;

export async function loadModels() {
  if (modelsLoaded) return;

  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);

  modelsLoaded = true;
}

export async function getAllFaceDescriptors(imageElement: HTMLImageElement | HTMLCanvasElement) {
  const detections = await faceapi
    .detectAllFaces(imageElement)
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections.map(d => d.descriptor);
}

export async function getFaceDescriptor(imageElement: HTMLImageElement | HTMLCanvasElement) {
  const detection = await faceapi
    .detectSingleFace(imageElement)
    .withFaceLandmarks()
    .withFaceDescriptor();

  return detection?.descriptor;
}

export function computeDistance(descriptor1: Float32Array, descriptor2: Float32Array) {
  return faceapi.euclideanDistance(descriptor1, descriptor2);
}

export async function findBestMatch(targetDescriptor: Float32Array, candidates: { descriptor: Float32Array; id: string }[]) {
  let bestMatch = null;
  let minDistance = Infinity;

  for (const candidate of candidates) {
    const distance = computeDistance(targetDescriptor, candidate.descriptor);
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = { ...candidate, distance };
    }
  }

  return bestMatch;
}

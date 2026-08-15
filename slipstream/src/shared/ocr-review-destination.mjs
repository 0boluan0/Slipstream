import './ocr-review-destination-universal.js';

const ocrReviewDestination = globalThis[Symbol.for('slipstream.ocr-review-destination')];

export const {
  createOcrReviewDestinationDescriptor,
  ocrReviewDestinationForSettings,
  serializeOcrReviewDestination,
} = ocrReviewDestination;

export default ocrReviewDestination;
